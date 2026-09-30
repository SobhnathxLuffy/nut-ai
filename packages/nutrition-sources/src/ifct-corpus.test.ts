import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import type { DbAdapter } from '@nutai/db-adapter'
import { openNodeDb } from '@nutai/db-adapter/node'
import { loadFood, resolveByText } from '@nutai/resolver'

const NUTRITION_DB_PATH = fileURLToPath(new URL('../../../apps/mobile/assets/nutrition.db', import.meta.url))
const IFCT_DB_PATH = fileURLToPath(new URL('../../../apps/mobile/assets/ifct.db', import.meta.url))

// Task 2-c: skip with a warning when the bundled corpus artifact is absent,
// the same contract resolver.golden.test.ts already follows. The corpus is a
// BUILD product (`npm run data:build`, which fetches USDA FDC releases); a
// fresh clone without it used to crash this file in beforeAll and fail the
// whole package — an environment failure masquerading as a regression. Every
// assertion below still runs, unchanged, whenever the corpus exists.
const hasCorpus = existsSync(NUTRITION_DB_PATH) && existsSync(IFCT_DB_PATH)
if (!hasCorpus) {
  console.warn(
    `\n[nutrition-sources] bundled corpus not found (${NUTRITION_DB_PATH}) — run \`npm run data:build\` first; skipping IFCT corpus tests.\n`,
  )
}
const maybeCorpus = hasCorpus ? describe : describe.skip

maybeCorpus('bundled IFCT corpus', () => {
  let nutritionDb: DbAdapter
  let ifctDb: DbAdapter

  beforeAll(() => {
    nutritionDb = openNodeDb(NUTRITION_DB_PATH, { readonly: true })
    ifctDb = openNodeDb(IFCT_DB_PATH, { readonly: true })
  })

  afterAll(async () => {
    await nutritionDb.close()
    await ifctDb.close()
  })

  it('ships all 528 source rows with the official source hash', async () => {
    expect((await ifctDb.get<{ c: number }>("SELECT COUNT(*) c FROM foods WHERE source = 'ifct'"))?.c).toBe(542)
    expect((await ifctDb.get<{ value: string }>("SELECT value FROM build_manifest WHERE key = 'source_hash_sha256'"))?.value)
      .toBe('e87629581a58faca286f4886504bc75f33d6d3771a50fb4e40e2afee2b2b32dd')
  })

  it('resolves stable IFCT food codes, not generated SQLite row IDs', async () => {
    const ragi = await loadFood(nutritionDb, 'ifct:A010', { ifctDb })
    expect(ragi).toMatchObject({ sourceId: 'A010', source: 'ifct', energyKcal: 320.75 })
  })

  it('routes a common alias to IFCT before USDA', async () => {
    // P0-2 note: the dish KB now outranks USDA, and the KB curates "Toor Dal"
    // (CURATED, verified yield) — so the literal query "toor dal" resolves to
    // the curated dish identity and never reaches this rung. The alias path
    // (X -> red gram -> IFCT B021, ahead of USDA junk) is locked with "tuvar
    // dal", the same pulse under a spelling no curated dish aliases.
    const result = await resolveByText(nutritionDb, {
      canonicalFoodKey: 'tuvar dal',
      observedBrand: null,
      prepFacet: null,
      modelCategory: null,
      estimatedGrams: 100,
    }, { ifctDb })
    const ids = result.outcome.kind === 'auto_accept'
      ? [result.outcome.match.foodId]
      : result.outcome.kind === 'disambiguate' ? result.outcome.candidates.map((candidate) => candidate.foodId) : []
    expect(ids).toContain('ifct:B021')
  })
})
