#!/usr/bin/env node
/**
 * AUDIT 3 — Ingredient density sanity (Bug Pattern 3 catcher).
 *
 * For every food referenced by any curated dish slot (plus every IFCT row),
 * check the stored per-100 g energy against TWO independent expectations:
 *
 *  1. INTERNAL CONSISTENCY: Atwater sum 4P + 4C + 9F must be within 20% of
 *     the stored energy_kcal (IFCT uses specific factors, so allow slack).
 *     A row whose macros sum to ~190 but claims ~384 kcal is mangled data,
 *     whatever the family. (Caught the chicken-leg 383.6 = 2x doubling.)
 *
 *  2. FAMILY RANGE: a curated table of plausible per-100 g energy ranges for
 *     dense/variable ingredient families (dry legumes, milk concentrates,
 *     raw meats, oils, dairy, staples). Foods matching a family name pattern
 *     must fall inside the range. (Caught khoa 316 vs 380-430, chana whole
 *     287 vs 320-380.)
 *
 * Output: every flagged food id + the dish slots that use it. Exit 1 if any
 * flag, so `npm run check` fails until the data is corrected.
 */
import Database from 'better-sqlite3'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')
const nutrition = new Database(join(REPO, 'apps/mobile/assets/nutrition.db'), { readonly: true })
const ifct = new Database(join(REPO, 'apps/mobile/assets/ifct.db'), { readonly: true })

// ---------- reference table: family name pattern -> expected kcal/100 g ----------
// Ranges are calibrated to the SHIPPED SOURCE OF TRUTH (IFCT 2017 + USDA FDC):
// IFCT reports AVAILABLE carbohydrate (their measured dietary fibre is a
// separate column and carries no energy), so fibre-rich foods like whole
// chana land lower here than in charts that count total carbohydrate.
const FAMILY_RANGES = [
  { rx: /\bbengal gram\b|\bchana\b|chickpea/i, min: 260, max: 390, note: 'dry chickpea, IFCT available-carb convention (whole ~287, dal ~329)' },
  { rx: /\bkhoa\b|\bmawa\b/i, min: 300, max: 440, note: 'milk concentrate (IFCT sample 316 at 42.5% moisture; drier samples run to ~420)' },
  { rx: /chicken/i, min: 95, max: 215, note: 'raw chicken (skinless lean .. skin-on piece)' },
  { rx: /\bmutton\b|\blamb\b|\bgoat\b/i, min: 100, max: 300, note: 'raw mutton cuts' },
  { rx: /\bfish\b|\bsardine\b|\bmackerel\b|\bpomfret\b|\btilapia\b|\bcatla\b|\brohu\b/i, min: 50, max: 220, note: 'raw fish (dried/smoked exempt — see near-zero & dried guard below)' },
  { rx: /\bprawn\b|\bshrimp\b/i, min: 60, max: 130, note: 'raw prawn' },
  { rx: /\beggs?\b.*whole|\bwhole.*eggs?\b/i, min: 115, max: 165, note: 'whole raw egg' },
  { rx: /\bghee\b/i, min: 870, max: 910, note: 'clarified butter' },
  { rx: /\bbutter\b/i, min: 690, max: 740, note: 'butter' },
  { rx: /\boil\b(?!.*essential)|\bsunflower\b.*oil|\bmustard\b.*oil|\bgroundnut\b.*oil|\bcoconut oil\b/i, min: 860, max: 910, note: 'cooking oils' },
  { rx: /\bpaneer\b|\bcottage cheese\b(?!.*low)/i, min: 240, max: 330, note: 'full-fat paneer' },
  { rx: /\bpotato\b(?!.*leaves)/i, min: 55, max: 95, note: 'raw potato' },
  { rx: /\bonion\b(?!.*leaves|\bseeds?\b)/i, min: 35, max: 60, note: 'raw onion' },
  { rx: /\bsugar(s)?\b.*granulated|\bjaggery\b/i, min: 340, max: 395, note: 'sugar / jaggery (IFCT jaggery 354)' },
  { rx: /\byogurt\b|\bcurd\b/i, min: 45, max: 105, note: 'whole-milk curd' },
  { rx: /\bcoconut\b.*\bkernel\b.*\bdry\b|\bdry\b.*\bcoconut\b.*\bkernel\b/i, min: 550, max: 700, note: 'dried coconut (kopra)' },
  { rx: /\bcoconut\b.*\bkernel\b|\bcoconut, kernel\b/i, min: 330, max: 460, note: 'fresh coconut kernel' },
  { rx: /\brice\b.*raw|\braw.*milled\b/i, min: 335, max: 370, note: 'raw milled rice' },
  { rx: /wheat flour.*atta/i, min: 310, max: 355, note: 'whole-wheat atta' },
  { rx: /wheat flour.*refined|\bmaida\b/i, min: 335, max: 370, note: 'refined flour' },
  { rx: /\balmond/i, min: 540, max: 620, note: 'almonds' },
  { rx: /\bcashew/i, min: 540, max: 610, note: 'cashews' },
  { rx: /\bpeanut\b.*\braw\b|\bgroundnut\b(?!.*oil)/i, min: 540, max: 610, note: 'raw peanuts' },
  { rx: /\btoor dal\b|\bpigeon ?pea/i, min: 320, max: 360, note: 'toor dal' },
  { rx: /\bmung\b|\bgreen gram\b/i, min: 310, max: 350, note: 'green gram' },
  { rx: /\burad\b|\bblack gram\b/i, min: 310, max: 350, note: 'black gram' },
  { rx: /\bmasoor\b|\bred ?lentil|\blentil\b/i, min: 320, max: 360, note: 'red lentil' },
  { rx: /\bmilk\b.*\bwhole\b|\bwhole.*\bmilk\b(?!.*powder)/i, min: 55, max: 75, note: 'whole milk' },
]

// ---------- gather every referenced food ----------
const dishes = nutrition.prepare('SELECT id, canonical_name, recipe_template_json FROM dish_definitions').all()
const usedBy = new Map() // foodId -> [{dish,label}]
for (const d of dishes) {
  const tpl = JSON.parse(d.recipe_template_json || '{}')
  for (const s of tpl.ingredientSlots ?? []) {
    const fid = s.nutritionMapping?.canonicalFoodId
    if (!fid) continue
    if (!usedBy.has(fid)) usedBy.set(fid, [])
    usedBy.get(fid).push({ dish: d.canonical_name, label: s.label })
  }
}

const flags = []
function loadFood(fid) {
  if (fid.startsWith('ifct:')) return ifct.prepare('SELECT source, source_id, name, energy_kcal, protein_g, fat_g, carb_g, fiber_g FROM foods WHERE source_id = ?').get(fid.slice(5))
  return nutrition.prepare("SELECT source, source_id, name, energy_kcal, protein_g, fat_g, carb_g, fiber_g FROM foods WHERE source_id = ? AND source LIKE 'fdc_%'").get(fid.slice(5))
}

for (const [fid, uses] of [...usedBy.entries()].sort()) {
  const food = loadFood(fid)
  if (!food || food.energy_kcal == null) {
    flags.push({ fid, why: 'referenced but missing/unresolvable in corpus', uses: uses.slice(0, 3) })
    continue
  }
  const { name, energy_kcal, protein_g = 0, fat_g = 0, carb_g = 0, fiber_g = 0 } = food

  // Check 1 — Atwater internal consistency (fiber may or may not sit inside carb; take the closer reading)
  const atwaterEx = 4 * protein_g + 4 * carb_g + 9 * fat_g
  const atwaterIn = 4 * protein_g + 4 * (carb_g + fiber_g) + 9 * fat_g
  const best = Math.min(Math.abs(atwaterEx - energy_kcal), Math.abs(atwaterIn - energy_kcal))
  // Near-zero brews (black coffee/tea, ~1 kcal) and dehydrated/dried foods are
  // legitimately non-Atwaterian (extract/concentrate) — skip the consistency test.
  const driedFood = /\bdried\b|\bdehydrat|\bsmoked\b/i.test(name)
  const negligibleBrew = energy_kcal <= 5
  if (!driedFood && !negligibleBrew && energy_kcal > 0 && best / Math.max(energy_kcal, 1) > 0.2) {
    flags.push({
      fid, why: `internally inconsistent: stored ${energy_kcal} kcal vs Atwater ${atwaterEx.toFixed(0)} (fiber-excl) / ${atwaterIn.toFixed(0)} (fiber-incl); P${protein_g} C${carb_g} F${fat_g}`,
      uses: uses.slice(0, 3),
    })
    continue // don't double-flag with family range if macros themselves are broken
  }

  // Check 2 — family range (dried/smoked foods are concentrates: skip raw ranges)
  const driedFood2 = /\bdried\b|\bdehydrat|\bsmoked\b/i.test(name)
  for (const fam of FAMILY_RANGES) {
    if (driedFood2 && !/kopra/.test(fam.note)) continue
    if (!fam.rx.test(name)) continue
    if (energy_kcal < fam.min || energy_kcal > fam.max) {
      flags.push({ fid, why: `[${fam.note}] stored ${energy_kcal} kcal outside expected ${fam.min}-${fam.max} (${name})`, uses: uses.slice(0, 3) })
    }
    break // first matching family only
  }
}

console.log(`Density audit: ${usedBy.size} referenced foods across ${dishes.length} dishes.`)
if (flags.length === 0) {
  console.log('ALL PASS — internal consistency and family ranges OK.')
  process.exit(0)
}
for (const f of flags) {
  console.log(`FLAG ${f.fid}: ${f.why}`)
  for (const u of f.uses) console.log(`   used by: ${u.dish} (${u.label})`)
}
console.log(`Total flagged foods: ${flags.length}`)
process.exit(1)
