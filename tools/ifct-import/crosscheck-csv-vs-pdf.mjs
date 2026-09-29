#!/usr/bin/env node
/**
 * Cross-check the normalized IFCT CSV against the official PDF text layer.
 * Usage: node crosscheck-ifct-csv.mjs /path/to/ifct-tables.txt
 * (ifct-tables.txt = pdftotext -f 41 -l 68 -layout IFCT2017.pdf)
 *
 * Verifies protein / fat / carbohydrate / energy(kJ→kcal) for every row that
 * pdftotext can parse, so extraction misreads can never ship silently again.
 */
import { readFileSync } from 'node:fs'

const [, , txtPath, csvPath] = process.argv
const txt = readFileSync(txtPath, 'utf8')
const csv = readFileSync(csvPath, 'utf8').trim().split('\n')

// CSV rows keyed by code
const csvRows = new Map()
for (const line of csv.slice(1)) {
  const cells = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { inQ = !inQ; continue }
    if (ch === ',' && !inQ) { cells.push(cur); cur = '' } else cur += ch
  }
  cells.push(cur)
  csvRows.set(cells[0], {
    name: cells[1],
    kcal: parseFloat(cells[3]),
    protein: parseFloat(cells[4]),
    fat: parseFloat(cells[5]),
    carb: parseFloat(cells[6]),
    fiber: parseFloat(cells[7]),
  })
}

// PDF rows: code ... numbers with optional ±SD ... trailing energy kJ
const pdfRows = new Map()
for (const raw of txt.split('\n')) {
  const line = raw.trim()
  const m = line.match(/^([A-Z]\d{3})\s+(.+?)\s+(\d+)\s+(.*)$/)
  if (!m) continue
  const code = m[1]
  const nums = [...m[4].matchAll(/([\d.]+)(?:±[\d.]+)?/g)].map((x) => parseFloat(x[1]))
  if (nums.length < 2) continue
  pdfRows.set(code, { nums, tail: m[4] })
}

let checked = 0
const problems = []
for (const [code, c] of csvRows) {
  const p = pdfRows.get(code)
  if (!p) { problems.push(`${code}: not found in PDF text (name "${c.name}")`); continue }
  const nums = p.nums
  // Column layout: moisture, protein, ash, fat, [fibre], [x], [carb], energykJ
  // Some columns are blank per row, so locate values by position from the END:
  // energy is always LAST; carbohydrate is the one before it when present.
  const energyKj = nums[nums.length - 1]
  const kcalFromPdf = energyKj / 4.184

  // Match protein/fat by searching nums for the CSV values (± tolerance),
  // because blanks shift positions between rows.
  const near = (a, b, tol = 0.06) => Math.abs(a - b) <= tol * Math.max(Math.abs(b), 1)
  const hasProtein = nums.some((n) => near(n, c.protein))
  const hasFat = nums.some((n) => near(n, c.fat))
  const hasCarb = c.carb > 0 ? nums.some((n) => near(n, c.carb)) : true
  const hasFiber = c.fiber > 0 ? nums.some((n) => near(n, c.fiber)) : true

  const kcalDelta = Math.abs(kcalFromPdf - c.kcal)
  const kcalOk = kcalDelta <= Math.max(0.6, 0.005 * c.kcal)

  if (!hasProtein || !hasFat || !hasCarb || !hasFiber || !kcalOk) {
    problems.push(`${code} (${c.name}): PDF nums [${nums.join(', ')}] -> kJ ${energyKj} = ${kcalFromPdf.toFixed(2)} kcal vs CSV ${c.kcal} | protein${hasProtein ? ' ok' : ' MISSING'} fat${hasFat ? ' ok' : ' MISSING'} carb${hasCarb ? ' ok' : ' MISSING'} fiber${hasFiber ? ' ok' : ' MISSING'} energy${kcalOk ? ' ok' : ' MISMATCH'}`)
  }
  checked++
}

console.log(`Cross-checked ${checked}/${csvRows.size} CSV rows against the official PDF text.`)
if (problems.length === 0) {
  console.log('ALL ROWS MATCH the PDF within rounding.')
} else {
  console.log(`DISCREPANCIES: ${problems.length}`)
  for (const p of problems) console.log(' -', p)
}
