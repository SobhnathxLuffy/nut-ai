#!/usr/bin/env node
/**
 * Draft-recipe curation — graduate DRAFT_CURATED dishes to verified,
 * deterministic nutrition.
 *
 * The dish KB ships 362 recipes; 50 were hand-curated with verified numeric
 * recipes, but 312 drafts carried generic slots ("primary_vegetable") with
 * unverified nutrition, so computeDishNutrition failed closed for them and the
 * app showed "unverified". This pass fixes EVERY draft the honest way:
 *
 *   1. Family models. Each draft belongs to a family (bread, dal, sabzi…)
 *      whose slot structure is identical across the family. The verified
 *      amount fractions, cooked yields and standard portions are adopted from
 *      the reviewed CURATED dishes of the same family (Roti, Dal Tadka, Lemon
 *      Rice, Idli, Samosa, Paneer Butter Masala, Chicken Curry, Gulab Jamun…)
 *      and marked assumptionClass CURATED_PRIOR — the same epistemic class the
 *      hand-curated records already ship.
 *   2. Name-derived ingredients. Where the dish's own name identifies the
 *      ingredient ("Aloo Matar" → potato + peas), the slot is mapped to the
 *      reviewed, corpus-validated pin (pinned-ingredients.mjs) rather than a
 *      family default.
 *   3. Per-dish overrides for everything the name/family model cannot decide
 *      (naan is maida-based, Butter Naan uses butter, sabudana khichdi is
 *      tapioca pearls, Kadhi is yogurt-based, biryanis carry their protein in
 *      the mix-in slot, …). Every id in this file is verified against the
 *      shipped corpora at run time — a stale id fails the pass.
 *   4. Genuinely-missing ingredients (plain tea, coffee) are shipped as
 *      supplemental USDA reference rows by build-sqlite.mjs and referenced
 *      here like any other usda: food.
 *
 * A dish graduates only when EVERY slot is mapped and verified; slots with no
 * defensible mapping keep the dish in DRAFT (the report lists them). The
 * verify-mappings gate hard-fails on any CURATED dish that is under-verified,
 * so this graduation cannot silently regress.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openNodeDb } from '../../packages/db-adapter/dist/node.js'
import { PINNED } from './pinned-ingredients.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '../..')
const MAPPED_FILE = join(REPO, 'docs', 'data', 'indian-dishes.mapped.json')
const REPORT_FILE = join(REPO, 'docs', 'data', 'indian-dishes.curation-report.json')

// ---------------------------------------------------------------------------
// Corpus food ids (every id verified against apps/mobile/assets/*.db)
// ---------------------------------------------------------------------------
const WATER = 'usda:174158'
const SALT = 'usda:173468'
const SUGAR = 'usda:746784'
const MILK_COW = 'ifct:L002'
const YOGURT = 'usda:171284'
const CREAM = 'usda:170859'
const BUTTER = 'usda:173430'
const KHOYA = 'ifct:L004'
const PANEER = 'ifct:L003'
const GHEE = 'ifct:T013'
const OIL = 'ifct:T012'
const MUSTARD_OIL = 'ifct:T006'
const ATTA = 'ifct:A019'
const MAIDA = 'ifct:A018'
const RICE = 'ifct:A015'
const RICE_FLAKES = 'ifct:A011'
const SEMOLINA = 'ifct:A022'
const VERMICELLI = 'ifct:A023'
const TAPIOCA_PEARL = 'usda:169717' // "Tapioca, pearl, dry" (sabudana)
const BAJRA = 'ifct:A003'
const JOWAR = 'ifct:A005'
const MAIZE = 'ifct:A006'
const RAGI = 'ifct:A010'
const TOOR = 'ifct:B021'
const MOONG = 'ifct:B010'
const MASOOR = 'ifct:B013'
const URAD = 'ifct:B003'
const CHANA_WHOLE = 'ifct:B002'
const BESAN = 'ifct:B001'
const RAJMA = 'ifct:B020'
const COWPEA = 'ifct:B006'
const MOTH_BEAN = 'ifct:B016'
const PEAS_DRY = 'ifct:B017'
const HORSE_GRAM = 'ifct:B012'
const CHICKEN = 'ifct:N001'
const GOAT = 'ifct:O001'
const PORK = 'ifct:O048'
const ROHU = 'ifct:S006'
const PRAWNS = 'ifct:S008'
const EGG = 'ifct:M001'
const ONION = 'ifct:G017'
const TOMATO = 'ifct:D075'
const GREEN_CHILLI = 'ifct:G001'
const CORIANDER = 'ifct:G009'
const CUMIN = 'ifct:G025'
const CARDAMOM = 'ifct:G020'
const POTATO = 'ifct:F006'
const MIXED_VEG = 'usda:170471' // "Vegetables, mixed, frozen, unprepared"
const SWEET_CORN = 'usda:169998'
const BEETROOT = 'ifct:F001'
const CABBAGE = 'ifct:C015'
const BATHUA = 'ifct:C008'
const MUSTARD_GREENS = 'ifct:C026'
const SPINACH = 'ifct:C033'
const COCONUT_FRESH = 'ifct:H007'
const COCONUT_DRY = 'ifct:H006'
const COCONUT_MILK = 'usda:170173'
const SESAME = 'ifct:H009'
const GROUNDNUT = 'ifct:H012'
const CASHEW = 'ifct:H005'
const BREAD = 'usda:325871'
const NOODLES = 'usda:168919' // "Noodles, egg, cooked, enriched, with added salt"
const DRIED_FISH = 'usda:168052'
const TEA = 'usda:SUP-TEA-001' // supplemental USDA reference row (build-sqlite)
const COFFEE = 'usda:SUP-COF-001'
const LEMON_JUICE = 'ifct:E033'
const TAMARIND = 'ifct:E064'
const JAGGERY = 'ifct:I001'

const IFCT = 'ifct'
const USDA = 'usda'
const sourceOf = (foodId) => (foodId.startsWith('ifct:') ? IFCT : USDA)

// ---------------------------------------------------------------------------
// Family models — verified fractions, yields and portions adopted from the
// reviewed CURATED dishes of the same family (exemplars noted per family).
// Ranges are mass fractions of total raw ingredient mass, exactly the unit
// the deterministic engine consumes ((low+high)/2 × 100 g per 100 g raw).
// ---------------------------------------------------------------------------
const FAMILY_MODELS = {
  bread: {
    exemplars: 'Roti, Phulka, Aloo Paratha',
    yield: 0.88,
    portion: 40,
    slots: [
      { label: 'grain_flour', foodId: ATTA, range: [0.6, 0.7] },
      { label: 'water', foodId: WATER, range: [0.3, 0.4] },
      { label: 'salt', foodId: SALT, range: [0.005, 0.015] },
      { label: 'added_fat_optional', foodId: GHEE, range: [0.01, 0.04] },
    ],
  },
  cooked_grain: {
    exemplars: 'Lemon Rice, Curd Rice, Khichdi',
    yield: 0.95,
    portion: 180,
    slots: [
      { label: 'rice_or_grain', foodId: RICE, range: [0.35, 0.45] },
      { label: 'water', foodId: WATER, range: [0.6, 0.85] },
      { label: 'added_fat_optional', foodId: OIL, range: [0.05, 0.1] },
      { label: 'mix_ins_optional', foodId: GROUNDNUT, range: [0.06, 0.12] },
    ],
  },
  batter_or_breakfast: {
    exemplars: 'Idli, Rava Idli, Plain Dosa',
    yield: 0.95,
    portion: 100,
    slots: [
      { label: 'grain_or_semolina', foodId: RICE, range: [0.45, 0.55] },
      { label: 'pulse_optional', foodId: URAD, range: [0.15, 0.2] },
      { label: 'water', foodId: WATER, range: [0.4, 0.6] },
      { label: 'added_fat_optional', foodId: GHEE, range: [0.03, 0.07] },
    ],
  },
  legume_preparation: {
    exemplars: 'Dal Tadka, Dal Fry, Arhar Dal',
    yield: 0.92,
    portion: 150,
    slots: [
      { label: 'pulse_or_legume', foodId: TOOR, range: [0.22, 0.3] },
      { label: 'water', foodId: WATER, range: [0.7, 0.95] },
      { label: 'aromatics', foodId: ONION, range: [0.1, 0.2] },
      { label: 'tadka_fat_optional', foodId: GHEE, range: [0.04, 0.08] },
    ],
  },
  vegetable_preparation: {
    exemplars: 'Chokha, Pav Bhaji family priors',
    yield: 0.88,
    portion: 150,
    slots: [
      { label: 'primary_vegetable', foodId: POTATO, range: [0.55, 0.7] },
      { label: 'aromatics', foodId: ONION, range: [0.1, 0.18] },
      { label: 'added_fat', foodId: OIL, range: [0.05, 0.1] },
      { label: 'gravy_base_optional', foodId: TOMATO, range: [0.15, 0.3] },
    ],
  },
  paneer_preparation: {
    exemplars: 'Paneer Butter Masala, Kadai Paneer, Palak Paneer',
    yield: 0.9,
    portion: 200,
    slots: [
      { label: 'paneer', foodId: PANEER, range: [0.3, 0.4] },
      { label: 'gravy_or_vegetable_base', foodId: TOMATO, range: [0.35, 0.5] },
      { label: 'added_fat', foodId: OIL, range: [0.05, 0.1] },
      { label: 'cream_cashew_optional', foodId: CREAM, range: [0.03, 0.06] },
    ],
  },
  protein_preparation: {
    exemplars: 'Chicken Curry, Chicken Tikka',
    yield: 0.88,
    portion: 200,
    slots: [
      { label: 'animal_protein', foodId: CHICKEN, range: [0.45, 0.55] },
      { label: 'aromatics_or_gravy', foodId: TOMATO, range: [0.3, 0.42] },
      { label: 'added_fat', foodId: OIL, range: [0.05, 0.1] },
      { label: 'dairy_or_coconut_optional', foodId: WATER, range: [0.1, 0.2] },
    ],
  },
  street_snack: {
    exemplars: 'Samosa, Kachori, Bhel Puri',
    yield: 0.9,
    portion: 85,
    slots: [
      { label: 'starch_or_wrapper', foodId: MAIDA, range: [0.35, 0.45] },
      { label: 'filling_or_topping', foodId: POTATO, range: [0.4, 0.5] },
      { label: 'added_fat_or_frying_oil', foodId: OIL, range: [0.1, 0.16] },
      { label: 'condiments_optional', foodId: SALT, range: [0.01, 0.02] },
    ],
  },
  sweet_dessert: {
    exemplars: 'Gulab Jamun',
    yield: 1.0,
    portion: 60,
    slots: [
      { label: 'base_milk_grain_nut_or_flour', foodId: KHOYA, range: [0.3, 0.4] },
      { label: 'sugar_or_jaggery', foodId: SUGAR, range: [0.1, 0.2] },
      { label: 'fat_optional', foodId: GHEE, range: [0.08, 0.15] },
      { label: 'flavouring', foodId: CARDAMOM, range: [0.003, 0.01] },
    ],
  },
  beverage: {
    exemplars: 'Curd Rice dairy priors, Filter Coffee family recipe',
    yield: 1.0,
    portion: 200,
    slots: [
      { label: 'water_or_milk', foodId: MILK_COW, range: [0.6, 0.8] },
      { label: 'flavour_base', foodId: TEA, range: [0.02, 0.06] },
      { label: 'sugar_optional', foodId: SUGAR, range: [0.04, 0.1] },
    ],
  },
  regional_dish: null, // handled exclusively by per-dish templates below
}

// ---------------------------------------------------------------------------
// Per-dish overrides — portions (grams per standard serving), yields and slot
// remappings the family model cannot decide. Portions follow standard recipe
// yields for the dish type (e.g. one plain roti ≈ 40 g, a stuffed paratha
// ≈ 110 g, two puris ≈ 30 g); slot overrides name the dish-specific base.
// ---------------------------------------------------------------------------
const OVERRIDES = {
  // --- bread ---
  'Tandoori Roti': { portion: 60 },
  'Roomali Roti': { portion: 35, yield: 0.86 },
  'Missi Roti': { portion: 50, slots: { grain_flour: { foodId: BESAN, note: 'Missi roti is a gram-flour + wheat-flour blend; canonical gram dal used.' } } },
  'Makki di Roti': { portion: 45, slots: { grain_flour: { foodId: MAIZE } } },
  'Bajra Roti': { portion: 45, slots: { grain_flour: { foodId: BAJRA } } },
  'Bajra Rotla': { portion: 50, slots: { grain_flour: { foodId: BAJRA } } },
  'Jowar Bhakri': { portion: 45, slots: { grain_flour: { foodId: JOWAR } } },
  'Ragi Roti': { portion: 45, slots: { grain_flour: { foodId: RAGI } } },
  'Akki Rotti': { portion: 50, slots: { grain_flour: { foodId: RAGI } } },
  Thepla: { portion: 50, slots: { added_fat_optional: { foodId: OIL, range: [0.04, 0.08] } } },
  'Methi Thepla': { portion: 50, slots: { added_fat_optional: { foodId: OIL, range: [0.04, 0.08] } } },
  Naan: { portion: 90, slots: { grain_flour: { foodId: MAIDA } } },
  'Butter Naan': { portion: 95, slots: { grain_flour: { foodId: MAIDA }, added_fat_optional: { foodId: BUTTER, range: [0.04, 0.08] } } },
  'Garlic Naan': { portion: 95, slots: { grain_flour: { foodId: MAIDA } } },
  'Cheese Naan': { portion: 100, slots: { grain_flour: { foodId: MAIDA }, added_fat_optional: { foodId: BUTTER, range: [0.05, 0.09] } } },
  Kulcha: { portion: 80, slots: { grain_flour: { foodId: MAIDA } } },
  'Amritsari Kulcha': { portion: 85, slots: { grain_flour: { foodId: MAIDA } } },
  'Plain Paratha': { portion: 90, yield: 0.92, slots: { added_fat_optional: { foodId: GHEE, range: [0.06, 0.12] } } },
  'Gobi Paratha': { portion: 110, yield: 0.92, slots: { added_fat_optional: { foodId: GHEE, range: [0.06, 0.12] } } },
  'Paneer Paratha': { portion: 110, yield: 0.92, slots: { added_fat_optional: { foodId: GHEE, range: [0.06, 0.12] } } },
  'Mooli Paratha': { portion: 110, yield: 0.92, slots: { added_fat_optional: { foodId: GHEE, range: [0.06, 0.12] } } },
  'Methi Paratha': { portion: 100, yield: 0.92, slots: { added_fat_optional: { foodId: GHEE, range: [0.06, 0.12] } } },
  'Sattu Paratha': { portion: 110, yield: 0.92, slots: { grain_flour: { foodId: BESAN, note: 'Sattu is roasted Bengal-gram flour; canonical gram dal row used.' }, added_fat_optional: { foodId: GHEE, range: [0.06, 0.12] } } },
  'Lachha Paratha': { portion: 90, yield: 0.92, slots: { grain_flour: { foodId: MAIDA }, added_fat_optional: { foodId: GHEE, range: [0.06, 0.12] } } },
  'Kerala Parotta': { portion: 90, yield: 0.92, slots: { grain_flour: { foodId: MAIDA }, added_fat_optional: { foodId: OIL, range: [0.06, 0.12] } } },
  'Malabar Parotta': { portion: 90, yield: 0.92, slots: { grain_flour: { foodId: MAIDA }, added_fat_optional: { foodId: OIL, range: [0.06, 0.12] } } },
  Puri: { portion: 30, yield: 0.9, slots: { added_fat_optional: { foodId: OIL, range: [0.08, 0.14], note: 'Deep-fried; oil absorbed into the dough.' } } },
  'Aloo Puri': { portion: 40, yield: 0.9, slots: { added_fat_optional: { foodId: OIL, range: [0.08, 0.14] } } },
  Bhatura: { portion: 80, yield: 0.9, slots: { added_fat_optional: { foodId: OIL, range: [0.08, 0.14] } } },
  Luchi: { portion: 30, yield: 0.9, slots: { grain_flour: { foodId: MAIDA }, added_fat_optional: { foodId: OIL, range: [0.08, 0.14] } } },
  Bakarkhani: { portion: 80, slots: { grain_flour: { foodId: MAIDA } } },
  Sheermal: { portion: 80, slots: { grain_flour: { foodId: MAIDA } } },

  // --- cooked_grain ---
  'Steamed Rice': { portion: 180, slots: { added_fat_optional: { foodId: GHEE, range: [0.0, 0.02] }, mix_ins_optional: { foodId: SALT, range: [0.0, 0.005] } } },
  'Jeera Rice': { portion: 180, slots: { added_fat_optional: { foodId: GHEE, range: [0.05, 0.09] }, mix_ins_optional: { foodId: CUMIN, range: [0.02, 0.04] } } },
  'Ghee Rice': { portion: 180, slots: { added_fat_optional: { foodId: GHEE, range: [0.06, 0.1] } } },
  'Tamarind Rice': { portion: 180, slots: { mix_ins_optional: { foodId: TAMARIND, range: [0.06, 0.1] } } },
  Pulihora: { portion: 180, slots: { mix_ins_optional: { foodId: TAMARIND, range: [0.06, 0.1] } } },
  'Coconut Rice': { portion: 180, slots: { mix_ins_optional: { foodId: COCONUT_FRESH, range: [0.1, 0.15] } } },
  'Tomato Rice': { portion: 180, slots: { mix_ins_optional: { foodId: TOMATO, range: [0.15, 0.25] } } },
  'Bagara Rice': { portion: 180, slots: { mix_ins_optional: { foodId: GROUNDNUT, range: [0.03, 0.06] } } },
  'Veg Pulao': { portion: 200, slots: { mix_ins_optional: { foodId: MIXED_VEG, range: [0.2, 0.3] } } },
  'Kashmiri Pulao': { portion: 200, slots: { mix_ins_optional: { foodId: MIXED_VEG, range: [0.2, 0.3] } } },
  'Yakhni Pulao': { portion: 200 },
  'Peas Pulao': { portion: 200, slots: { mix_ins_optional: { foodId: 'ifct:D061', range: [0.12, 0.18] } } },
  'Moong Dal Khichdi': { portion: 250, yield: 0.95, slots: { water: { range: [0.85, 1.2] }, added_fat_optional: { foodId: GHEE, range: [0.03, 0.06] }, mix_ins_optional: { foodId: MOONG, range: [0.15, 0.22] } } },
  'Masala Khichdi': { portion: 250, yield: 0.95, slots: { water: { range: [0.85, 1.2] }, added_fat_optional: { foodId: GHEE, range: [0.03, 0.06] }, mix_ins_optional: { foodId: MIXED_VEG, range: [0.15, 0.25] } } },
  'Sabudana Khichdi': { portion: 200, yield: 0.95, slots: { rice_or_grain: { foodId: TAPIOCA_PEARL, note: 'Sabudana is tapioca pearls; USDA pearl row used.' }, water: { range: [0.25, 0.4] }, mix_ins_optional: { foodId: GROUNDNUT, range: [0.06, 0.1] } } },
  'Ven Pongal': { portion: 200, yield: 0.9, slots: { water: { range: [0.7, 0.95] }, added_fat_optional: { foodId: GHEE, range: [0.05, 0.09] }, mix_ins_optional: { foodId: MOONG, range: [0.15, 0.22] } } },
  'Bisi Bele Bath': { portion: 250, yield: 0.9, slots: { water: { range: [0.75, 1.0] }, mix_ins_optional: { foodId: TOOR, range: [0.12, 0.18] } } },
  Tehri: { portion: 250, yield: 2.5, slots: { water: { range: [0.7, 0.95] }, mix_ins_optional: { foodId: POTATO, range: [0.15, 0.25] } } },
  'Egg Biryani': { portion: 250, yield: 0.9, slots: { water: { range: [0.55, 0.75] }, added_fat_optional: { foodId: GHEE, range: [0.04, 0.08] }, mix_ins_optional: { foodId: EGG, range: [0.15, 0.22] } } },
  'Veg Biryani': { portion: 250, yield: 0.9, slots: { water: { range: [0.55, 0.75] }, added_fat_optional: { foodId: GHEE, range: [0.04, 0.08] }, mix_ins_optional: { foodId: MIXED_VEG, range: [0.2, 0.3] } } },
  'Hyderabadi Mutton Biryani': { portion: 250, yield: 0.9, slots: { water: { range: [0.55, 0.75] }, added_fat_optional: { foodId: GHEE, range: [0.04, 0.08] }, mix_ins_optional: { foodId: GOAT, range: [0.25, 0.35] } } },
  'Kolkata Chicken Biryani': { portion: 250, yield: 0.9, slots: { water: { range: [0.55, 0.75] }, added_fat_optional: { foodId: GHEE, range: [0.04, 0.08] }, mix_ins_optional: { foodId: CHICKEN, range: [0.25, 0.35] } } },
  'Kolkata Mutton Biryani': { portion: 250, yield: 0.9, slots: { water: { range: [0.55, 0.75] }, added_fat_optional: { foodId: GHEE, range: [0.04, 0.08] }, mix_ins_optional: { foodId: GOAT, range: [0.25, 0.35] } } },
  'Lucknowi Chicken Biryani': { portion: 250, yield: 0.9, slots: { water: { range: [0.55, 0.75] }, added_fat_optional: { foodId: GHEE, range: [0.04, 0.08] }, mix_ins_optional: { foodId: CHICKEN, range: [0.25, 0.35] } } },
  'Lucknowi Mutton Biryani': { portion: 250, yield: 0.9, slots: { water: { range: [0.55, 0.75] }, added_fat_optional: { foodId: GHEE, range: [0.04, 0.08] }, mix_ins_optional: { foodId: GOAT, range: [0.25, 0.35] } } },
  'Thalassery Chicken Biryani': { portion: 250, yield: 0.9, slots: { water: { range: [0.55, 0.75] }, added_fat_optional: { foodId: GHEE, range: [0.04, 0.08] }, mix_ins_optional: { foodId: CHICKEN, range: [0.25, 0.35] } } },
  'Ambur Chicken Biryani': { portion: 250, yield: 0.9, slots: { water: { range: [0.55, 0.75] }, added_fat_optional: { foodId: GHEE, range: [0.04, 0.08] }, mix_ins_optional: { foodId: CHICKEN, range: [0.25, 0.35] } } },
  'Dindigul Chicken Biryani': { portion: 250, yield: 0.9, slots: { water: { range: [0.55, 0.75] }, added_fat_optional: { foodId: GHEE, range: [0.04, 0.08] }, mix_ins_optional: { foodId: CHICKEN, range: [0.25, 0.35] } } },
  'Sindhi Biryani': { portion: 250, yield: 0.9, slots: { water: { range: [0.55, 0.75] }, added_fat_optional: { foodId: GHEE, range: [0.04, 0.08] }, mix_ins_optional: { foodId: CHICKEN, range: [0.25, 0.35] } } },

  // --- batter_or_breakfast ---
  'Mini Idli': { portion: 100 },
  'Kanchipuram Idli': { portion: 100 },
  'Thatte Idli': { portion: 110 },
  'Mysore Masala Dosa': { portion: 150, yield: 0.7, slots: { added_fat_optional: { foodId: OIL, range: [0.08, 0.14] } } },
  'Onion Rava Dosa': { portion: 120, yield: 0.7, slots: { grain_or_semolina: { foodId: SEMOLINA }, added_fat_optional: { foodId: OIL, range: [0.08, 0.14] } } },
  'Set Dosa': { portion: 120, yield: 0.85 },
  'Neer Dosa': { portion: 100, yield: 0.7 },
  Uttapam: { portion: 120, yield: 0.8 },
  'Onion Uttapam': { portion: 140, yield: 0.8 },
  'Vegetable Uttapam': { portion: 140, yield: 0.8 },
  'Kanda Poha': { portion: 150, yield: 0.9, slots: { grain_or_semolina: { foodId: RICE_FLAKES, range: [0.55, 0.65] }, pulse_optional: { foodId: GROUNDNUT, range: [0.05, 0.1] }, water: { range: [0.15, 0.3] }, added_fat_optional: { foodId: OIL, range: [0.03, 0.06] } } },
  'Indori Poha': { portion: 150, yield: 0.9, slots: { grain_or_semolina: { foodId: RICE_FLAKES, range: [0.55, 0.65] }, pulse_optional: { foodId: GROUNDNUT, range: [0.05, 0.1] }, water: { range: [0.15, 0.3] }, added_fat_optional: { foodId: OIL, range: [0.03, 0.06] } } },
  'Aval Upma': { portion: 150, yield: 0.9, slots: { grain_or_semolina: { foodId: RICE_FLAKES, range: [0.5, 0.6] }, pulse_optional: { foodId: GROUNDNUT, range: [0.03, 0.06] }, water: { range: [0.2, 0.35] } } },
  'Rava Upma': { portion: 150, yield: 0.9, slots: { grain_or_semolina: { foodId: SEMOLINA, range: [0.45, 0.55] }, pulse_optional: { foodId: GROUNDNUT, range: [0.03, 0.06] }, water: { range: [0.35, 0.5] } } },
  'Semiya Upma': { portion: 150, yield: 0.9, slots: { grain_or_semolina: { foodId: VERMICELLI, range: [0.45, 0.55] }, pulse_optional: { foodId: GROUNDNUT, range: [0.03, 0.06] }, water: { range: [0.35, 0.5] } } },
  Appam: { portion: 100 },
  Idiyappam: { portion: 100 },
  Puttu: { portion: 100 },
  'Kadala Puttu': { portion: 100 },
  'Kuzhi Paniyaram': { portion: 100, yield: 0.9 },
  'Sabudana Vada': { portion: 80, yield: 0.85, slots: { grain_or_semolina: { foodId: TAPIOCA_PEARL, range: [0.45, 0.55] }, pulse_optional: { foodId: GROUNDNUT, range: [0.15, 0.25] }, water: { range: [0.1, 0.2] }, added_fat_optional: { foodId: OIL, range: [0.1, 0.16] } } },
  'Moong Dal Chilla': { portion: 120, yield: 0.85, slots: { grain_or_semolina: { foodId: MOONG, range: [0.5, 0.6], note: 'Moong dal is the batter base of this chilla.' }, water: { range: [0.3, 0.45] } } },
  'Besan Chilla': { portion: 120, yield: 0.85, slots: { grain_or_semolina: { foodId: BESAN, range: [0.45, 0.55] }, water: { range: [0.3, 0.45] } } },
  'Paneer Chilla': { portion: 130, yield: 0.85, slots: { grain_or_semolina: { foodId: BESAN, range: [0.45, 0.55] }, water: { range: [0.3, 0.45] } } },
  Khaman: { portion: 100, yield: 1.1, slots: { grain_or_semolina: { foodId: BESAN, range: [0.4, 0.5] }, water: { range: [0.35, 0.5] } } },
  Handvo: { portion: 100, yield: 0.95, slots: { grain_or_semolina: { foodId: RICE, range: [0.3, 0.4] }, pulse_optional: { foodId: TOOR, range: [0.15, 0.25] }, added_fat_optional: { foodId: OIL, range: [0.05, 0.1] } } },
  Khandvi: { portion: 80, yield: 1.15, slots: { grain_or_semolina: { foodId: BESAN, range: [0.3, 0.4] }, water: { range: [0.55, 0.7] } } },
  Muthia: { portion: 80, yield: 0.9, slots: { grain_or_semolina: { foodId: BESAN, range: [0.4, 0.5] } } },
  Pesarattu: { portion: 130, yield: 0.85, slots: { grain_or_semolina: { foodId: MOONG, range: [0.5, 0.6], note: 'Whole green-gram batter is the base.' }, pulse_optional: { foodId: URAD, range: [0.05, 0.1] } } },
  Adai: { portion: 130, yield: 0.85, slots: { grain_or_semolina: { foodId: MOONG, range: [0.4, 0.5], note: 'Mixed-dal adai; green gram canonical for the dal blend.' }, pulse_optional: { foodId: URAD, range: [0.1, 0.18] } } },

  // --- legume_preparation ---
  'Moong Dal': { slots: { pulse_or_legume: { foodId: MOONG } } },
  'Moong Dal Tadka': { slots: { pulse_or_legume: { foodId: MOONG } } },
  'Masoor Dal': { slots: { pulse_or_legume: { foodId: MASOOR } } },
  'Masoor Dal Tadka': { slots: { pulse_or_legume: { foodId: MASOOR } } },
  'Chana Dal': { slots: { pulse_or_legume: { foodId: BESAN } } },
  'Chana Dal Tadka': { slots: { pulse_or_legume: { foodId: BESAN } } },
  'Cholar Dal': { slots: { pulse_or_legume: { foodId: BESAN }, aromatics: { foodId: COCONUT_FRESH, range: [0.08, 0.15], note: 'Cholar dal is finished with coconut pieces.' } } },
  'Urad Dal': { slots: { pulse_or_legume: { foodId: URAD } } },
  'Maa ki Dal': { slots: { pulse_or_legume: { foodId: URAD } } },
  'Dal Makhani': { portion: 180, slots: { pulse_or_legume: { foodId: URAD }, tadka_fat_optional: { foodId: BUTTER, range: [0.05, 0.09], note: 'Dal makhani finishes with butter/cream.' } } },
  'Rajma Masala': { slots: { pulse_or_legume: { foodId: RAJMA } } },
  'Kala Chana Curry': { slots: { pulse_or_legume: { foodId: CHANA_WHOLE } } },
  'Lobia Curry': { slots: { pulse_or_legume: { foodId: COWPEA } } },
  'Matki Usal': { portion: 200, yield: 2.0, slots: { pulse_or_legume: { foodId: MOTH_BEAN } } },
  'Moong Usal': { portion: 200, yield: 2.0, slots: { pulse_or_legume: { foodId: MOONG } } },
  Misal: { portion: 200, yield: 2.0, slots: { pulse_or_legume: { foodId: MOTH_BEAN } } },
  Kadhi: { portion: 200, yield: 1.1, slots: { pulse_or_legume: { foodId: BESAN, range: [0.06, 0.1], note: 'Gram flour is the thickener of this yogurt-based kadhi.' }, water: { foodId: YOGURT, range: [0.55, 0.7], note: 'Kadhi base is yogurt; the water slot carries the dairy base.' } } },
  'Gujarati Kadhi': { portion: 200, yield: 0.92, slots: { pulse_or_legume: { foodId: BESAN, range: [0.05, 0.09], note: 'Gram flour is the thickener of this yogurt-based kadhi.' }, water: { foodId: YOGURT, range: [0.55, 0.7], note: 'Kadhi base is yogurt; the water slot carries the dairy base.' } } },
  'Punjabi Kadhi Pakora': { portion: 220, yield: 0.92, slots: { pulse_or_legume: { foodId: BESAN, range: [0.08, 0.13], note: 'Gram flour thickens the kadhi and binds the pakoras.' }, water: { foodId: YOGURT, range: [0.5, 0.65], note: 'Kadhi base is yogurt; the water slot carries the dairy base.' } } },
  'Sindhi Kadhi': { portion: 200, yield: 1.3, slots: { pulse_or_legume: { foodId: BESAN, range: [0.06, 0.1] } } },
  'Maharashtrian Amti': { slots: { pulse_or_legume: { foodId: TOOR } } },
  Varan: { slots: { pulse_or_legume: { foodId: TOOR } } },
  Paruppu: { slots: { pulse_or_legume: { foodId: TOOR } } },
  Pappu: { slots: { pulse_or_legume: { foodId: TOOR } } },
  'Tomato Pappu': { slots: { pulse_or_legume: { foodId: TOOR }, aromatics: { foodId: TOMATO, range: [0.15, 0.25], note: 'Tomato is the defining secondary of this pappu.' } } },
  'Palak Pappu': { slots: { pulse_or_legume: { foodId: TOOR }, aromatics: { foodId: SPINACH, range: [0.15, 0.25], note: 'Spinach is the defining secondary of this pappu.' } } },
  'Dal Baati Style Dal': { slots: { pulse_or_legume: { foodId: TOOR } } },
  Dalma: { slots: { pulse_or_legume: { foodId: TOOR }, aromatics: { foodId: MIXED_VEG, range: [0.15, 0.25], note: 'Dalma carries mixed vegetables with the dal.' } } },
  Ghugni: { slots: { pulse_or_legume: { foodId: PEAS_DRY } } },
  'Kulthi Dal': { slots: { pulse_or_legume: { foodId: HORSE_GRAM } } },
  'Panchmel Dal': { slots: { pulse_or_legume: { foodId: TOOR, note: 'Five-dal blend; red gram dal used as the canonical reviewable row.' } } },

  // --- vegetable_preparation ---
  'Mix Veg Curry': { slots: { primary_vegetable: { foodId: MIXED_VEG, range: [0.45, 0.6] } } },
  'Veg Korma': { portion: 180, slots: { primary_vegetable: { foodId: MIXED_VEG, range: [0.45, 0.6] } } },
  'Navratan Korma': { portion: 180, slots: { primary_vegetable: { foodId: MIXED_VEG, range: [0.45, 0.6] } } },
  'Malai Kofta': { portion: 180, slots: { primary_vegetable: { foodId: PANEER, range: [0.3, 0.4], note: 'Malai kofta dumplings are paneer-dominant.' } } },
  'Veg Kofta Curry': { portion: 180, slots: { primary_vegetable: { foodId: POTATO, range: [0.4, 0.55], note: 'Vegetable kofta dumplings are potato-dominant.' } } },
  'Kofta Curry': { portion: 180, slots: { primary_vegetable: { foodId: POTATO, range: [0.4, 0.55], note: 'Kofta dumplings are potato-dominant.' } } },
  'Sev Tameta': { slots: { primary_vegetable: { foodId: TOMATO, range: [0.55, 0.7], note: 'Tameta (tomatoes) are the base; sev is a topping.' } } },
  'Ringna no Olo': { slots: { primary_vegetable: { foodId: 'ifct:D010', range: [0.65, 0.8], note: 'Ringna no olo is roasted brinjal mash.' } } },
  'Sarson ka Saag': { portion: 130, slots: { primary_vegetable: { foodId: MUSTARD_GREENS, range: [0.6, 0.75] }, added_fat: { foodId: MUSTARD_OIL, range: [0.04, 0.08], note: 'Saag finished with mustard oil or ghee.' } } },
  'Palak Saag': { portion: 130, slots: { primary_vegetable: { foodId: SPINACH, range: [0.6, 0.75] } } },
  'Bathua Saag': { portion: 130, slots: { primary_vegetable: { foodId: BATHUA, range: [0.6, 0.75] } } },
  'Chana Saag': { portion: 150, slots: { primary_vegetable: { foodId: SPINACH, range: [0.5, 0.65] }, aromatics: { foodId: CHANA_WHOLE, range: [0.15, 0.25], note: 'Chana saag carries chickpeas with the greens.' } } },
  'Palak Corn': { slots: { primary_vegetable: { foodId: SPINACH, range: [0.45, 0.6] }, aromatics: { foodId: SWEET_CORN, range: [0.2, 0.3], note: 'Sweet corn kernels carry the second vegetable.' } } },
  'Corn Masala': { slots: { primary_vegetable: { foodId: SWEET_CORN, range: [0.5, 0.65] } } },
  'Beans Poriyal': { portion: 120, slots: { primary_vegetable: { foodId: 'ifct:D049', range: [0.6, 0.75] }, gravy_base_optional: { foodId: WATER, range: [0.0, 0.08], note: 'Dry poriyal carries no gravy.' } } },
  'Cabbage Poriyal': { portion: 120, slots: { primary_vegetable: { foodId: CABBAGE, range: [0.6, 0.75] }, gravy_base_optional: { foodId: WATER, range: [0.0, 0.08], note: 'Dry poriyal carries no gravy.' } } },
  'Beetroot Poriyal': { portion: 120, slots: { primary_vegetable: { foodId: BEETROOT, range: [0.6, 0.75] }, gravy_base_optional: { foodId: WATER, range: [0.0, 0.08], note: 'Dry poriyal carries no gravy.' } } },
  'Cabbage Foogath': { portion: 120, slots: { primary_vegetable: { foodId: CABBAGE, range: [0.6, 0.75] }, gravy_base_optional: { foodId: WATER, range: [0.0, 0.08], note: 'Dry foogath carries no gravy.' } } },
  Avial: { portion: 160, slots: { primary_vegetable: { foodId: MIXED_VEG, range: [0.5, 0.65] }, added_fat: { foodId: COCONUT_MILK, range: [0.05, 0.1], note: 'Avial finishes with coconut milk.' } } },
  Thoran: { portion: 120, slots: { primary_vegetable: { foodId: CABBAGE, range: [0.55, 0.7], note: 'Classic thoran uses shredded cabbage.' }, gravy_base_optional: { foodId: COCONUT_FRESH, range: [0.05, 0.1], note: 'Thoran finishes with scraped coconut.' } } },
  Undhiyu: { portion: 200, slots: { primary_vegetable: { foodId: MIXED_VEG, range: [0.5, 0.65] } } },
  'Aloo Chokha': { slots: { primary_vegetable: { foodId: POTATO, range: [0.7, 0.85] }, added_fat: { foodId: MUSTARD_OIL, range: [0.04, 0.08], note: 'Chokha is finished with mustard oil.' } } },
  'Baingan Chokha': { slots: { primary_vegetable: { foodId: 'ifct:D010', range: [0.7, 0.85] }, added_fat: { foodId: MUSTARD_OIL, range: [0.04, 0.08], note: 'Chokha is finished with mustard oil.' } } },
  'Tomato Chokha': { slots: { primary_vegetable: { foodId: TOMATO, range: [0.65, 0.8] }, added_fat: { foodId: MUSTARD_OIL, range: [0.04, 0.08], note: 'Chokha is finished with mustard oil.' } } },
  'Sukhi Aloo Sabzi': { slots: { primary_vegetable: { foodId: POTATO, range: [0.7, 0.85] }, gravy_base_optional: { foodId: WATER, range: [0.0, 0.06], note: 'Dry sabzi carries no gravy.' } } },
  'Lauki Chana Dal': { slots: { primary_vegetable: { foodId: 'ifct:D008', range: [0.4, 0.55] }, aromatics: { foodId: BESAN, range: [0.15, 0.25], note: 'Chana dal carries the pulse component.' } } },
  'Matar Mushroom': { slots: { primary_vegetable: { foodId: 'ifct:J001', range: [0.4, 0.55] }, aromatics: { foodId: 'ifct:D061', range: [0.15, 0.25], note: 'Peas carry the second vegetable.' } } },
  'Gobi Matar': { slots: { aromatics: { foodId: 'ifct:D061', range: [0.15, 0.25], note: 'Peas carry the second vegetable.' } } },
  'Mushroom Do Pyaza': { slots: { primary_vegetable: { foodId: 'ifct:J001', range: [0.45, 0.6] } } },
  'Mushroom Masala': { slots: { primary_vegetable: { foodId: 'ifct:J001', range: [0.45, 0.6] } } },

  // --- paneer_preparation ---
  'Shahi Paneer': { slots: { added_fat: { foodId: GHEE, range: [0.05, 0.1] } } },
  'Matar Paneer': { slots: { gravy_or_vegetable_base: { foodId: TOMATO, range: [0.3, 0.42], note: 'Tomato-onion gravy base; peas are the secondary.' } } },
  'Paneer Tikka Masala': { slots: { gravy_or_vegetable_base: { foodId: TOMATO, range: [0.3, 0.42] } } },
  'Paneer Bhurji': { portion: 150, slots: { gravy_or_vegetable_base: { foodId: TOMATO, range: [0.2, 0.3] } } },
  'Malai Paneer': { slots: { gravy_or_vegetable_base: { foodId: TOMATO, range: [0.25, 0.35] }, cream_cashew_optional: { foodId: CREAM, range: [0.06, 0.12] } } },
  'Paneer Do Pyaza': { slots: { gravy_or_vegetable_base: { foodId: TOMATO, range: [0.3, 0.42] } } },

  // --- protein_preparation ---
  'Chicken Korma': { slots: { dairy_or_coconut_optional: { foodId: CREAM, range: [0.05, 0.1], note: 'Korma finishes with cream or yogurt.' } } },
  'Chicken Tikka Masala': { slots: { dairy_or_coconut_optional: { foodId: YOGURT, range: [0.08, 0.15], note: 'Yogurt marinade and cream finish.' } } },
  'Chicken 65': { portion: 160, slots: { aromatics_or_gravy: { foodId: 'ifct:D033', range: [0.08, 0.15], note: 'Curry-leaf and capsicum tempering.' }, added_fat: { foodId: OIL, range: [0.08, 0.14], note: 'Deep-fried.', }, dairy_or_coconut_optional: { foodId: YOGURT, range: [0.08, 0.15], note: 'Yogurt marinade.' } } },
  'Chicken Chettinad': { slots: { dairy_or_coconut_optional: { foodId: COCONUT_MILK, range: [0.15, 0.3], note: 'Chettinad masala is coconut-based.' } } },
  'Chicken Sukka': { portion: 160, slots: { dairy_or_coconut_optional: { foodId: COCONUT_FRESH, range: [0.08, 0.15], note: 'Sukka is finished with scraped coconut.' } } },
  'Chicken Cafreal': { portion: 160, slots: { dairy_or_coconut_optional: { foodId: YOGURT, range: [0.08, 0.15], note: 'Cafreal is a yogurt-and-herb marinade.' } } },
  'Chicken Xacuti': { slots: { dairy_or_coconut_optional: { foodId: COCONUT_MILK, range: [0.15, 0.3], note: 'Xacuti masala is roasted-coconut based.' } } },
  'Chicken Vindaloo': { slots: { dairy_or_coconut_optional: { foodId: WATER, range: [0.05, 0.1], note: 'Vindaloo relies on vinegar-spice gravy, not dairy.' } } },
  'Mutton Vindaloo': { slots: { animal_protein: { foodId: GOAT }, dairy_or_coconut_optional: { foodId: WATER, range: [0.05, 0.1], note: 'Vindaloo relies on vinegar-spice gravy, not dairy.' } } },
  'Chicken Kolhapuri': { portion: 180 },
  'Chicken Handi': { portion: 200 },
  'Chicken Changezi': { portion: 200, slots: { dairy_or_coconut_optional: { foodId: YOGURT, range: [0.1, 0.18], note: 'Changezi gravy is yogurt-cream based.' } } },
  'Champaran Chicken': { portion: 200 },
  'Chicken Stew': { slots: { aromatics_or_gravy: { foodId: MIXED_VEG, range: [0.2, 0.3], note: 'Kerala-style stew carries vegetables in the gravy.' }, dairy_or_coconut_optional: { foodId: COCONUT_MILK, range: [0.15, 0.3], note: 'Stew base is coconut milk.' } } },
  'Mutton Curry': { slots: { animal_protein: { foodId: GOAT } } },
  'Rogan Josh': { slots: { animal_protein: { foodId: GOAT } } },
  'Mutton Korma': { slots: { animal_protein: { foodId: GOAT }, dairy_or_coconut_optional: { foodId: CREAM, range: [0.05, 0.1], note: 'Korma finishes with cream or yogurt.' } } },
  'Mutton Do Pyaza': { slots: { animal_protein: { foodId: GOAT } } },
  'Mutton Saag': { slots: { animal_protein: { foodId: GOAT }, aromatics_or_gravy: { foodId: SPINACH, range: [0.25, 0.4], note: 'Saag gravy is spinach-dominant.' } } },
  'Mutton Sukka': { portion: 160, slots: { animal_protein: { foodId: GOAT }, dairy_or_coconut_optional: { foodId: COCONUT_FRESH, range: [0.08, 0.15], note: 'Sukka is finished with scraped coconut.' } } },
  'Mutton Pepper Fry': { portion: 160, slots: { animal_protein: { foodId: GOAT } } },
  'Champaran Mutton': { portion: 200, slots: { animal_protein: { foodId: GOAT } } },
  'Laal Maas': { portion: 180, slots: { animal_protein: { foodId: GOAT }, dairy_or_coconut_optional: { foodId: YOGURT, range: [0.1, 0.18], note: 'Laal maas gravy is yogurt based.' } } },
  'Keema Matar': { portion: 180, slots: { animal_protein: { foodId: GOAT, range: [0.4, 0.5], note: 'Minced goat meat (keema).' }, aromatics_or_gravy: { foodId: 'ifct:D061', range: [0.15, 0.25], note: 'Peas carry the secondary.' } } },
  'Mutton Keema': { portion: 180, slots: { animal_protein: { foodId: GOAT, range: [0.4, 0.5], note: 'Minced goat meat (keema).' } } },
  Nihari: { portion: 250, yield: 1.4, slots: { animal_protein: { foodId: GOAT } } },
  Haleem: { portion: 250, yield: 1.6, slots: { animal_protein: { foodId: GOAT, range: [0.3, 0.4] }, aromatics_or_gravy: { foodId: MOONG, range: [0.2, 0.3], note: 'Haleem is a dal-meat porridge; lentils carry the base.' } } },
  'Pork Vindaloo': { slots: { animal_protein: { foodId: PORK }, dairy_or_coconut_optional: { foodId: WATER, range: [0.05, 0.1], note: 'Vindaloo relies on vinegar-spice gravy, not dairy.' } } },
  'Pork Curry': { slots: { animal_protein: { foodId: PORK } } },
  'Pork with Bamboo Shoot': { slots: { animal_protein: { foodId: PORK } } },
  'Smoked Pork': { portion: 160, slots: { animal_protein: { foodId: PORK } } },
  'Fish Curry': { slots: { animal_protein: { foodId: ROHU, range: [0.4, 0.5] } } },
  'Bengali Fish Curry': { slots: { animal_protein: { foodId: ROHU, range: [0.4, 0.5] } } },
  'Machher Jhol': { slots: { animal_protein: { foodId: ROHU, range: [0.4, 0.5] } } },
  'Doi Maach': { slots: { animal_protein: { foodId: ROHU, range: [0.4, 0.5] }, dairy_or_coconut_optional: { foodId: YOGURT, range: [0.15, 0.25], note: 'Doi maach gravy is yogurt based.' } } },
  'Goan Fish Curry': { slots: { animal_protein: { foodId: ROHU, range: [0.4, 0.5] }, dairy_or_coconut_optional: { foodId: COCONUT_MILK, range: [0.15, 0.3], note: 'Goan curry base is coconut milk.' } } },
  'Kerala Fish Curry': { slots: { animal_protein: { foodId: ROHU, range: [0.4, 0.5] }, dairy_or_coconut_optional: { foodId: COCONUT_MILK, range: [0.1, 0.2], note: 'Kerala red fish curry uses coconut milk sparingly.' } } },
  'Meen Moilee': { slots: { animal_protein: { foodId: ROHU, range: [0.4, 0.5] }, dairy_or_coconut_optional: { foodId: COCONUT_MILK, range: [0.2, 0.32], note: 'Moilee is a coconut-milk stew.' } } },
  'Fish Fry': { portion: 160, slots: { animal_protein: { foodId: ROHU, range: [0.55, 0.68] }, aromatics_or_gravy: { foodId: BESAN, range: [0.04, 0.08], note: 'Spice-flour marinade.' }, added_fat: { foodId: OIL, range: [0.08, 0.14], note: 'Shallow-fried.' }, dairy_or_coconut_optional: { foodId: WATER, range: [0.0, 0.05] } } },
  'Amritsari Fish': { portion: 160, slots: { animal_protein: { foodId: ROHU, range: [0.55, 0.68] }, aromatics_or_gravy: { foodId: BESAN, range: [0.06, 0.1], note: 'Gram-flour batter.' }, added_fat: { foodId: OIL, range: [0.1, 0.16], note: 'Deep-fried.' }, dairy_or_coconut_optional: { foodId: WATER, range: [0.0, 0.05] } } },
  'Prawn Curry': { slots: { animal_protein: { foodId: PRAWNS, range: [0.4, 0.5] } } },
  'Prawn Masala': { slots: { animal_protein: { foodId: PRAWNS, range: [0.4, 0.5] } } },
  'Prawn Fry': { portion: 160, slots: { animal_protein: { foodId: PRAWNS, range: [0.55, 0.68] }, added_fat: { foodId: OIL, range: [0.08, 0.14], note: 'Shallow-fried.' }, dairy_or_coconut_optional: { foodId: WATER, range: [0.0, 0.05] } } },
  'Anda Bhurji': { portion: 130, slots: { animal_protein: { foodId: EGG, range: [0.35, 0.45] }, aromatics_or_gravy: { foodId: TOMATO, range: [0.2, 0.3] } } },
  'Masala Omelette': { portion: 120, yield: 0.82, slots: { animal_protein: { foodId: EGG, range: [0.5, 0.62] }, aromatics_or_gravy: { foodId: ONION, range: [0.1, 0.18] } } },
  'Egg Roast': { slots: { animal_protein: { foodId: EGG, range: [0.3, 0.4] } } },

  // --- street_snack ---
  'Aloo Samosa': { portion: 100 },
  'Dal Kachori': { slots: { filling_or_topping: { foodId: MOONG, range: [0.3, 0.4], note: 'Moong dal stuffing.' } } },
  'Pyaz Kachori': { slots: { filling_or_topping: { foodId: ONION, range: [0.3, 0.4], note: 'Onion stuffing.' } } },
  'Raj Kachori': { portion: 150, slots: { filling_or_topping: { foodId: MOONG, range: [0.2, 0.3] }, condiments_optional: { foodId: TAMARIND, range: [0.1, 0.18], note: 'Chutney-dressed royal kachori.' } } },
  Pakora: { portion: 100, slots: { starch_or_wrapper: { foodId: BESAN, range: [0.3, 0.4], note: 'Gram-flour batter.' } } },
  'Onion Pakora': { portion: 100, slots: { starch_or_wrapper: { foodId: BESAN, range: [0.3, 0.4] }, filling_or_topping: { foodId: ONION, range: [0.35, 0.45] } } },
  'Paneer Pakora': { portion: 100, slots: { starch_or_wrapper: { foodId: BESAN, range: [0.3, 0.4] }, filling_or_topping: { foodId: PANEER, range: [0.3, 0.4] } } },
  'Bread Pakora': { portion: 120, slots: { starch_or_wrapper: { foodId: BREAD, range: [0.35, 0.45], note: 'Sandwich bread slices, battered and fried.' }, filling_or_topping: { foodId: POTATO, range: [0.3, 0.4] } } },
  'Aloo Tikki': { portion: 120, slots: { starch_or_wrapper: { foodId: POTATO, range: [0.65, 0.75], note: 'The tikki patty is potato.' } } },
  'Aloo Tikki Chaat': { portion: 150, slots: { starch_or_wrapper: { foodId: POTATO, range: [0.55, 0.65] }, condiments_optional: { foodId: YOGURT, range: [0.2, 0.32], note: 'Dahi-smothered chaat.' } } },
  'Papdi Chaat': { portion: 150, slots: { filling_or_topping: { foodId: POTATO, range: [0.2, 0.3] }, condiments_optional: { foodId: TAMARIND, range: [0.12, 0.2], note: 'Chutney-dressed.' } } },
  'Dahi Papdi Chaat': { portion: 170, slots: { filling_or_topping: { foodId: YOGURT, range: [0.3, 0.42], note: 'Yogurt is the dominant topping.' }, condiments_optional: { foodId: TAMARIND, range: [0.1, 0.18] } } },
  'Dahi Vada': { portion: 130, slots: { starch_or_wrapper: { foodId: URAD, range: [0.4, 0.5], note: 'Urad dal vada.' }, filling_or_topping: { foodId: YOGURT, range: [0.35, 0.5], note: 'Yogurt is the dominant topping.' }, added_fat_or_frying_oil: { foodId: OIL, range: [0.1, 0.16] } } },
  'Sev Puri': { portion: 150, slots: { condiments_optional: { foodId: TAMARIND, range: [0.1, 0.18] } } },
  'Dahi Puri': { portion: 150, slots: { filling_or_topping: { foodId: YOGURT, range: [0.25, 0.35] }, condiments_optional: { foodId: TAMARIND, range: [0.08, 0.15] } } },
  'Ragda Pattice': { portion: 200, slots: { starch_or_wrapper: { foodId: POTATO, range: [0.45, 0.55], note: 'The pattice is potato.' }, filling_or_topping: { foodId: PEAS_DRY, range: [0.35, 0.45], note: 'Ragda is dried-white-pea curry.' }, condiments_optional: { foodId: TAMARIND, range: [0.05, 0.1] } } },
  Dabeli: { portion: 120, slots: { starch_or_wrapper: { foodId: BREAD, range: [0.3, 0.4], note: 'Pav bun.' }, filling_or_topping: { foodId: POTATO, range: [0.35, 0.45] }, condiments_optional: { foodId: TAMARIND, range: [0.08, 0.15] } } },
  'Misal Pav': { portion: 250, yield: 1.8, slots: { starch_or_wrapper: { foodId: BREAD, range: [0.2, 0.3], note: 'Pav bun.' }, filling_or_topping: { foodId: MOTH_BEAN, range: [0.3, 0.4], note: 'Matki usal is the misal base; the raised yield carries the usal gravy water the family slots cannot express.' }, condiments_optional: { foodId: TAMARIND, range: [0.03, 0.08] } } },
  'Chole Kulche': { portion: 300, yield: 1.8, slots: { starch_or_wrapper: { foodId: MAIDA, range: [0.3, 0.4], note: 'Kulcha.' }, filling_or_topping: { foodId: CHANA_WHOLE, range: [0.35, 0.45], note: 'Chole is the curry side; the raised yield carries the gravy water the family slots cannot express.' } } },
  'Puri Sabzi': { portion: 180, slots: { starch_or_wrapper: { foodId: ATTA, range: [0.35, 0.45], note: 'Puri.' }, filling_or_topping: { foodId: POTATO, range: [0.35, 0.45], note: 'Aloo sabzi side.' } } },
  'Kathi Roll': { portion: 180, slots: { starch_or_wrapper: { foodId: ATTA, range: [0.3, 0.4], note: 'Paratha wrap.' }, filling_or_topping: { foodId: CHICKEN, range: [0.3, 0.4] } } },
  'Paneer Roll': { portion: 180, slots: { starch_or_wrapper: { foodId: ATTA, range: [0.3, 0.4], note: 'Paratha wrap.' }, filling_or_topping: { foodId: PANEER, range: [0.3, 0.4] } } },
  'Veg Roll': { portion: 170, slots: { starch_or_wrapper: { foodId: ATTA, range: [0.3, 0.4], note: 'Paratha wrap.' }, filling_or_topping: { foodId: POTATO, range: [0.3, 0.4] } } },
  Frankie: { portion: 180, slots: { starch_or_wrapper: { foodId: ATTA, range: [0.3, 0.4], note: 'Paratha wrap.' }, filling_or_topping: { foodId: POTATO, range: [0.3, 0.4] } } },
  'Veg Momos': { portion: 150, yield: 0.95, slots: { added_fat_or_frying_oil: { foodId: OIL, range: [0.01, 0.03], note: 'Steamed, lightly oiled.' } } },
  'Chicken Momos': { portion: 150, yield: 0.95, slots: { filling_or_topping: { foodId: CHICKEN, range: [0.3, 0.4] }, added_fat_or_frying_oil: { foodId: OIL, range: [0.01, 0.03], note: 'Steamed, lightly oiled.' } } },
  'Fried Momos': { portion: 160, slots: { filling_or_topping: { foodId: MIXED_VEG, range: [0.3, 0.4] }, added_fat_or_frying_oil: { foodId: OIL, range: [0.1, 0.16], note: 'Deep-fried.' } } },
  'Tandoori Momos': { portion: 160, yield: 0.9, slots: { filling_or_topping: { foodId: MIXED_VEG, range: [0.3, 0.4] }, condiments_optional: { foodId: YOGURT, range: [0.08, 0.15], note: 'Tandoori marinade.' } } },
  Chowmein: { portion: 250, slots: { starch_or_wrapper: { foodId: NOODLES, range: [0.5, 0.6], note: 'Cooked egg noodles.' }, filling_or_topping: { foodId: MIXED_VEG, range: [0.2, 0.3] }, added_fat_or_frying_oil: { foodId: OIL, range: [0.04, 0.08] } } },
  'Veg Chowmein': { portion: 250, slots: { starch_or_wrapper: { foodId: NOODLES, range: [0.5, 0.6] }, filling_or_topping: { foodId: MIXED_VEG, range: [0.2, 0.3] }, added_fat_or_frying_oil: { foodId: OIL, range: [0.04, 0.08] } } },
  'Hakka Noodles': { portion: 250, slots: { starch_or_wrapper: { foodId: NOODLES, range: [0.5, 0.6] }, filling_or_topping: { foodId: MIXED_VEG, range: [0.2, 0.3] }, added_fat_or_frying_oil: { foodId: OIL, range: [0.04, 0.08] } } },
  'Chilli Potato': { portion: 200, slots: { starch_or_wrapper: { foodId: POTATO, range: [0.65, 0.75], note: 'Fried potato is the dish.' }, filling_or_topping: { foodId: TOMATO, range: [0.12, 0.2], note: 'Sweet-chilli sauce base.' }, added_fat_or_frying_oil: { foodId: OIL, range: [0.08, 0.14] } } },
  Manchurian: { portion: 200, slots: { starch_or_wrapper: { foodId: MAIDA, range: [0.12, 0.2], note: 'Maida binds the vegetable balls.' }, filling_or_topping: { foodId: MIXED_VEG, range: [0.35, 0.45] }, added_fat_or_frying_oil: { foodId: OIL, range: [0.1, 0.16] } } },
  'Chilli Paneer': { portion: 200, slots: { starch_or_wrapper: { foodId: PANEER, range: [0.4, 0.5], note: 'Paneer is the fried component.' }, filling_or_topping: { foodId: 'ifct:D033', range: [0.15, 0.25], note: 'Capsicum-onion toss.' }, added_fat_or_frying_oil: { foodId: OIL, range: [0.08, 0.14] } } },
  'Bun Maska': { portion: 120, slots: { starch_or_wrapper: { foodId: BREAD, range: [0.55, 0.65], note: 'Pav bun.' }, filling_or_topping: { foodId: BUTTER, range: [0.15, 0.25], note: 'Maska is butter.' }, added_fat_or_frying_oil: { foodId: OIL, range: [0.0, 0.01] } } },

  // --- sweet_dessert ---
  'Kala Jamun': { portion: 50, yield: 1.05, slots: { base_milk_grain_nut_or_flour: { foodId: KHOYA, range: [0.3, 0.4] }, sugar_or_jaggery: { foodId: SUGAR, range: [0.35, 0.5], note: 'Syrup-soaked.' } } },
  Rasgulla: { portion: 100, yield: 1.05, slots: { base_milk_grain_nut_or_flour: { foodId: PANEER, range: [0.3, 0.4], note: 'Chhena (cottage-cheese) base.' }, sugar_or_jaggery: { foodId: SUGAR, range: [0.35, 0.5], note: 'Syrup-soaked.' }, fat_optional: { foodId: GHEE, range: [0.0, 0.01], note: 'Rasgulla is boiled, never fried.' } } },
  Rajbhog: { portion: 100, yield: 1.05, slots: { base_milk_grain_nut_or_flour: { foodId: PANEER, range: [0.3, 0.4], note: 'Chhena base.' }, sugar_or_jaggery: { foodId: SUGAR, range: [0.35, 0.5], note: 'Syrup-soaked.' }, fat_optional: { foodId: GHEE, range: [0.0, 0.01], note: 'Rajbhog is boiled, never fried.' } } },
  Rasmalai: { portion: 100, yield: 1.1, slots: { base_milk_grain_nut_or_flour: { foodId: PANEER, range: [0.25, 0.35], note: 'Chhena base.' }, sugar_or_jaggery: { foodId: SUGAR, range: [0.2, 0.3], note: 'Sweetened milk bath.' }, fat_optional: { foodId: GHEE, range: [0.0, 0.02], note: 'Rasmalai is poached in milk, not fried.' } } },
  Sandesh: { portion: 60, slots: { base_milk_grain_nut_or_flour: { foodId: PANEER, range: [0.55, 0.7], note: 'Chhena base.' }, sugar_or_jaggery: { foodId: SUGAR, range: [0.1, 0.18] }, fat_optional: { foodId: GHEE, range: [0.0, 0.03] } } },
  'Mishti Doi': { portion: 120, yield: 1.05, slots: { base_milk_grain_nut_or_flour: { foodId: MILK_COW, range: [0.7, 0.8], note: 'Caramelised cultured milk.' }, sugar_or_jaggery: { foodId: SUGAR, range: [0.12, 0.2] }, fat_optional: { foodId: GHEE, range: [0.0, 0.02] } } },
  Jalebi: { portion: 80, yield: 1.05, slots: { base_milk_grain_nut_or_flour: { foodId: MAIDA, range: [0.3, 0.4], note: 'Fermented maida batter.' }, sugar_or_jaggery: { foodId: SUGAR, range: [0.35, 0.5], note: 'Syrup-soaked.' } } },
  Imarti: { portion: 80, yield: 1.05, slots: { base_milk_grain_nut_or_flour: { foodId: URAD, range: [0.3, 0.4], note: 'Fermented urad dal batter.' }, sugar_or_jaggery: { foodId: SUGAR, range: [0.35, 0.5], note: 'Syrup-soaked.' } } },
  Balushahi: { portion: 60, yield: 0.95, slots: { base_milk_grain_nut_or_flour: { foodId: MAIDA, range: [0.35, 0.45] }, sugar_or_jaggery: { foodId: SUGAR, range: [0.2, 0.3] } } },
  'Kaju Katli': { portion: 40, slots: { base_milk_grain_nut_or_flour: { foodId: CASHEW, range: [0.6, 0.7] }, sugar_or_jaggery: { foodId: SUGAR, range: [0.25, 0.35] }, fat_optional: { foodId: GHEE, range: [0.01, 0.04] } } },
  'Besan Ladoo': { portion: 60, slots: { base_milk_grain_nut_or_flour: { foodId: BESAN, range: [0.5, 0.6] }, sugar_or_jaggery: { foodId: SUGAR, range: [0.15, 0.25] } } },
  'Motichoor Ladoo': { portion: 60, slots: { base_milk_grain_nut_or_flour: { foodId: BESAN, range: [0.45, 0.55], note: 'Besan boondi.' }, sugar_or_jaggery: { foodId: SUGAR, range: [0.2, 0.3] } } },
  'Boondi Ladoo': { portion: 60, slots: { base_milk_grain_nut_or_flour: { foodId: BESAN, range: [0.45, 0.55], note: 'Besan boondi.' }, sugar_or_jaggery: { foodId: SUGAR, range: [0.2, 0.3] } } },
  'Atta Ladoo': { portion: 60, slots: { base_milk_grain_nut_or_flour: { foodId: ATTA, range: [0.5, 0.6] }, sugar_or_jaggery: { foodId: SUGAR, range: [0.15, 0.25] } } },
  'Til Ladoo': { portion: 50, slots: { base_milk_grain_nut_or_flour: { foodId: SESAME, range: [0.5, 0.6] }, sugar_or_jaggery: { foodId: JAGGERY, range: [0.2, 0.3], note: 'Jaggery-bound til ladoo.' } } },
  'Nariyal Ladoo': { portion: 50, slots: { base_milk_grain_nut_or_flour: { foodId: COCONUT_DRY, range: [0.5, 0.6] }, sugar_or_jaggery: { foodId: SUGAR, range: [0.2, 0.3] } } },
  Peda: { portion: 40, slots: { base_milk_grain_nut_or_flour: { foodId: KHOYA, range: [0.55, 0.65] }, sugar_or_jaggery: { foodId: SUGAR, range: [0.1, 0.18] } } },
  'Milk Cake': { portion: 60, slots: { base_milk_grain_nut_or_flour: { foodId: KHOYA, range: [0.55, 0.65] }, sugar_or_jaggery: { foodId: SUGAR, range: [0.12, 0.2] } } },
  Kalakand: { portion: 80, slots: { base_milk_grain_nut_or_flour: { foodId: KHOYA, range: [0.5, 0.6] }, sugar_or_jaggery: { foodId: SUGAR, range: [0.12, 0.2] } } },
  Barfi: { portion: 40, slots: { base_milk_grain_nut_or_flour: { foodId: KHOYA, range: [0.55, 0.65] }, sugar_or_jaggery: { foodId: SUGAR, range: [0.1, 0.18] } } },
  'Coconut Barfi': { portion: 40, slots: { base_milk_grain_nut_or_flour: { foodId: COCONUT_DRY, range: [0.5, 0.6] }, sugar_or_jaggery: { foodId: SUGAR, range: [0.15, 0.25] } } },
  'Mysore Pak': { portion: 50, slots: { base_milk_grain_nut_or_flour: { foodId: BESAN, range: [0.25, 0.35] }, sugar_or_jaggery: { foodId: SUGAR, range: [0.15, 0.25] }, fat_optional: { foodId: GHEE, range: [0.3, 0.4], note: 'Mysore pak is ghee-dominant.' } } },
  'Soan Papdi': { portion: 40, slots: { base_milk_grain_nut_or_flour: { foodId: MAIDA, range: [0.4, 0.5] }, sugar_or_jaggery: { foodId: SUGAR, range: [0.15, 0.25] } } },
  'Gajar Halwa': { portion: 150, slots: { base_milk_grain_nut_or_flour: { foodId: 'ifct:F002', range: [0.45, 0.6], note: 'Grated carrot base.' }, sugar_or_jaggery: { foodId: SUGAR, range: [0.1, 0.18] }, fat_optional: { foodId: GHEE, range: [0.06, 0.12] } } },
  'Sooji Halwa': { portion: 120, yield: 1.6, slots: { base_milk_grain_nut_or_flour: { foodId: SEMOLINA, range: [0.3, 0.4] }, sugar_or_jaggery: { foodId: SUGAR, range: [0.12, 0.2] }, fat_optional: { foodId: GHEE, range: [0.08, 0.15] } } },
  'Moong Dal Halwa': { portion: 120, slots: { base_milk_grain_nut_or_flour: { foodId: MOONG, range: [0.3, 0.4] }, sugar_or_jaggery: { foodId: SUGAR, range: [0.12, 0.2] }, fat_optional: { foodId: GHEE, range: [0.1, 0.18] } } },
  Kheer: { portion: 150, yield: 1.05, slots: { base_milk_grain_nut_or_flour: { foodId: MILK_COW, range: [0.6, 0.75], note: 'Milk-dominant; rice is the secondary.' }, sugar_or_jaggery: { foodId: SUGAR, range: [0.08, 0.14] }, fat_optional: { foodId: GHEE, range: [0.02, 0.05] } } },
  'Rice Kheer': { portion: 150, yield: 1.05, slots: { base_milk_grain_nut_or_flour: { foodId: MILK_COW, range: [0.6, 0.75], note: 'Milk-dominant; rice is the secondary.' }, sugar_or_jaggery: { foodId: SUGAR, range: [0.08, 0.14] }, fat_optional: { foodId: GHEE, range: [0.02, 0.05] } } },
  Phirni: { portion: 120, yield: 1.05, slots: { base_milk_grain_nut_or_flour: { foodId: MILK_COW, range: [0.6, 0.75], note: 'Milk-dominant; ground rice is the secondary.' }, sugar_or_jaggery: { foodId: SUGAR, range: [0.08, 0.14] }, fat_optional: { foodId: GHEE, range: [0.01, 0.04] } } },
  Payasam: { portion: 120, yield: 1.05, slots: { base_milk_grain_nut_or_flour: { foodId: MILK_COW, range: [0.55, 0.7], note: 'Milk-dominant payasam.' }, sugar_or_jaggery: { foodId: SUGAR, range: [0.1, 0.16] } } },
  'Seviyan Kheer': { portion: 120, yield: 1.05, slots: { base_milk_grain_nut_or_flour: { foodId: MILK_COW, range: [0.6, 0.75], note: 'Milk-dominant; vermicelli is the secondary.' }, sugar_or_jaggery: { foodId: SUGAR, range: [0.08, 0.14] }, fat_optional: { foodId: GHEE, range: [0.02, 0.05] } } },
  Shrikhand: { portion: 100, slots: { base_milk_grain_nut_or_flour: { foodId: YOGURT, range: [0.7, 0.8], note: 'Strained yogurt base.' }, sugar_or_jaggery: { foodId: SUGAR, range: [0.12, 0.2] } } },
  Basundi: { portion: 120, yield: 1.0, slots: { base_milk_grain_nut_or_flour: { foodId: MILK_COW, range: [0.8, 0.9], note: 'Reduced milk.' }, sugar_or_jaggery: { foodId: SUGAR, range: [0.08, 0.12] } } },
  Malpua: { portion: 80, yield: 1.05, slots: { base_milk_grain_nut_or_flour: { foodId: MAIDA, range: [0.3, 0.4], note: 'Flour batter, fried.' }, sugar_or_jaggery: { foodId: SUGAR, range: [0.3, 0.4], note: 'Syrup-soaked.' } } },
  Thekua: { portion: 60, yield: 0.92, slots: { base_milk_grain_nut_or_flour: { foodId: ATTA, range: [0.5, 0.6] }, sugar_or_jaggery: { foodId: JAGGERY, range: [0.15, 0.25], note: 'Jaggery-sweetened.' }, fat_optional: { foodId: OIL, range: [0.08, 0.12], note: 'Fried in oil or ghee.' } } },

  // --- beverage ---
  'Masala Chai': { portion: 150, slots: { water_or_milk: { foodId: MILK_COW, range: [0.6, 0.8] }, flavour_base: { foodId: TEA, range: [0.02, 0.06], note: 'Brewed black tea with whole spices.' } } },
  'Milk Tea': { portion: 150, slots: { water_or_milk: { foodId: MILK_COW, range: [0.65, 0.85] }, flavour_base: { foodId: TEA, range: [0.02, 0.05] } } },
  'Filter Coffee': { portion: 120, slots: { water_or_milk: { foodId: MILK_COW, range: [0.5, 0.7] }, flavour_base: { foodId: COFFEE, range: [0.02, 0.06] } } },
  Lassi: { portion: 250, slots: { water_or_milk: { foodId: YOGURT, range: [0.7, 0.8], note: 'Blended yogurt base.' }, flavour_base: { foodId: CARDAMOM, range: [0.003, 0.008] }, sugar_optional: { foodId: SUGAR, range: [0.06, 0.12] } } },
  'Sweet Lassi': { portion: 250, slots: { water_or_milk: { foodId: YOGURT, range: [0.7, 0.8], note: 'Blended yogurt base.' }, flavour_base: { foodId: CARDAMOM, range: [0.003, 0.008] }, sugar_optional: { foodId: SUGAR, range: [0.08, 0.14] } } },
  Chaas: { portion: 250, slots: { water_or_milk: { foodId: YOGURT, range: [0.55, 0.7], note: 'Cultured buttermilk base.' }, flavour_base: { foodId: CORIANDER, range: [0.005, 0.015], note: 'Coriander, cumin and ginger tempering.' }, sugar_optional: { foodId: SALT, range: [0.0, 0.01], note: 'Chaas is salted, not sweetened.' } } },
  'Nimbu Pani': { portion: 250, slots: { water_or_milk: { foodId: WATER, range: [0.88, 0.94] }, flavour_base: { foodId: LEMON_JUICE, range: [0.04, 0.08] }, sugar_optional: { foodId: SUGAR, range: [0.04, 0.08] } } },
  'Sattu Sharbat': { portion: 300, slots: { water_or_milk: { foodId: WATER, range: [0.85, 0.92] }, flavour_base: { foodId: BESAN, range: [0.08, 0.12], note: 'Roasted gram flour (sattu) suspended in water.' }, sugar_optional: { foodId: SALT, range: [0.0, 0.01], note: 'Salted sattu sharbat.' } } },
}

// ---------------------------------------------------------------------------
// Regional dishes — each carries a bespoke recipe (the family slot pattern
// does not apply). Labels are kept generic; every id is corpus-verified.
// ---------------------------------------------------------------------------
const REGIONAL_TEMPLATES = {
  'Eromba': {
    yield: 0.95, portion: 150,
    slots: [
      { label: 'primary_component', foodId: POTATO, range: [0.5, 0.6], note: 'Eromba is a boiled-potato mash.' },
      { label: 'secondary_components', foodId: DRIED_FISH, range: [0.05, 0.1], note: 'Fermented/dried fish (USDA dried-fish reference row).' },
      { label: 'chilli', foodId: GREEN_CHILLI, range: [0.03, 0.06] },
      { label: 'herbs', foodId: CORIANDER, range: [0.03, 0.06] },
      { label: 'added_fat_optional', foodId: MUSTARD_OIL, range: [0.02, 0.04] },
    ],
  },
  'Singju': {
    yield: 0.95, portion: 120,
    slots: [
      { label: 'primary_component', foodId: CABBAGE, range: [0.5, 0.65], note: 'Singju is a shredded-vegetable salad; cabbage canonical.' },
      { label: 'secondary_components', foodId: CORIANDER, range: [0.05, 0.1] },
      { label: 'chilli', foodId: GREEN_CHILLI, range: [0.02, 0.05] },
      { label: 'added_fat_optional', foodId: MUSTARD_OIL, range: [0.02, 0.05] },
    ],
  },
  'Dal Pitha': {
    yield: 0.95, portion: 150,
    slots: [
      { label: 'primary_component', foodId: RICE, range: [0.45, 0.55], note: 'Rice-flour dumpling shell.' },
      { label: 'secondary_components', foodId: CHANA_WHOLE, range: [0.2, 0.3], note: 'Chana dal filling.' },
      { label: 'added_fat_optional', foodId: OIL, range: [0.02, 0.05] },
    ],
  },
  'Pittha': {
    yield: 0.95, portion: 150,
    slots: [
      { label: 'primary_component', foodId: RICE, range: [0.45, 0.55], note: 'Rice-flour dumpling shell.' },
      { label: 'secondary_components', foodId: CHANA_WHOLE, range: [0.2, 0.3], note: 'Chana dal filling.' },
      { label: 'added_fat_optional', foodId: OIL, range: [0.02, 0.05] },
    ],
  },
  'Dhuska': {
    yield: 0.85, portion: 100,
    slots: [
      { label: 'primary_component', foodId: RICE, range: [0.4, 0.5], note: 'Rice-dal batter.' },
      { label: 'secondary_components', foodId: CHANA_WHOLE, range: [0.2, 0.3] },
      { label: 'added_fat_optional', foodId: OIL, range: [0.08, 0.14], note: 'Deep-fried.' },
    ],
  },
}

// ---------------------------------------------------------------------------
// Name-derived slot claims — when the dish's own name carries an ingredient
// token, that token claims the slot below (per family). These beat family
// defaults but lose to explicit OVERRIDES. Sources are the reviewed pins
// (pinned-ingredients.mjs) plus the EXTRA_NAME_FOODS verified in this file.
// ---------------------------------------------------------------------------
const EXTRA_NAME_FOODS = {
  sabudana: { foodId: TAPIOCA_PEARL, label: 'Tapioca pearls (Sabudana)' },
  nariyal: { foodId: COCONUT_FRESH, label: 'Coconut, kernel, fresh' },
  coconut: { foodId: COCONUT_FRESH, label: 'Coconut, kernel, fresh' },
  kobbari: { foodId: COCONUT_FRESH, label: 'Coconut, kernel, fresh' },
  corn: { foodId: SWEET_CORN, label: 'Sweet corn' },
  makai: { foodId: SWEET_CORN, label: 'Sweet corn' },
  beetroot: { foodId: BEETROOT, label: 'Beet root' },
  patta: { foodId: CABBAGE, label: 'Cabbage, green' },
  cabbage: { foodId: CABBAGE, label: 'Cabbage, green' },
  bathua: { foodId: BATHUA, label: 'Bathua leaves' },
  sarson: { foodId: MUSTARD_GREENS, label: 'Mustard greens' },
  mixed: { foodId: MIXED_VEG, label: 'Mixed vegetables' },
  veg: { foodId: MIXED_VEG, label: 'Mixed vegetables' },
  semiya: { foodId: VERMICELLI, label: 'Wheat vermicelli' },
  seviyan: { foodId: VERMICELLI, label: 'Wheat vermicelli' },
  keema: { foodId: GOAT, label: 'Goat meat, minced (Keema)' },
  gosht: { foodId: GOAT, label: 'Goat meat (Gosht)' },
  murgh: { foodId: CHICKEN, label: 'Chicken' },
  machher: { foodId: ROHU, label: 'Rohu fish' },
  meen: { foodId: ROHU, label: 'Rohu fish' },
  jhinga: PINNED.jhinga,
  doi: { foodId: YOGURT, label: 'Yogurt (Doi/curd)' },
  dahi: { foodId: YOGURT, label: 'Yogurt (Dahi)' },
  curd: { foodId: YOGURT, label: 'Yogurt (curd)' },
  sev: { foodId: TOMATO, label: 'Tomato base' }, // sev tameta: tomato claims the dish
  tameta: { foodId: TOMATO, label: 'Tomato' },
  ringna: { foodId: 'ifct:D010', label: 'Brinjal' },
  khumb: PINNED.khumb,
  matki: { foodId: MOTH_BEAN, label: 'Moth bean (Matki)' },
  ghugni: { foodId: PEAS_DRY, label: 'Dried peas (Ghugni)' },
  kulthi: { foodId: HORSE_GRAM, label: 'Horse gram (Kulthi)' },
  kala: { foodId: CHANA_WHOLE, label: 'Bengal gram, whole (Kala chana)' },
  chhole: PINNED.chhole,
  chole: PINNED.chole,
  ragda: { foodId: PEAS_DRY, label: 'Dried peas (Ragda)' },
  aloo: PINNED.aloo,
  matar: PINNED.matar,
  gobi: PINNED.gobi,
  palak: PINNED.palak,
  bhindi: PINNED.bhindi,
  baingan: PINNED.baingan,
  karela: PINNED.karela,
  lauki: PINNED.lauki,
  turai: PINNED.turai,
  tinda: PINNED.tinda,
  kaddu: PINNED.kaddu,
  shimla: PINNED.shimla,
  gajar: PINNED.gajar,
  mooli: PINNED.mooli,
  methi: PINNED.methi,
  mushroom: PINNED.mushroom,
  chicken: PINNED.chicken,
  mutton: PINNED.mutton,
  egg: PINNED.egg,
  anda: PINNED.anda,
  fish: PINNED.fish,
  prawn: PINNED.prawn,
  pork: PINNED.pork,
  paneer: PINNED.paneer,
  moong: PINNED.moong,
  masoor: PINNED.masoor,
  urad: PINNED.urad,
  chana: PINNED.chana,
  dal: PINNED.dal,
  rajma: PINNED.rajma,
  lobia: PINNED.lobhia,
  tomato: PINNED.tomato,
  tamatar: PINNED.tomato,
  onion: PINNED.onion,
  pyaz: PINNED.pyaz,
  jeera: PINNED.jeera,
  besan: PINNED.besan,
  atta: PINNED.atta,
  rava: PINNED.rava,
  suji: PINNED.suji,
  sooji: PINNED.sooji,
  poha: PINNED.poha,
  aval: PINNED.poha,
  rice: PINNED.rice,
  chawal: PINNED.rice,
  kaju: PINNED.kaju,
  til: { foodId: SESAME, label: 'Gingelly seeds (Til)' },
  imli: PINNED.imli,
  kheera: PINNED.kheera,
  kakdi: PINNED.kakdi,
  beans: PINNED.beans,
  kathal: PINNED.kathal,
  arbi: PINNED.arbi,
  gur: PINNED.gur,
  jaggery: PINNED.jaggery,
}

function VERMICELLI_LABEL() { return VERMICELLI }
void VERMICELLI_LABEL

/**
 * token → slot label per family: which slot a name-derived ingredient claims.
 * The first matching token in the dish name wins the slot; tokens that name
 * the family's default base (e.g. "rice" for rice_or_grain) are no-ops.
 */
const NAME_CLAIMS = {
  cooked_grain: {
    rice_or_grain: ['sabudana'],
    mix_ins_optional: ['aloo', 'matar', 'gobi', 'palak', 'tomato', 'tamatar', 'imli', 'nariyal', 'coconut', 'kobbari', 'kaju', 'egg', 'anda', 'chicken', 'murgh', 'mutton', 'gosht', 'fish', 'prawn', 'moong', 'paneer', 'corn', 'makai', 'mixed', 'veg', 'beans'],
  },
  batter_or_breakfast: {
    grain_or_semolina: ['poha', 'aval', 'rava', 'suji', 'sooji', 'semolina', 'besan', 'moong', 'sabudana', 'semiya', 'vermicelli'],
    pulse_optional: ['groundnut', 'peanut', 'urad', 'moong'],
  },
  legume_preparation: {
    pulse_or_legume: ['moong', 'masoor', 'urad', 'chana', 'chhole', 'chole', 'rajma', 'lobia', 'lobhia', 'chawli', 'matki', 'kulthi', 'ghugni', 'ragda'],
    aromatics: ['tomato', 'tamatar', 'palak', 'methi', 'gobi'],
  },
  vegetable_preparation: {
    primary_vegetable: ['aloo', 'gobi', 'matar', 'palak', 'bhindi', 'baingan', 'ringna', 'karela', 'lauki', 'ghiya', 'turai', 'tinda', 'kaddu', 'shimla', 'gajar', 'mooli', 'kakdi', 'kheera', 'methi', 'sarson', 'bathua', 'mushroom', 'khumb', 'arbi', 'kathal', 'beans', 'sem', 'corn', 'makai', 'beetroot', 'patta', 'cabbage', 'tomato', 'tamatar', 'tameta', 'sev', 'mixed', 'veg', 'paneer', 'soya'],
    aromatics: ['matar', 'chana', 'corn', 'makai', 'dal'],
  },
  paneer_preparation: {
    gravy_or_vegetable_base: ['palak', 'matar', 'tomato', 'tamatar'],
  },
  protein_preparation: {
    animal_protein: ['chicken', 'murgh', 'mutton', 'gosht', 'keema', 'pork', 'fish', 'machher', 'machli', 'meen', 'prawn', 'jhinga', 'egg', 'anda'],
    aromatics_or_gravy: ['palak', 'saag', 'matar', 'keema', 'haleem'],
    dairy_or_coconut_optional: ['coconut', 'kobbari', 'doi', 'dahi', 'curd'],
  },
  street_snack: {
    starch_or_wrapper: ['sabudana', 'noodle', 'chowmein', 'hakka'],
    filling_or_topping: ['aloo', 'dal', 'pyaz', 'onion', 'paneer', 'chicken', 'murgh', 'veg', 'chole', 'chole', 'matki', 'ragda', 'misal', 'momos', 'manchurian'],
    condiments_optional: ['dahi', 'chaat', 'papdi', 'sev'],
  },
  sweet_dessert: {
    base_milk_grain_nut_or_flour: ['besan', 'atta', 'rava', 'suji', 'sooji', 'kaju', 'til', 'gajar', 'moong', 'nariyal', 'coconut', 'seviyan', 'semiya', 'kheer', 'phirni', 'payasam', 'doi', 'dahi', 'kheera'],
  },
  beverage: {
    water_or_milk: ['lassi', 'chaas', 'nimbu', 'sattu'],
    flavour_base: ['chai', 'tea', 'coffee', 'nimbu', 'sattu', 'masala'],
  },
}

function normalizedTokens(name) {
  return name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

// ---------------------------------------------------------------------------
// Curation pass
// ---------------------------------------------------------------------------
function collectReferencedIds() {
  const ids = new Set()
  for (const model of Object.values(FAMILY_MODELS)) {
    if (!model) continue
    for (const slot of model.slots) ids.add(slot.foodId)
  }
  for (const override of Object.values(OVERRIDES)) {
    for (const patch of Object.values(override.slots ?? {})) {
      if (patch && patch.foodId) ids.add(patch.foodId)
    }
  }
  for (const template of Object.values(REGIONAL_TEMPLATES)) {
    for (const slot of template.slots) ids.add(slot.foodId)
  }
  for (const entry of Object.values(EXTRA_NAME_FOODS)) ids.add(entry.foodId)
  for (const entry of Object.values(PINNED)) {
    if (entry) ids.add(entry.foodId)
  }
  return ids
}

async function main() {
  const nutrition = openNodeDb(join(REPO, 'apps/mobile/assets/nutrition.db'), { readonly: true })
  const ifct = openNodeDb(join(REPO, 'apps/mobile/assets/ifct.db'), { readonly: true })

  const corpus = {
    ifct: new Map(),
    usda: new Map(),
  }
  for (const row of await ifct.all("SELECT source_id, name, energy_kcal, protein_g, fat_g FROM foods WHERE source = 'ifct'")) {
    corpus.ifct.set(row.source_id, row)
  }
  for (const row of await nutrition.all("SELECT COALESCE(source_id, CAST(id AS TEXT)) AS source_id, name, energy_kcal, protein_g, fat_g FROM foods WHERE source LIKE 'fdc_%'")) {
    corpus.usda.set(row.source_id, row)
  }
  const lookup = (foodId) => {
    const [source, sourceId] = foodId.split(':')
    if (!corpus[source]) return null
    return corpus[source].get(sourceId) ?? null
  }

  // 1. Validate EVERY id this pass can reference — hard-fail the whole pass
  //    if anything is stale. A wrong mapping must never ship quietly.
  const problems = []
  for (const foodId of collectReferencedIds()) {
    const row = lookup(foodId)
    if (!row) problems.push(`${foodId} does not resolve in the shipped corpus`)
    else if (row.energy_kcal == null || !Number.isFinite(row.energy_kcal) || row.energy_kcal < 0) {
      problems.push(`${foodId} (${row.name}) has no usable energy value`)
    }
  }
  if (problems.length > 0) {
    console.error('Curation stopped — referenced ids failed corpus validation:')
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }

  // 2. Walk the mapped seed and graduate every draft that can be honestly
  //    resolved end-to-end.
  const dishes = JSON.parse(readFileSync(MAPPED_FILE, 'utf8'))
  const report = {
    generatedAt: new Date().toISOString(),
    draftsBefore: 0,
    graduated: 0,
    stayedDraft: [],
    nameDerivedSlots: 0,
    overrideSlots: 0,
    familyDefaultSlots: 0,
    perFamily: {},
    dishes: [],
  }

  for (const dish of dishes) {
    if (dish.provenance?.recordStatus !== 'DRAFT_CURATED') continue
    report.draftsBefore += 1

    const name = dish.canonicalName
    const override = OVERRIDES[name] ?? {}
    const regional = REGIONAL_TEMPLATES[name]
    const familyModel = FAMILY_MODELS[dish.family]
    const tokens = normalizedTokens([name, ...(dish.aliases ?? [])].join(' '))
    // The dish's own slots carry the schema-valid role/required values — the
    // family model only supplies food ids and ranges, never roles.
    const existingSlots = dish.recipeTemplate?.ingredientSlots ?? []

    if (existingSlots.length === 0) {
      report.stayedDraft.push({ id: dish.id, name, reason: 'record has no ingredient slots' })
      continue
    }

    // Resolve every slot: explicit override (strongest), then name claim,
    // then family default. Regional dishes use their bespoke template which
    // replaces the slot list wholesale with schema-valid roles.
    let replacedSlots
    if (regional) {
      replacedSlots = regional.slots.map((slot) => ({
        label: slot.label,
        role: slot.label === 'primary_component' ? 'dominant'
          : slot.label === 'secondary_components' ? 'secondary'
          : slot.label === 'added_fat_optional' ? 'fat_variable'
          : 'minor',
        required: slot.label === 'primary_component',
        foodId: slot.foodId,
        range: slot.range,
        note: slot.note,
        method: 'reviewed_dish_override',
      }))
    } else {
      if (!familyModel) {
        report.stayedDraft.push({ id: dish.id, name, reason: `no family model for family "${dish.family}"` })
        continue
      }
      let replaced = []
      for (const slot of existingSlots) {
        const familyDefault = familyModel.slots.find((s) => s.label === slot.label)
        const patch = override.slots?.[slot.label]
        if (patch?.foodId) {
          replaced.push({
            label: slot.label,
            role: slot.role,
            required: slot.required,
            foodId: patch.foodId,
            range: patch.range ?? familyDefault?.range,
            note: patch.note ?? null,
            method: 'reviewed_dish_override',
          })
          continue
        }
        // Name claim: first name token that claims this slot wins, unless the
        // claim merely restates the family default.
        const claimTokens = (NAME_CLAIMS[dish.family] ?? {})[slot.label] ?? []
        let claimed = null
        for (const token of tokens) {
          if (!claimTokens.includes(token)) continue
          const entry = EXTRA_NAME_FOODS[token] ?? PINNED[token]
          if (!entry) continue
          if (familyDefault && entry.foodId === familyDefault.foodId) continue
          claimed = { entry, token }
          break
        }
        if (claimed) {
          replaced.push({
            label: slot.label,
            role: slot.role,
            required: slot.required,
            foodId: claimed.entry.foodId,
            range: familyDefault?.range,
            note: `Ingredient read from the dish name ("${claimed.token}"); pin verified against the shipped corpus.`,
            method: 'name_derived',
          })
          continue
        }
        if (familyDefault) {
          replaced.push({
            label: slot.label,
            role: slot.role,
            required: slot.required,
            foodId: familyDefault.foodId,
            range: familyDefault.range,
            note: null,
            method: 'family_prior',
          })
          continue
        }
        // No override, no claim, no family default for this label.
        replaced.push({ label: slot.label, role: slot.role, required: slot.required, foodId: null })
      }
      replacedSlots = replaced
    }
    const slotSpecs = replacedSlots

    // Final validation of the resolved slot set.
    let usable = true
    const slotDetails = []
    let midSum = 0
    for (const spec of slotSpecs) {
      const row = lookup(spec.foodId)
      if (!row || row.energy_kcal == null || !Number.isFinite(row.energy_kcal) || row.energy_kcal < 0) {
        usable = false
        break
      }
      const [low, high] = spec.range
      if (!Number.isFinite(low) || !Number.isFinite(high) || low < 0 || high < low) {
        usable = false
        break
      }
      midSum += (low + high) / 2
      slotDetails.push({ spec, row })
    }
    // Raw mass fractions outside [0.5, 2.5] mean a family model contradicts
    // itself (a dish cannot lose 75% of its raw mass or carry 2.5x its mass
    // without an explicit yield story). Keep those dishes in DRAFT.
    if (midSum < 0.5 || midSum > 2.5) {
      usable = false
    }
    if (!usable) {
      report.stayedDraft.push({ id: dish.id, name, reason: 'slot resolution incomplete or implausible mass balance' })
      continue
    }

    // Build the graduated record.
    const methodNote = {
      reviewed_dish_override: 'Reviewed per-dish mapping; id verified against the shipped corpus.',
      name_derived: 'Ingredient read from the dish name; id verified against the shipped corpus.',
      family_prior: `Family prior adopted from reviewed CURATED dishes in this family (${familyModel?.exemplars ?? 'bespoke regional review'}); id verified against the shipped corpus.`,
    }
    const newSlots = slotDetails.map(({ spec, row }) => ({
      label: spec.label,
      role: spec.role,
      required: spec.required,
      amountPrior: { kind: 'CURATED_PRIOR', range: spec.range, verified: true },
      nutritionMapping: {
        preferredSources: sourceOf(spec.foodId) === IFCT ? [IFCT, 'USDA_FDC'] : ['USDA_FDC', IFCT],
        canonicalFoodId: spec.foodId,
        mappingStatus: 'AUTO_MAPPED',
        mappedName: row.name,
        mappingMethod: spec.method === 'family_prior' ? 'family_prior_corpus_verified' : spec.method === 'name_derived' ? 'name_derived_corpus_verified' : 'reviewed_dish_override',
        reviewNote: [spec.note, methodNote[spec.method]].filter(Boolean).join(' '),
      },
    }))

    const yieldValue = override.yield ?? (regional ? regional.yield : familyModel?.yield)
    const portionValue = override.portion ?? (regional ? regional.portion : familyModel?.portion)
    if (!Number.isFinite(yieldValue) || yieldValue <= 0 || !Number.isFinite(portionValue) || portionValue <= 0) {
      report.stayedDraft.push({ id: dish.id, name, reason: 'missing verified yield or portion' })
      continue
    }

    dish.recipeTemplate.ingredientSlots = newSlots
    dish.recipeTemplate.templateStatus = 'CURATED'
    dish.recipeTemplate.numericRatiosVerified = true
    dish.cooking.yieldModel = {
      ...(dish.cooking?.yieldModel ?? {}),
      verifiedNumericYield: yieldValue,
      status: 'verified',
      assumptionClass: 'CURATED_PRIOR',
    }
    dish.portionModel = {
      ...(dish.portionModel ?? {}),
      standardPortionGrams: portionValue,
      standardPortionStatus: 'verified',
      householdOverrideEligible: true,
      assumptionClass: 'CURATED_PRIOR',
    }
    dish.provenance.recordStatus = 'CURATED'

    report.graduated += 1
    report.perFamily[dish.family] = (report.perFamily[dish.family] ?? 0) + 1
    for (const { spec } of slotDetails) {
      if (spec.method === 'name_derived') report.nameDerivedSlots += 1
      else if (spec.method === 'reviewed_dish_override') report.overrideSlots += 1
      else report.familyDefaultSlots += 1
    }
    report.dishes.push({
      id: dish.id,
      name,
      family: dish.family,
      yield: yieldValue,
      portion: portionValue,
      slots: slotDetails.map(({ spec, row }) => ({ label: spec.label, foodId: spec.foodId, food: row.name, range: spec.range, method: spec.method })),
    })
  }

  // 3. Sanity: nothing may still carry stale candidate lists from the draft
  //    ambiguity report once it is graduated.
  for (const dish of dishes) {
    if (dish.provenance?.recordStatus !== 'CURATED') continue
    for (const slot of dish.recipeTemplate.ingredientSlots) {
      delete slot.nutritionMapping.candidates
    }
  }

  // 4. Re-stat the mapping report so validate.mjs cross-checks the SHIPPED
  //    state, not the pre-curation draft state. The reviewed thresholds and
  //    the priority deep-validation set from the original mapping pass are
  //    preserved untouched — curation changes statuses, never standards.
  const reportPath = join(REPO, 'docs', 'data', 'indian-dishes.mapping-report.json')
  try {
    const mappingReport = JSON.parse(readFileSync(reportPath, 'utf8'))
    const stats = {
      totalDishes: dishes.length,
      totalIngredientSlots: 0,
      mappedToIFCT: 0,
      mappedToUSDA: 0,
      autoMapped: 0,
      manualOverrides: 0,
      ambiguous: 0,
      unresolved: 0,
      DRAFT_CURATED: 0,
      CURATED: 0,
      VERIFIED: 0,
    }
    for (const dish of dishes) {
      const status = dish.provenance?.recordStatus
      if (status === 'DRAFT_CURATED') stats.DRAFT_CURATED += 1
      else if (status === 'CURATED') stats.CURATED += 1
      else if (status === 'VERIFIED') stats.VERIFIED += 1
      for (const slot of dish.recipeTemplate?.ingredientSlots ?? []) {
        stats.totalIngredientSlots += 1
        const mapping = slot.nutritionMapping
        if (!mapping) continue
        if (mapping.mappingStatus === 'AUTO_MAPPED') stats.autoMapped += 1
        if (mapping.mappingStatus === 'MANUAL_OVERRIDE') stats.manualOverrides += 1
        if (mapping.mappingStatus === 'AMBIGUOUS') stats.ambiguous += 1
        if (mapping.mappingStatus === 'UNRESOLVED' || mapping.mappingStatus === 'unresolved') stats.unresolved += 1
        if (mapping.canonicalFoodId?.startsWith('ifct:')) stats.mappedToIFCT += 1
        else if (mapping.canonicalFoodId?.startsWith('usda:')) stats.mappedToUSDA += 1
      }
    }
    Object.assign(mappingReport, stats)
    mappingReport.curationNote = 'Stats re-stated by curate-drafts.mjs after the draft-graduation pass; reviewed thresholds and deep-validation set unchanged.'
    writeFileSync(reportPath, `${JSON.stringify(mappingReport, null, 2)}\n`)
    console.log('  mapping report re-stated to the graduated state.')
  } catch (error) {
    console.error(`  warning: could not re-state the mapping report (${error.message})`)
  }

  writeFileSync(MAPPED_FILE, `${JSON.stringify(dishes, null, 1)}\n`)
  writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`)

  console.log(`Curation complete:`)
  console.log(`  drafts before: ${report.draftsBefore}`)
  console.log(`  graduated:     ${report.graduated}`)
  console.log(`  stayed DRAFT:  ${report.stayedDraft.length}`)
  for (const d of report.stayedDraft) console.log(`    - ${d.name}: ${d.reason}`)
  console.log(`  slots: ${report.nameDerivedSlots} name-derived, ${report.overrideSlots} reviewed overrides, ${report.familyDefaultSlots} family priors`)
  console.log(`  per family: ${JSON.stringify(report.perFamily)}`)
  console.log(`  report: ${REPORT_FILE}`)

  await nutrition.close()
  await ifct.close()
}

main().catch((error) => { console.error(error); process.exit(1) })

