import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import Database from 'better-sqlite3'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '../../..')
const OUT = join(REPO, 'apps/mobile/assets/ifct.db')
const DEFAULT_INPUT = join(HERE, '../data/ifct-2017-macros.csv')
const REQUIRED_COLUMNS = ['food_code', 'name', 'category', 'energy_kcal', 'protein_g', 'fat_g', 'carb_g', 'fiber_g']

function parseCsvLine(line) {
  const cells = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"'
        index++
      } else {
        quoted = !quoted
      }
    } else if (char === ',' && !quoted) {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += char
    }
  }
  if (quoted) throw new Error('Unterminated quoted CSV field')
  cells.push(cell.trim())
  return cells
}

function readRows(inputPath) {
  const raw = readFileSync(inputPath, 'utf8')
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (lines.length < 2) throw new Error('IFCT input must contain a header and at least one food row')
  const header = parseCsvLine(lines[0])
  if (header.join(',') !== REQUIRED_COLUMNS.join(',')) {
    throw new Error(`Unexpected IFCT CSV header. Expected: ${REQUIRED_COLUMNS.join(',')}`)
  }

  const codes = new Set()
  const rows = lines.slice(1).map((line, index) => {
    const cells = parseCsvLine(line)
    if (cells.length !== REQUIRED_COLUMNS.length) throw new Error(`Row ${index + 2}: expected ${REQUIRED_COLUMNS.length} columns`)
    const [code, name, category, ...nutrients] = cells
    if (!code || !name || !category || codes.has(code)) throw new Error(`Row ${index + 2}: missing or duplicate food_code`)
    codes.add(code)
    const values = nutrients.map(Number)
    if (values.some((value) => !Number.isFinite(value) || value < 0)) {
      throw new Error(`Row ${index + 2}: nutrients must be finite non-negative numbers`)
    }
    const [kcal, protein, fat, carb, fiber] = values
    if (kcal > 920 || protein > 100 || fat > 100 || carb > 100 || fiber > 100) {
      throw new Error(`Row ${index + 2}: nutrient value is outside a plausible per-100 g range`)
    }
    return { code, name, category, kcal, protein, fat, carb, fiber }
  })
  return { raw, rows }
}

async function main() {
  console.log('Building IFCT database...')
  const inputPath = process.env.IFCT_INPUT ?? DEFAULT_INPUT
  const { raw, rows } = readRows(inputPath)
  const extractionManifestPath = `${inputPath}.manifest.json`
  const extractionManifest = existsSync(extractionManifestPath)
    ? JSON.parse(readFileSync(extractionManifestPath, 'utf8'))
    : null

  const { NUTRITION_SCHEMA, NUTRITION_FTS_SCHEMA } = await import(
    join(REPO, 'packages/db-adapter/src/schema.ts').replace(/\.ts$/, '.ts')
  ).catch(async () => {
    const { readFile } = await import('node:fs/promises')
    const src = await readFile(join(REPO, 'packages/db-adapter/src/schema.ts'), 'utf8')
    const grab = (name) => {
      const m = new RegExp(`export const ${name} = \`([\\s\\S]*?)\``).exec(src)
      return m[1]
    }
    return { NUTRITION_SCHEMA: grab('NUTRITION_SCHEMA'), NUTRITION_FTS_SCHEMA: grab('NUTRITION_FTS_SCHEMA') }
  })

  mkdirSync(dirname(OUT), { recursive: true })
  const db = new Database(OUT)
  db.pragma('journal_mode = DELETE')
  db.pragma('foreign_keys = OFF')
  db.exec('DROP TABLE IF EXISTS foods; DROP TABLE IF EXISTS food_portions; DROP TABLE IF EXISTS food_fts; DROP TABLE IF EXISTS food_fts_trigram; DROP TABLE IF EXISTS build_manifest; DROP TABLE IF EXISTS brands; DROP TABLE IF EXISTS food_micros; DROP TABLE IF EXISTS food_synonyms;')

  db.exec(NUTRITION_SCHEMA)
  db.exec(NUTRITION_FTS_SCHEMA)

  const insertFood = db.prepare(`
    INSERT INTO foods (id, source, source_id, name, basis, basis_confidence,
                       category, energy_kcal, protein_g, fat_g, carb_g, fiber_g,
                       completeness_score, popularity_rank, license, updated_at)
    VALUES (?, 'ifct', ?, ?, 'per_100g', 'high', ?, ?, ?, ?, ?, ?, ?, ?, 'ifct-authorized', ?)
  `)
  const insertFts = db.prepare('INSERT INTO food_fts (rowid, name, brand, synonyms) VALUES (?,?,?,?)')
  const insertTri = db.prepare('INSERT INTO food_fts_trigram (rowid, name) VALUES (?,?)')

  const now = Date.now()

  let rowId = 0
  const tx = db.transaction(() => {
    for (const row of rows) {
      rowId++
      insertFood.run(
        rowId, row.code, row.name, row.category,
        row.kcal, row.protein, row.fat, row.carb, row.fiber,
        1.0, rowId, now
      )
      insertFts.run(rowId, row.name, '', '')
      insertTri.run(rowId, row.name)
    }
  })
  tx()

  const manifest = db.prepare('INSERT OR REPLACE INTO build_manifest (key, value) VALUES (?,?)')
  db.transaction(() => {
    manifest.run('source', 'IFCT')
    manifest.run('version', '2017')
    manifest.run('publisher', 'ICMR-NIN')
    manifest.run('record_count', String(rowId))
    manifest.run('build_date', new Date(now).toISOString())
    manifest.run('source_hash_sha256', extractionManifest?.sourcePdfSha256 ?? createHash('sha256').update(raw).digest('hex'))
    manifest.run('normalized_input_hash_sha256', createHash('sha256').update(raw).digest('hex'))
    manifest.run('source_url', extractionManifest?.sourceUrl ?? 'fixture')
    manifest.run('source_pages', extractionManifest?.sourcePdfPages ?? 'fixture')
    manifest.run('input_file', extractionManifest?.sourceFile ?? inputPath)
    manifest.run('schema_version', '1')
    manifest.run('permission', extractionManifest?.permission ?? 'test-fixture')
    manifest.run('attribution', 'T. Longvah et al., IFCT 2017, ICMR-NIN')
  })()

  db.exec('VACUUM')
  db.close()
  console.log(`Built ${OUT} with ${rowId} rows from ${inputPath}.`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
