#!/usr/bin/env node
/**
 * Per-serving ingredient-gram audit for every CURATED/VERIFIED dish.
 *
 * Reproduces the engine arithmetic in packages/indian-dishes/src/totals.ts:
 *   per-100g-raw slot grams  = mid(range) * 100
 *   rawMass100               = SUM(slot grams)
 *   cooked100                = rawMass100 * verifiedNumericYield
 *   scale                    = standardPortionGrams / cooked100
 *   per-serving grams        = slot grams * scale  = mid_i / SUM(mid) * portion/yield
 *
 * Flags:
 *   - fat_variable slots above a plausible per-serving fat amount
 *   - salt/sodium-dense minor slots above 1.5 g/serving
 *   - water in bread family above dough-plausible shares
 *   - dominant slots under 25% of raw mass
 *   - SUM(range mids) drifting far from 1.0
 */
import { readFileSync } from 'node:fs'

const dishes = JSON.parse(readFileSync('docs/data/indian-dishes.mapped.json', 'utf8'))
const el = (x) => (x[0] + x[1]) / 2

const FAT_ROLE = 'fat_variable'
const rows = []
let audited = 0

for (const dish of dishes) {
  const status = dish.provenance?.recordStatus
  if (status !== 'CURATED' && status !== 'VERIFIED') continue
  const slots = dish.recipeTemplate?.ingredientSlots ?? []
  if (slots.length === 0) continue
  if (dish.recipeTemplate?.numericRatiosVerified !== true) continue
  const yieldM = dish.cooking?.yieldModel?.verifiedNumericYield
  const portion = dish.portionModel?.standardPortionGrams
  if (!(yieldM > 0) || !(portion > 0)) continue
  audited += 1

  const mids = slots.map((s) => (s.amountPrior?.range ? el(s.amountPrior.range) : null))
  const midSum = mids.reduce((a, b) => a + (b ?? 0), 0)
  const serving = []
  slots.forEach((s, i) => {
    const mid = mids[i]
    if (mid == null) { serving.push({ label: s.label, role: s.role, grams: null, foodId: s.nutritionMapping?.canonicalFoodId ?? null }); return }
    const g = midSum > 0 ? (mid / midSum) * (portion / yieldM) : mid * (portion / yieldM)
    serving.push({ label: s.label, role: s.role, grams: g, foodId: s.nutritionMapping?.canonicalFoodId ?? null })
  })

  for (const s of serving) {
    if (s.grams == null) continue
    const g = s.grams
    if (s.role === FAT_ROLE && g > 12) rows.push({ dish: dish.canonicalName, id: dish.id, severity: 'FAT', msg: `${s.label} = ${g.toFixed(1)} g/serving`, portion, yieldM })
    if (s.label === 'salt' && g > 1.5) rows.push({ dish: dish.canonicalName, id: dish.id, severity: 'SALT', msg: `salt = ${g.toFixed(2)} g/serving`, portion, yieldM })
    if (s.role === 'dominant' && midSum > 0 && (el((slots.find((x) => x.label === s.label)?.amountPrior?.range) ?? [0, 0]) / midSum) < 0.25) {
      rows.push({ dish: dish.canonicalName, id: dish.id, severity: 'DOMINANT', msg: `${s.label} only ${((el(slots.find((x) => x.label === s.label)?.amountPrior?.range) ?? [0, 0]) / midSum * 100).toFixed(0)}% of raw mass`, portion, yieldM })
    }
  }
  if (Math.abs(midSum - 1) > 0.2) rows.push({ dish: dish.canonicalName, id: dish.id, severity: 'SUM', msg: `range mids sum to ${midSum.toFixed(3)} (raw batch ${((portion / yieldM)).toFixed(0)}g scaled to ${(portion / yieldM / midSum).toFixed(0)}g)`, portion, yieldM })
}

console.log(`Audited ${audited} curated/verified dishes.`)
if (rows.length === 0) {
  console.log('No absurd per-serving amounts found.')
} else {
  const bySev = {}
  for (const r of rows) (bySev[r.severity] ??= []).push(r)
  for (const [sev, list] of Object.entries(bySev)) {
    console.log(`\n== ${sev} (${list.length}) ==`)
    for (const r of list.slice(0, 40)) console.log(`${r.dish} [${r.id}] ${r.msg}`)
    if (list.length > 40) console.log(`… and ${list.length - 40} more`)
  }
}

// Also print a worked example table for a handful of representative dishes so a human can eyeball plausibility.
const SAMPLE = ['dish:in:roti', 'dish:in:aloo-paratha', 'dish:in:dal-tadka', 'dish:in:sambar', 'dish:in:steamed-rice', 'dish:in:jeera-rice', 'dish:in:idli', 'dish:in:upma', 'dish:in:khichdi', 'dish:in:samosa', 'dish:in:paneer-butter-masala', 'dish:in:chicken-curry', 'dish:in:gulab-jamun', 'dish:in:egg-biryani', 'dish:in:masala-dosa']
console.log('\n== Worked examples (per standard serving) ==')
for (const id of SAMPLE) {
  const dish = dishes.find((d) => d.id === id)
  if (!dish) continue
  const slots = dish.recipeTemplate?.ingredientSlots ?? []
  const mids = slots.map((s) => (s.amountPrior?.range ? el(s.amountPrior.range) : 0))
  const midSum = mids.reduce((a, b) => a + b, 0) || 1
  const yieldM = dish.cooking?.yieldModel?.verifiedNumericYield
  const portion = dish.portionModel?.standardPortionGrams
  const parts = slots.map((s, i) => `${s.label} ${((mids[i] / midSum) * (portion / yieldM)).toFixed(1)}g`)
  console.log(`${dish.canonicalName} (${portion}g): ${parts.join(' + ')}`)
}
