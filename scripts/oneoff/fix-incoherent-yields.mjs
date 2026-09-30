#!/usr/bin/env node
/**
 * Coherent cooked-yield correction for the dish KB.
 *
 * THE BUG: several family models expressed yield as "dry dominant -> cooked
 * mass" (dal 2.8 = dal triples when cooked; rice 2.3; khichdi 3.4). The
 * deterministic engine, however, applies verifiedNumericYield to the WHOLE
 * raw batch — which already contains the cooking water as an explicit slot.
 * Water counted twice: 10.8 g raw dal + 34 g water was asked to become 150 g
 * cooked dal. Physically impossible, and it under-counted every dal/rice/
 * khichdi/idli serving by ~2.5x while the same fractions looked plausible.
 *
 * THE FIX: yield must mean "total raw batch (water included) -> cooked mass".
 * For dishes whose slots already carry the cooking water, that value is
 * bounded by evaporation: 0.90-0.95. Dishes WITHOUT a water slot (biryani
 * with hidden cooking water, nihari/haleem soup, misal/chole-kulche gravy,
 * gulab jamun syrup, sooji halwa) keep their raised yields — there the
 * raised value coherently represents water that never enters the slots.
 *
 * Only dish blocks / overrides that (a) carry an explicit water slot and
 * (b) have yield > 1.05 are rewritten. Everything else is left untouched.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..") + "/"

// Target yields. Evaporation-only losses, because the water is IN the slots.
function targetYield(family, id) {
  if (family === 'legume_preparation') return 0.92
  if (/(pulao|biryani|bisi|tehri|pongal)/.test(id)) return 0.9
  if (/(poha|upma)/.test(id)) return 0.9
  if (family === 'cooked_grain') return 0.95
  if (family === 'batter_or_breakfast') return 0.95
  return null
}

const mapped = JSON.parse(readFileSync(`${REPO}docs/data/indian-dishes.mapped.json`, 'utf8'))
const familyOf = new Map(mapped.map((d) => [d.id, d.family ?? '']))
const hasWaterSlot = (labels) => labels.some((l) => /^water/.test(l))

// ---------------------------------------------------------------------------
// 1. curated-definitions.mjs — hand-curated records (yieldMultiplier field).
// ---------------------------------------------------------------------------
{
  const path = `${REPO}tools/indian-dishes/curated-definitions.mjs`
  const src = readFileSync(path, 'utf8')
  // Dish blocks: "dish:in:<slug>": { ... }
  const re = /("dish:in:[a-z0-9-]+"\s*:\s*\{)/g
  const starts = []
  let m
  while ((m = re.exec(src)) !== null) starts.push({ id: m[1].match(/dish:in:[a-z0-9-]+/)[0], at: m.index })

  const changes = []
  let out = ''
  let cursor = 0
  for (let i = 0; i < starts.length; i++) {
    const blockEnd = i + 1 < starts.length ? starts[i + 1].at : src.length
    const block = src.slice(starts[i].at, blockEnd)
    let newBlock = block
    const yMatch = block.match(/"yieldMultiplier"\s*:\s*([0-9.]+)/)
    if (yMatch) {
      const y = parseFloat(yMatch[1])
      const slotLabels = [...block.matchAll(/"([a-z_]+)"\s*:\s*\{\s*"foodId"/g)].map((x) => x[1])
      const target = y > 1.05 && hasWaterSlot(slotLabels) ? targetYield(familyOf.get(starts[i].id) ?? '', starts[i].id) : null
      if (target) {
        changes.push(`${starts[i].id}: ${y} -> ${target}`)
        newBlock = block.replace(/"yieldMultiplier"\s*:\s*[0-9.]+/, `"yieldMultiplier": ${target}`)
      }
    }
    out += src.slice(cursor, starts[i].at) + newBlock
    cursor = blockEnd
  }
  out += src.slice(cursor)
  writeFileSync(path, out)
  console.log(`curated-definitions.mjs: ${changes.length} yields corrected`)
  for (const c of changes) console.log('  ', c)
}

// ---------------------------------------------------------------------------
// 2. curate-drafts.mjs — FAMILY_MODELS + per-dish OVERRIDES (yield: field).
// ---------------------------------------------------------------------------
{
  const path = `${REPO}tools/indian-dishes/curate-drafts.mjs`
  let src = readFileSync(path, 'utf8')
  const changes = []

  // 2a. Family models: swap the wrong "dominant -> cooked" multipliers.
  const famFixes = [
    ['cooked_grain:', /(\{\s*exemplars: 'Lemon Rice, Curd Rice, Khichdi',[^\n]*\n\s*)yield: 2\.3/, '$1yield: 0.95'],
    ['legume_preparation:', /(\{\s*exemplars: 'Dal Tadka, Dal Fry, Arhar Dal',[^\n]*\n\s*)yield: 2\.8/, '$1yield: 0.92'],
    ['batter_or_breakfast:', /(\{\s*exemplars: 'Idli, Rava Idli, Plain Dosa',[^\n]*\n\s*)yield: 1\.25/, '$1yield: 0.95'],
  ]
  for (const [name, re, repl] of famFixes) {
    if (!re.test(src)) { console.error(`FAMILY MODEL NOT FOUND: ${name}`); process.exit(1) }
    src = src.replace(re, repl)
    changes.push(`family ${name} yield corrected`)
  }

  // 2b. Per-dish overrides: 'Name': { portion, yield, slots } — only entries
  // whose slots carry a water label and whose yield > 1.05.
  const lineRe = /^(\s*'[A-Za-z0-9 .]+':\s*\{\s*portion:\s*(\d+),\s*yield:\s*([0-9.]+),(.*))$/gm
  const edits = []
  for (const match of src.matchAll(lineRe)) {
    const [, full, , yStr, rest] = match
    const y = parseFloat(yStr)
    if (!(y > 1.05)) continue
    const waterish = /(^|[,{]\s*)(water|water_or_milk)\s*:/.test(rest)
    if (!waterish) continue
    const name = full.match(/'([A-Za-z0-9 .]+)'/)[1]
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const id = `dish:in:${slug}`
    const target = targetYield(familyOf.get(id) ?? '', id)
    if (!target) continue
    edits.push({ full, y, target, name })
  }
  for (const e of edits) {
    src = src.replace(e.full, e.full.replace(/yield:\s*[0-9.]+/, `yield: ${e.target}`))
    changes.push(`override ${e.name}: ${e.y} -> ${e.target}`)
  }
  writeFileSync(path, src)
  console.log(`curate-drafts.mjs: ${changes.length} entries corrected`)
  for (const c of changes) console.log('  ', c)
}
