/**
 * Population portion priors for Indian household serving units.
 *
 * Task 2-c. The scan's gram ladder used to have no inspectable home for
 * household units — "1 roti", "1 katori dal" were hardcoded screen numbers.
 * This package is the fix: a SOURCED, RANGE-CARRYING dataset of typical
 * household portion masses, plus a lookup that maps free-text food names
 * onto entries via substring/stem matching.
 *
 * WHAT THIS IS NOT, said up front:
 *   - NOT a measured distribution. Every range below is a curated reading of
 *     public Indian household-measure literature (IFCT 2017-era household
 *     measures, NIN RDA 2020 meal-planning portions), cross-checked where
 *     possible against the Nut AI Dish KB curated standard portions. The
 *     honest label for all of it is "population prior", and every entry
 *     carries its source string so the UI can show it.
 *   - NOT a substitute for the user's own correction history (the gram
 *     engine's personal prior outranks this at weight 0.9 vs 0.7).
 *
 * Everything here is node-pure: data in, data out, no I/O, no platform.
 */

/** Household serving units the dataset distinguishes. */
export type PortionUnit = 'piece' | 'katori' | 'bowl' | 'cup' | 'ladle' | 'serving'

/**
 * The last-mile hint shape the resolver attaches to a ResolvedFood and the
 * pipeline spreads into the gram engine's ResolvedRow.
 *
 * This is the exact cross-package contract for Task 2-c (resolver
 * ResolvedFood.portionHints, nutrition-sources SourceResolvedFood.portionHints,
 * gram-engine ResolvedRow.portionHints all match this structurally):
 *   { unit, typical, min, max, source }
 */
export interface PortionHint {
  /** Household unit label ('piece' | 'katori' | ...). Best-effort label; the grams carry the payload. */
  unit: string
  /** Most common mass of ONE unit, in grams. */
  typical: number
  /** Low end of the honest population range, in grams. */
  min: number
  /** High end of the honest population range, in grams. */
  max: number
  /** Where these numbers came from. Shown to the user; never empty. */
  source: string
}

/** A seeded population prior: one food concept and its household portion. */
export interface PortionPrior {
  /** Stable dataset key ('roti', 'dal', 'stuffed-paratha', ...). */
  key: string
  /** Human-readable name for UI display. */
  displayName: string
  /** The household unit this food is normally served/logged in. */
  unit: PortionUnit
  /** Mass of one `unit`, in grams, as an honest range around a typical value. */
  unitGrams: { typical: number; min: number; max: number }
  /**
   * Per-piece mass, ONLY when the usual unit is a vessel (katori/bowl/serving)
   * and the literature also gives a credible per-piece figure for count-based
   * logging. Reserved for that case; v1 seed entries leave it unset — no entry
   * fabricates a piece mass just to fill the field.
   */
  perPiece?: { typical: number; min: number; max: number }
  /** Qualifiers a reader needs to use the number honestly. */
  notes: string
  /** Source citation. Never empty (enforced by test). */
  source: string
}

/** Dataset-internal matcher knobs; never exported as part of PortionPrior. */
interface PriorSeed extends PortionPrior {
  /**
   * Whole-word tokens that disqualify a match when present in the query —
   * e.g. the 'rice' katori prior must not attach to 'rice flour' or raw rice.
   */
  excludes?: string[]
  /** Extra lookup phrases beyond key + displayName (normalized on load). */
  aliases?: string[]
}

/**
 * IFCT 2017 (ICMR-NIN Indian Food Composition Tables) is the composition
 * reference for the era; household-measure masses come from the NIN RDA 2020
 * meal-planning tables and the Dish KB curation pass. Where the Dish KB
 * carries a curated standard portion, the note says so — including when the
 * KB's number sits BELOW the population range (home-style vs restaurant-style
 * cooking), because hiding that disagreement would be exactly the kind of
 * false precision this repo exists to prevent.
 */
const SOURCE_NIN = 'IFCT 2017 household measures / NIN RDA 2020 (curated range)'

const SEEDS: readonly PriorSeed[] = [
  {
    key: 'roti',
    displayName: 'Roti / chapati / phulka (piece)',
    unit: 'piece',
    unitGrams: { typical: 45, min: 35, max: 60 },
    notes:
      'One medium whole-wheat roti as eaten. Home sizes vary widely by region and tawa; ' +
      'large tandoori-style rotis exceed the range. Dish KB curated standard: 40 g.',
    source: SOURCE_NIN,
    aliases: ['chapati', 'chapatti', 'phulka', 'fulka', 'wheat roti', 'roti chapati'],
  },
  {
    key: 'paratha',
    displayName: 'Plain paratha (piece)',
    unit: 'piece',
    unitGrams: { typical: 75, min: 60, max: 90 },
    notes: 'Plain or lachha paratha, no stuffing. Stuffed variants are their own entry.',
    source: SOURCE_NIN,
    aliases: ['plain paratha', 'lachha paratha', 'laccha paratha'],
  },
  {
    key: 'stuffed-paratha',
    displayName: 'Stuffed paratha (piece)',
    unit: 'piece',
    unitGrams: { typical: 100, min: 80, max: 120 },
    notes:
      'Aloo/gobi/paneer/mooli paratha — the filling adds 25-50 g over a plain paratha. ' +
      'Dish KB curated standard (aloo paratha): 110 g.',
    source: SOURCE_NIN,
    aliases: [
      'aloo paratha',
      'gobi paratha',
      'paneer paratha',
      'mooli paratha',
      'methi paratha',
      'pyaz paratha',
      'stuffed paratha',
    ],
  },
  {
    key: 'naan',
    displayName: 'Naan (piece)',
    unit: 'piece',
    unitGrams: { typical: 115, min: 90, max: 150 },
    notes: 'Tandoor naan, plain to stuffed. Dish KB curated standard: 90-100 g.',
    source: SOURCE_NIN,
    aliases: ['naan bread', 'butter naan', 'garlic naan', 'tandoori naan'],
  },
  {
    key: 'dosa',
    displayName: 'Plain dosa (piece)',
    unit: 'piece',
    unitGrams: { typical: 120, min: 100, max: 150 },
    notes:
      'Plain sada dosa, ~10-12 inch, excludes separate oil smear. Dish KB curated standard is ' +
      '80 g (smaller home-style dosa); restaurant-style dosas sit in the 100-150 g range.',
    source: SOURCE_NIN,
    aliases: ['sada dosa', 'plain dosa', 'plain dosas', 'dosa plain'],
  },
  {
    key: 'masala-dosa',
    displayName: 'Masala dosa (piece)',
    unit: 'piece',
    unitGrams: { typical: 170, min: 150, max: 200 },
    notes: 'Dosa plus the potato-onion filling folded inside.',
    source: SOURCE_NIN,
    aliases: ['masala dosai', 'masala dose'],
  },
  {
    key: 'idli',
    displayName: 'Idli (piece)',
    unit: 'piece',
    unitGrams: { typical: 40, min: 30, max: 50 },
    notes: 'One steamed rice-urad cake, regular size. Dish KB curated standard: 50 g.',
    source: SOURCE_NIN,
    aliases: ['idly', 'idlis', 'idlies'],
  },
  {
    key: 'vada',
    displayName: 'Medu vada (piece)',
    unit: 'piece',
    unitGrams: { typical: 32, min: 25, max: 40 },
    notes: 'One fried urad doughnut; counts include only the vada, not chutney/sambar.',
    source: SOURCE_NIN,
    aliases: ['medu vada', 'medu vadai', 'ulundu vadai', 'uzhunnu vada', 'urad vada'],
  },
  {
    key: 'dal',
    displayName: 'Dal (katori)',
    unit: 'katori',
    unitGrams: { typical: 150, min: 120, max: 180 },
    notes:
      'One standard katori (~150 ml) of cooked dal — toor/moong/masoor/urad, tempered or plain. ' +
      'Dish KB curated standard: 150 g.',
    source: SOURCE_NIN,
    aliases: ['daal', 'dhal', 'dal fry', 'dal tadka', 'dal curry', 'cooked dal', 'arhar dal cooked'],
    excludes: ['raw', 'dry', 'uncooked', 'sprout'],
  },
  {
    key: 'rice-cooked',
    displayName: 'Cooked rice (katori)',
    unit: 'katori',
    unitGrams: { typical: 175, min: 150, max: 200 },
    notes: 'One katori of steamed white rice. A full plate (thali rice) is 2-3 katoris.',
    source: SOURCE_NIN,
    aliases: ['cooked rice', 'steamed rice', 'plain rice', 'white rice', 'rice'],
    excludes: ['raw', 'flour', 'bran', 'paper', 'noodle', 'starch', 'puffed', 'flaked', 'flakes', 'uncooked'],
  },
  {
    key: 'sabzi',
    displayName: 'Sabzi / vegetable curry (katori)',
    unit: 'katori',
    unitGrams: { typical: 125, min: 100, max: 150 },
    notes: 'One katori of dry or semi-gravy vegetable preparation.',
    source: SOURCE_NIN,
    aliases: ['sabzi', 'sabji', 'sabzi curry', 'vegetable curry', 'mixed vegetable', 'dry vegetable', 'bhaji'],
  },
  {
    key: 'paneer-curry',
    displayName: 'Paneer curry (katori)',
    unit: 'katori',
    unitGrams: { typical: 155, min: 130, max: 180 },
    notes: 'One katori of paneer in gravy (butter masala, palak, shahi, kadai).',
    source: SOURCE_NIN,
    aliases: [
      'paneer butter masala',
      'shahi paneer',
      'palak paneer',
      'kadai paneer',
      'matar paneer',
      'paneer tikka masala',
    ],
  },
  {
    key: 'chana-masala',
    displayName: 'Chana masala / chole (katori)',
    unit: 'katori',
    unitGrams: { typical: 155, min: 130, max: 180 },
    notes: 'One katori of chickpea curry. The canonical "compound key" entry: matches via substring.',
    source: SOURCE_NIN,
    aliases: ['chana masala', 'channa masala', 'chole', 'chhole', 'chickpea curry', 'kabuli chana curry'],
  },
  {
    key: 'curd-raita',
    displayName: 'Curd / raita (katori)',
    unit: 'katori',
    unitGrams: { typical: 125, min: 100, max: 150 },
    notes: 'One katori of plain curd (dahi) or vegetable raita.',
    source: SOURCE_NIN,
    aliases: ['curd', 'dahi', 'raita', 'plain yogurt', 'yogurt', 'boondi raita', 'cucumber raita'],
  },
  {
    key: 'gulab-jamun',
    displayName: 'Gulab jamun (piece)',
    unit: 'piece',
    unitGrams: { typical: 50, min: 40, max: 60 },
    notes: 'One syrup-soaked milk-solid ball, drained weight.',
    source: SOURCE_NIN,
    aliases: ['gulaab jamun', 'gulab jamuns'],
  },
  {
    key: 'samosa',
    displayName: 'Samosa (piece)',
    unit: 'piece',
    unitGrams: { typical: 65, min: 50, max: 80 },
    notes: 'One fried pastry. Dish KB curated standard: 85 g for the large Punjabi variant.',
    source: SOURCE_NIN,
    aliases: ['samosas', 'punjabi samosa', 'vegetable samosa'],
  },
  {
    key: 'papad',
    displayName: 'Papad (piece)',
    unit: 'piece',
    unitGrams: { typical: 15, min: 10, max: 20 },
    notes: 'One roasted or fried papad / appalam.',
    source: SOURCE_NIN,
    aliases: ['papadum', 'papadam', 'pappad', 'poppadom', 'poppadum', 'appalam', 'pappadum'],
  },
  {
    key: 'upma',
    displayName: 'Upma (katori)',
    unit: 'katori',
    unitGrams: { typical: 175, min: 150, max: 200 },
    notes: 'One katori of semolina upma with vegetables. Dish KB curated standard: 160 g.',
    source: SOURCE_NIN,
    aliases: ['rava upma', 'suji upma', 'sooji upma', 'uppuma'],
  },
  {
    key: 'poha',
    displayName: 'Poha (katori)',
    unit: 'katori',
    unitGrams: { typical: 175, min: 150, max: 200 },
    notes: 'One katori of cooked flattened-rice (kanda poha / indori poha), not dry flakes.',
    source: SOURCE_NIN,
    aliases: ['kanda poha', 'cooked poha', 'batata poha'],
    excludes: ['raw', 'dry', 'flakes'],
  },
  {
    key: 'khichdi',
    displayName: 'Khichdi (katori)',
    unit: 'katori',
    unitGrams: { typical: 200, min: 180, max: 220 },
    notes: 'One katori of rice-dal khichdi. Dish KB curated standard: 250 g for a full bowl.',
    source: SOURCE_NIN,
    aliases: ['khichri', 'kichdi', 'khichdee', 'moong dal khichdi'],
  },
  {
    key: 'biryani',
    displayName: 'Biryani (plate)',
    unit: 'serving',
    unitGrams: { typical: 375, min: 300, max: 450 },
    notes:
      'One restaurant/takeaway plate including rice and meat/vegetable pieces. Dish KB curated ' +
      'standard: 300 g.',
    source: SOURCE_NIN,
    aliases: [
      'biriyani',
      'biryani rice',
      'chicken biryani',
      'mutton biryani',
      'veg biryani',
      'vegetable biryani',
      'hyderabadi biryani',
      'biryanis',
    ],
  },
  {
    key: 'chutney',
    displayName: 'Chutney (serving)',
    unit: 'serving',
    unitGrams: { typical: 20, min: 15, max: 25 },
    notes: 'One small bowl served alongside — green/coconut/tomato chutney.',
    source: SOURCE_NIN,
    aliases: ['green chutney', 'mint chutney', 'coriander chutney', 'coconut chutney', 'tomato chutney', 'chutneys'],
  },
  {
    key: 'pickle',
    displayName: 'Pickle / achar (serving)',
    unit: 'serving',
    unitGrams: { typical: 12, min: 8, max: 15 },
    notes: 'The spoonful actually eaten with a meal, not the jar.',
    source: SOURCE_NIN,
    aliases: ['achar', 'achaar', 'mango pickle', 'mixed pickle', 'lime pickle', 'pickles'],
  },
]

/**
 * Normalize a food name / canonical food key into the matcher's space:
 * lowercase, diacritics folded, punctuation to spaces, whitespace collapsed.
 * ("Chana Masala" and "chana masala, with onions" share the prefix that makes
 * substring matching work.)
 */
export function normalizePortionKey(text: string): string {
  return text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Naive but safe plural stripper: 'rotis' -> 'roti', 'idlies' -> 'idly'. */
function depluralizeToken(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`
  if (token.length > 4 && token.endsWith('es')) return token.slice(0, -2)
  if (token.length > 2 && token.endsWith('s')) return token.slice(0, -1)
  return token
}

interface AliasIndexEntry {
  alias: string
  /** Pre-built whole-word matcher for the alias. */
  pattern: RegExp
  seed: PriorSeed
}

/**
 * Longest-alias-first index. Longest-first is the load-bearing ordering: it is
 * what makes 'aloo paratha' hit the STUFFED paratha prior (100 g) while bare
 * 'paratha' hits the plain one (75 g), and 'masala dosa' outrun the plain dosa.
 */
const ALIAS_INDEX: readonly AliasIndexEntry[] = SEEDS.flatMap((seed) => {
  const phrases = new Set<string>([seed.key.replace(/-/g, ' '), seed.displayName, ...(seed.aliases ?? [])])
  return [...phrases]
    .map((phrase) => normalizePortionKey(phrase))
    .filter((phrase) => phrase.length > 0)
    .map((alias) => ({
      alias,
      // Word-bounded match: a lookahead/lookbehind pair of non-alphanumerics.
      pattern: new RegExp(`(?<![a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`),
      seed,
    }))
}).sort((a, b) => b.alias.length - a.alias.length)

function queryTexts(query: string): string[] {
  const normalized = normalizePortionKey(query)
  if (!normalized) return []
  const depluralized = normalized
    .split(' ')
    .map((token) => depluralizeToken(token))
    .join(' ')
  return depluralized === normalized ? [normalized] : [normalized, depluralized]
}

function seedExcluded(seed: PriorSeed, texts: readonly string[]): boolean {
  if (!seed.excludes?.length) return false
  return texts.some((text) =>
    seed.excludes!.some((word) => new RegExp(`(?<![a-z0-9])${word}(?![a-z0-9])`).test(text)),
  )
}

/**
 * Look up the population portion prior for a food name or canonical food key.
 *
 * Matching is substring/stem based and word-bounded, longest phrase first:
 *   'chana masala'            -> chana-masala
 *   'kadai paneer with naan'  -> paneer-curry   ('kadai paneer' outranks 'naan' by length)
 *   '2 rotis'                 -> roti           (plural stems)
 *   'rice flour'              -> null           (exclusion term)
 *
 * Returns the SAME frozen entry object the dataset holds — callers must treat
 * it as read-only. Null when nothing matches; never a fabricated guess.
 */
export function lookupPrior(canonicalFoodKey: string): PortionPrior | null {
  const texts = queryTexts(canonicalFoodKey)
  if (texts.length === 0) return null

  const disqualified = new Set<PriorSeed>()
  for (const entry of ALIAS_INDEX) {
    if (disqualified.has(entry.seed)) continue
    if (seedExcluded(entry.seed, texts)) {
      disqualified.add(entry.seed)
      continue
    }
    if (texts.some((text) => entry.pattern.test(text))) return entry.seed
  }
  return null
}

/**
 * Every seeded prior. Exported for the exhaustive dataset test and for UI
 * disclosure screens; treat as read-only.
 */
export function listPortionPriors(): readonly PortionPrior[] {
  return SEEDS
}

/**
 * Convert a prior into the wire-shaped PortionHint the resolver attaches to a
 * ResolvedFood. Separate function so the dataset shape and the contract shape
 * can evolve independently without breaking either.
 */
export function priorToHint(prior: PortionPrior): PortionHint {
  return {
    unit: prior.unit,
    typical: prior.unitGrams.typical,
    min: prior.unitGrams.min,
    max: prior.unitGrams.max,
    source: prior.source,
  }
}
