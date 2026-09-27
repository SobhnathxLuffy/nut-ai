import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DbAdapter } from '@nutai/db-adapter'
import { openNodeDb } from '@nutai/db-adapter/node'
import { resolveByText } from './index.js'

/**
 * QA SECTION-B P0-2 — golden queries against the REAL bundled corpus.
 *
 * The alias ladder used to run BEFORE the literal term, so "biryani" resolved
 * to USDA rice-mix puddings, "poha" to cape gooseberries and "upma" to a HEINZ
 * gravy — while the CURATED dish KB rows for those exact names sat unqueried in
 * the same database. These queries lock the corrected cascade: the literal name
 * must surface the dish-KB identity, and the old junk must never win again.
 *
 * Runs against the same artifact the app ships (built by `npm run data:build`,
 * which now compiles the dish KB too). Skipped when the corpus or the dish KB
 * is absent — the gate in tools/indian-dishes/validate.mjs catches a stale
 * artifact missing the dish KB.
 */

const DB_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../apps/mobile/assets/nutrition.db',
)
const IFCT_DB_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../apps/mobile/assets/ifct.db',
)

const hasCorpus = existsSync(DB_PATH)

let hasDishKb = false
if (hasCorpus) {
  const probe = openNodeDb(DB_PATH, { readonly: true })
  hasDishKb =
    (await probe.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='dish_definitions'`)) !==
    null
  await probe.close()
}

const maybeCorpus = hasCorpus ? describe : describe.skip
const maybeDishKb = hasCorpus && hasDishKb ? describe : describe.skip

if (!hasCorpus) {
  console.warn(`\n[resolver] corpus not found at ${DB_PATH} — run \`npm run data:build\` first.\n`)
} else if (!hasDishKb) {
  console.warn(
    '\n[resolver] bundled corpus has no dish_definitions table — `npm run data:build` no longer ships like this; rebuild.\n',
  )
}

/** Each golden query: what the top hit must identify as, and what must never win again. */
const GOLDEN_QUERIES: ReadonlyArray<{ query: string; want: RegExp; ban?: RegExp }> = [
  { query: 'biryani', want: /biryani/i, ban: /pudding|rice mix/i },
  { query: 'paneer', want: /paneer/i },
  { query: 'poha', want: /poha|rice flakes|beaten|flattened/i, ban: /gooseberr/i },
  { query: 'roti', want: /roti|chapati|phulka/i, ban: /commercial/i },
  { query: 'rajma', want: /rajma|kidney bean/i, ban: /canned/i },
  { query: 'upma', want: /upma/i, ban: /gravy|heinz|spices/i },
  { query: 'idli', want: /idli/i, ban: /navajo/i },
  { query: 'toor dal', want: /toor dal/i, ban: /gooseberr|pudding/i },
]

function topIdentityName(name: string): string {
  return name
}

async function resolveTop(query: string, nutritionDb: DbAdapter, ifctDb?: DbAdapter) {
  const context = ifctDb ? { ifctDb } : {}
  const result = await resolveByText(
    nutritionDb,
    {
      canonicalFoodKey: query,
      observedBrand: null,
      prepFacet: null,
      modelCategory: null,
      estimatedGrams: 100,
    },
    context,
  )
  expect(result.outcome.kind).not.toBe('miss')
  expect(result.zeroHit).toBe(false)
  const top =
    result.outcome.kind === 'auto_accept'
      ? result.outcome.match
      : result.outcome.kind === 'disambiguate'
        ? result.outcome.candidates[0]
        : undefined
  if (!top) throw new Error(`no candidate returned for "${query}"`)
  return top
}

maybeCorpus('resolver against the real corpus', () => {
  let nutritionDb: DbAdapter
  let ifctDb: DbAdapter | undefined

  beforeAll(() => {
    nutritionDb = openNodeDb(DB_PATH, { readonly: true })
    ifctDb = existsSync(IFCT_DB_PATH) ? openNodeDb(IFCT_DB_PATH, { readonly: true }) : undefined
  })

  it('the ladder still finds generic foods (no alias regression)', async () => {
    // A plain USDA-style generic key must keep resolving — the reorder must
    // not break the bread-and-butter path.
    const top = await resolveTop('chicken breast', nutritionDb, ifctDb)
    expect(topIdentityName(top.name)).toMatch(/chicken/i)
  })

  afterAll(async () => {
    await nutritionDb.close()
    if (ifctDb) await ifctDb.close()
  })
})

maybeDishKb('resolver golden queries — Indian dish names hit the dish KB (P0-2)', () => {
  let nutritionDb: DbAdapter
  let ifctDb: DbAdapter | undefined

  beforeAll(() => {
    nutritionDb = openNodeDb(DB_PATH, { readonly: true })
    ifctDb = existsSync(IFCT_DB_PATH) ? openNodeDb(IFCT_DB_PATH, { readonly: true }) : undefined
  })

  for (const golden of GOLDEN_QUERIES) {
    it(`"${golden.query}" resolves to its dish identity, not alias junk`, async () => {
      const top = await resolveTop(golden.query, nutritionDb, ifctDb)
      expect(topIdentityName(top.name)).toMatch(golden.want)
      if (golden.ban) expect(topIdentityName(top.name)).not.toMatch(golden.ban)
    })
  }

  afterAll(async () => {
    await nutritionDb.close()
    if (ifctDb) await ifctDb.close()
  })
})
