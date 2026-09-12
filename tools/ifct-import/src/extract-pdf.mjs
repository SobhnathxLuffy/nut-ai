#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_OUTPUT = join(HERE, '../data/ifct-2017-macros.csv')
const SOURCE_URL = 'https://www.nin.res.in/ebooks/IFCT2017_16122024.pdf'
const EXPECTED_ROWS = 528

const CATEGORY_BY_PREFIX = {
  A: 'Cereals and millets',
  B: 'Grain legumes',
  C: 'Green leafy vegetables',
  D: 'Other vegetables',
  E: 'Fruits',
  F: 'Roots and tubers',
  G: 'Condiments and spices',
  H: 'Nuts and oil seeds',
  I: 'Sugars',
  J: 'Mushrooms',
  K: 'Miscellaneous foods',
  L: 'Milk and milk products',
  M: 'Egg and egg products',
  N: 'Poultry',
  O: 'Animal meat',
  P: 'Marine fish',
  Q: 'Marine shellfish',
  R: 'Marine mollusks',
  S: 'Freshwater fish and shellfish',
}

const PLANT_LAYOUT = {
  name: [74, 272],
  cells: {
    regions: [265, 300],
    moisture: [300, 365],
    protein: [365, 425],
    ash: [425, 480],
    fat: [480, 530],
    fiber: [530, 585],
    carbohydrate: [700, 755],
    energyKj: [755, 820],
  },
}

const ANIMAL_LAYOUT = {
  name: [110, 290],
  cells: {
    regions: [285, 325],
    moisture: [325, 410],
    protein: [410, 500],
    ash: [500, 580],
    fat: [580, 670],
    energyKj: [670, 755],
  },
}

function decodeXml(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
}

function parseWords(pageXml) {
  const words = []
  const wordPattern = /<word xMin="([^"]+)" yMin="([^"]+)" xMax="([^"]+)" yMax="([^"]+)">([\s\S]*?)<\/word>/g
  for (const match of pageXml.matchAll(wordPattern)) {
    const [, xMin, yMin, xMax, yMax, text] = match
    words.push({
      xMin: Number(xMin),
      yMin: Number(yMin),
      xMax: Number(xMax),
      yMax: Number(yMax),
      text: decodeXml(text.replace(/<[^>]+>/g, '')).trim(),
    })
  }
  return words
}

function centerX(word) {
  return (word.xMin + word.xMax) / 2
}

function centerY(word) {
  return (word.yMin + word.yMax) / 2
}

function parseMean(text) {
  const match = /^([0-9]+(?:\.[0-9]+)?)/.exec(text)
  return match == null ? null : Number(match[1])
}

function cellValue(words, anchorY, [minX, maxX]) {
  const candidates = words
    .filter((word) => centerX(word) >= minX && centerX(word) < maxX && Math.abs(centerY(word) - anchorY) <= 4.5)
    .sort((left, right) => Math.abs(centerY(left) - anchorY) - Math.abs(centerY(right) - anchorY))
  return candidates.length === 0 ? null : parseMean(candidates[0].text)
}

function recipeName(words, anchorY, [minX, maxX]) {
  return words
    .filter((word) => word.xMin >= minX && word.xMax < maxX && Math.abs(centerY(word) - anchorY) <= 14)
    .sort((left, right) => Math.round(left.yMin / 2) - Math.round(right.yMin / 2) || left.xMin - right.xMin)
    .map((word) => word.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replaceAll('((', '(')
    .replace(/\s+\)/g, ')')
    .replace(/\b([A-Za-z]{3,}) ([a-z])\)/g, '$1$2)')
    .trim()
}

function round(value, decimals = 2) {
  const scale = 10 ** decimals
  return Math.round(value * scale) / scale
}

function parseTable(xml) {
  const rows = []
  const pages = [...xml.matchAll(/<page\b[^>]*>([\s\S]*?)<\/page>/g)]
  for (let pageOffset = 0; pageOffset < pages.length; pageOffset++) {
    const pdfPage = 41 + pageOffset
    const layout = pdfPage <= 57 ? PLANT_LAYOUT : ANIMAL_LAYOUT
    const words = parseWords(pages[pageOffset][1])
    const anchors = words.filter((word) => /^[A-S][0-9]{3}$/.test(word.text))

    for (const anchor of anchors) {
      const anchorY = centerY(anchor)
      const values = Object.fromEntries(
        Object.entries(layout.cells).map(([field, zone]) => [field, cellValue(words, anchorY, zone)]),
      )
      const category = CATEGORY_BY_PREFIX[anchor.text[0]]
      const name = recipeName(words, anchorY, layout.name)
      const fiber = values.fiber ?? 0
      const carbohydrate = values.carbohydrate ?? 0
      if (!category || !name || values.protein == null || values.fat == null || values.energyKj == null) {
        throw new Error(`Could not extract required cells for ${anchor.text} on PDF page ${pdfPage}`)
      }
      rows.push({
        foodCode: anchor.text,
        name,
        category,
        energyKcal: round(values.energyKj / 4.184),
        proteinG: values.protein,
        fatG: values.fat,
        carbG: carbohydrate,
        fiberG: fiber,
        massTotalG: (values.moisture ?? 0) + values.protein + (values.ash ?? 0) + values.fat + carbohydrate + fiber,
      })
    }
  }
  return rows
}

function csvCell(value) {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function validate(rows) {
  if (rows.length !== EXPECTED_ROWS) {
    throw new Error(`Expected ${EXPECTED_ROWS} IFCT rows, extracted ${rows.length}`)
  }
  const codes = new Set(rows.map((row) => row.foodCode))
  if (codes.size !== rows.length) throw new Error('IFCT extraction produced duplicate food codes')

  for (const row of rows) {
    const nutrients = [row.energyKcal, row.proteinG, row.fatG, row.carbG, row.fiberG]
    if (nutrients.some((value) => !Number.isFinite(value) || value < 0)) {
      throw new Error(`${row.foodCode} contains an invalid nutrient value`)
    }
    if (row.energyKcal > 920 || [row.proteinG, row.fatG, row.carbG, row.fiberG].some((value) => value > 100)) {
      throw new Error(`${row.foodCode} contains an implausible per-100 g nutrient value`)
    }
    if (row.massTotalG > 105) {
      throw new Error(`${row.foodCode} exceeds the per-100 g mass balance tolerance`)
    }
  }
}

function main() {
  const pdfPath = process.env.IFCT_PDF ?? process.argv[2]
  const outputPath = process.env.IFCT_OUTPUT ?? process.argv[3] ?? DEFAULT_OUTPUT
  if (!pdfPath) throw new Error('Usage: IFCT_PDF=/path/to/IFCT2017.pdf npm run ifct:extract')

  const pdf = readFileSync(pdfPath)
  const sourceHash = createHash('sha256').update(pdf).digest('hex')
  const xml = execFileSync('pdftotext', ['-f', '41', '-l', '68', '-bbox-layout', pdfPath, '-'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  const rows = parseTable(xml)
  validate(rows)

  const header = ['food_code', 'name', 'category', 'energy_kcal', 'protein_g', 'fat_g', 'carb_g', 'fiber_g']
  const csv = [
    header.join(','),
    ...rows.map((row) => [
      row.foodCode,
      row.name,
      row.category,
      row.energyKcal,
      row.proteinG,
      row.fatG,
      row.carbG,
      row.fiberG,
    ].map(csvCell).join(',')),
    '',
  ].join('\n')

  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, csv)
  writeFileSync(`${outputPath}.manifest.json`, `${JSON.stringify({
    source: 'Indian Food Composition Tables 2017',
    sourceUrl: SOURCE_URL,
    sourceFile: basename(pdfPath),
    sourcePdfSha256: sourceHash,
    sourcePdfPages: '41-68',
    normalizedCsvSha256: createHash('sha256').update(csv).digest('hex'),
    recordCount: rows.length,
    energyConversion: 'ENERC kilojoules divided by 4.184',
    permission: 'project-owner-authorized',
    extractorVersion: 1,
  }, null, 2)}\n`)
  console.log(`Extracted ${rows.length} IFCT foods to ${outputPath}`)
  console.log(`Official source SHA-256: ${sourceHash}`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
