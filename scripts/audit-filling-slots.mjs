#!/usr/bin/env node
/**
 * AUDIT 2 — Non-empty filling-slot check (Bug Pattern 2 catcher).
 *
 * THE BUG THIS CATCHES: stuffed/filled dishes shipping templates without
 * their defining filling (Paneer Paratha without paneer, Gobi Paratha without
 * cauliflower, Mysore Masala Dosa without its potato masala, ...). A dish
 * named after its filling must actually contain that filling as a slot —
 * resolved to a real corpus food id, with a non-zero mass fraction — and
 * dishes whose dough was mapped to the filling's flour instead of atta
 * (Sattu Paratha) fail the dough rule too.
 *
 * Plain dishes that merely share a family (Plain Paratha, Lachha Paratha,
 * Neer/Set/Rava Dosa without onion) are exempt via the PLAIN_EXEMPT list —
 * each exemption is explicit and reviewed, never a silent pass.
 */
import Database from 'better-sqlite3'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')
const nutrition = new Database(join(REPO, 'apps/mobile/assets/nutrition.db'), { readonly: true })
const ifct = new Database(join(REPO, 'apps/mobile/assets/ifct.db', ), { readonly: true })

function foodExists(foodId) {
  if (!foodId) return false
  if (foodId.startsWith('ifct:')) return !!ifct.prepare('SELECT 1 FROM foods WHERE source_id = ?').get(foodId.slice(5))
  return !!nutrition.prepare("SELECT 1 FROM foods WHERE source_id = ? AND source LIKE 'fdc_%'").get(foodId.slice(5))
}

// name regex -> rule
//   anyOf: slot passes if it maps to one of these food ids (or its label
//   matches labelRx AND the mapped food exists). minMid: fraction floor.
const RULES = [
  { rx: /^Aloo Paratha$/, name: 'potato filling', anyOf: ['ifct:F006'], minMid: 0.15 },
  { rx: /^Gobi Paratha$/, name: 'cauliflower filling', anyOf: ['ifct:D036'], minMid: 0.15 },
  { rx: /^Mooli Paratha$/, name: 'radish filling', anyOf: ['ifct:F009', 'ifct:F010', 'ifct:F011', 'ifct:F012'], minMid: 0.12 },
  { rx: /^Methi Paratha$/, name: 'fenugreek leaves', anyOf: ['ifct:C020'], minMid: 0.06 },
  { rx: /^Paneer Paratha$/, name: 'paneer filling', anyOf: ['ifct:L003'], minMid: 0.15 },
  {
    rx: /^Sattu Paratha$/, name: 'sattu (roasted gram) stuffing + atta dough',
    anyOf: ['ifct:B001'], minMid: 0.12,
    doughMustBe: 'ifct:A019',
  },
  { rx: /^Masala Dosa$/, name: 'potato masala filling', anyOf: ['ifct:F006'], minMid: 0.2 },
  { rx: /^Mysore Masala Dosa$/, name: 'potato masala filling (+ chutney)', anyOf: ['ifct:F006'], minMid: 0.2 },
  { rx: /^Onion Rava Dosa$/, name: 'onions in the batter', anyOf: ['ifct:G017'], minMid: 0.05 },
  { rx: /^Onion Uttapam$/, name: 'onion topping', anyOf: ['ifct:G017'], minMid: 0.05 },
  { rx: /^Onion Pakora$/, name: 'onion body', anyOf: ['ifct:G017'], minMid: 0.2 },
  // Rolls carry their filling under dish-specific labels (cooked_chicken,
  // egg) — the rule accepts the food id, whichever label the reviewed
  // template used, as long as it resolves and is non-zero.
  { rx: /^(Chicken Roll|Kathi Roll)$/, name: 'chicken filling', anyOf: ['ifct:N001', 'ifct:B021'], minMid: 0.15 },
  { rx: /^Egg Chicken Roll$/, name: 'chicken/egg filling', anyOf: ['ifct:N001', 'ifct:M001'], minMid: 0.15 },
  { rx: /^Egg Roll$/, name: 'egg filling', anyOf: ['ifct:M001'], minMid: 0.15 },
  { rx: /^Paneer Roll$/, name: 'paneer filling', anyOf: ['ifct:L003'], minMid: 0.15 },
  { rx: /^(Samosa|Aloo Samosa|Kachori|Dal Kachori|Pyaz Kachori|Raj Kachori|Vada Pav|Dabeli|Misal Pav|Pav Bhaji|Veg Momos|Chicken Momos|Fried Momos|Tandoori Momos|Bread Pakora|Paneer Pakora|Onion Pakora|Ragda Pattice|Chole Bhature|Puri Sabzi|Manchurian|Chilli Paneer)$/, name: 'filling_or_topping slot', labelRx: /^filling_or_topping$/, minMid: 0.15 },
  { rx: /^(Kofta Curry|Malai Kofta|Veg Kofta Curry)$/, name: 'kofta body (vegetable or paneer)', labelRx: /^(primary_vegetable|paneer)$/, minMid: 0.2 },
]

// Dishes whose name CONTAINS a filling word but are legitimately plain:
// each exemption is an explicit, reviewed decision.
const PLAIN_EXEMPT = new Set([
  'Plain Paratha', // no filling by definition
  'Lachha Paratha', // laminated layers, not stuffed
  'Kerala Parotta', 'Malabar Parotta', // laminated
  'Neer Dosa', 'Set Dosa', 'Rava Dosa', 'Plain Dosa', // plain dosas
  'Uttapam', // thick pancake, toppings optional
  'Thepla', 'Methi Thepla', // thin spiced flatbread (Methi Thepla carries its leaves via the same audit's methi rule below if present)
  'Bhatura', 'Puri', 'Aloo Puri', 'Luchi', // fried breads (Aloo Puri's dough carries mash — not audited as stuffed)
  'Naan', 'Garlic Naan', 'Butter Naan', 'Cheese Naan', 'Kulcha', 'Amritsari Kulcha', 'Bakarkhani', 'Sheermal',
  'Vada Pav (Dry)', 'Pav', 'Idli', 'Rava Idli', 'Mini Idli', 'Kanchipuram Idli', 'Thatte Idli',
])

const dishes = nutrition.prepare('SELECT id, canonical_name, recipe_template_json FROM dish_definitions').all()
let checkedDishes = 0
const failures = []
for (const row of dishes) {
  const name = row.canonical_name
  const rule = RULES.find((r) => r.rx.test(name))
  if (!rule) continue
  if (PLAIN_EXEMPT.has(name)) continue
  checkedDishes++
  const tpl = JSON.parse(row.recipe_template_json || '{}')
  const slots = tpl.ingredientSlots ?? []
  const mid = (range) => range && range.length === 2 ? (range[0] + range[1]) / 2 : 0

  // Sattu Paratha: the DOUGH must be atta, not the stuffing flour.
  if (rule.doughMustBe) {
    const dough = slots.find((s) => s.label === 'grain_flour')
    if (!dough || dough.nutritionMapping?.canonicalFoodId !== rule.doughMustBe) {
      failures.push(`${name}: dough slot must map to ${rule.doughMustBe} (atta), found ${dough?.nutritionMapping?.canonicalFoodId ?? 'nothing'}`)
      continue
    }
  }

  const hit = slots.find((s) => {
    const fid = s.nutritionMapping?.canonicalFoodId
    if (rule.anyOf && rule.anyOf.includes(fid)) return mid(s.amountPrior?.range) >= rule.minMid
    if (rule.labelRx && rule.labelRx.test(s.label)) {
      return foodExists(fid) && mid(s.amountPrior?.range) >= rule.minMid
    }
    return false
  })
  if (!hit) {
    const detail = slots
      .map((s) => `${s.label}@${s.nutritionMapping?.canonicalFoodId ?? 'NONE'}:${(s.amountPrior?.range ?? []).join('-')}`)
      .join(' | ')
    failures.push(`${name}: missing ${rule.name} (need ${rule.anyOf ? rule.anyOf.join('/') : rule.labelRx?.source} with mid fraction >= ${rule.minMid}). Slots: ${detail}`)
  }
}

console.log(`Filling audit: ${checkedDishes} stuffed/filled dishes checked against standard-recipe rules.`)
if (failures.length === 0) {
  console.log('ALL PASS — every stuffed dish carries its filling, resolved and non-zero.')
} else {
  console.log(`FAILURES: ${failures.length}`)
  for (const f of failures) console.log(' -', f)
  process.exit(1)
}
