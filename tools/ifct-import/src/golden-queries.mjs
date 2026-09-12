#!/usr/bin/env node
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const HERE = dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.DB ?? join(HERE, '../../../apps/mobile/assets/ifct.db')

const CASES = [
  { q: 'Rice raw milled', expect: /rice, raw, milled/i, minHits: 1 },
  { q: 'Wheat flour atta', expect: /wheat flour, atta/i, minHits: 1 },
  { q: 'Ragi', expect: /^ragi/i, minHits: 1 },
  { q: 'Paneer', expect: /^paneer$/i, minHits: 1 },
  { q: 'Rohu', expect: /^rohu/i, minHits: 1 },
]

function match(db, query) {
  const expr = query.split(/\s+/).filter(Boolean).map((t) => `"${t}"`).join(' ')
  return db
    .prepare(
      `SELECT f.id, f.name, f.energy_kcal
       FROM food_fts JOIN foods f ON f.id = food_fts.rowid
       WHERE food_fts MATCH ? ORDER BY bm25(food_fts, 10.0, 8.0, 4.0) LIMIT 10`,
    )
    .all(expr)
}

const db = new Database(DB_PATH, { readonly: true })
let failures = 0

for (const c of CASES) {
  const hits = match(db, c.q)
  const ok = hits.length >= c.minHits && hits.some((h) => c.expect.test(h.name))
  if (!ok) {
    console.error(`FAIL: "${c.q}" -> ${hits.length} hits`)
    failures++
  } else {
    console.log(`ok: "${c.q}" -> ${hits[0].name}`)
  }
}

const count = db.prepare("SELECT COUNT(*) c FROM foods WHERE source = 'ifct'").get().c
if (count !== 528) {
  console.error(`FAIL: expected 528 IFCT records, found ${count}`)
  failures++
}

const requiredManifestKeys = ['source', 'version', 'publisher', 'record_count', 'source_hash_sha256', 'normalized_input_hash_sha256', 'source_url', 'permission', 'attribution']
const manifestCount = db.prepare('SELECT COUNT(*) c FROM build_manifest WHERE key IN (' + requiredManifestKeys.map(() => '?').join(',') + ')').get(...requiredManifestKeys).c
if (manifestCount !== requiredManifestKeys.length) {
  console.error('FAIL: IFCT build manifest is incomplete')
  failures++
}

db.close()
if (failures > 0) {
  process.exit(1)
}
console.log('IFCT golden queries passed.')
