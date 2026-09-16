export interface CompositeMealComponent {
  name: string
  query: string
  quantity?: number
  defaultPortionGrams?: number
}

export interface DecomposedMeal {
  rawQuery: string
  displayName: string
  components: CompositeMealComponent[]
}

interface KnownPairing {
  pattern: RegExp
  displayName: string
  components: CompositeMealComponent[]
}

const KNOWN_PAIRINGS: KnownPairing[] = [
  {
    pattern: /^\s*litti\s+(?:and\s+|with\s+|\+\s*|&\s*|aur\s+)?chokha\s*$/i,
    displayName: 'Litti Chokha',
    components: [
      { name: 'Litti', query: 'litti', defaultPortionGrams: 80 },
      { name: 'Chokha', query: 'chokha', defaultPortionGrams: 100 },
    ],
  },
  {
    pattern: /^\s*idli\s+(?:and\s+|with\s+|\+\s*|&\s*|aur\s+)?sambar\s*$/i,
    displayName: 'Idli Sambar',
    components: [
      { name: 'Idli', query: 'idli', defaultPortionGrams: 100 },
      { name: 'Sambar', query: 'sambar', defaultPortionGrams: 150 },
    ],
  },
  {
    pattern: /^\s*(?:medu\s+)?vada\s+(?:and\s+|with\s+|\+\s*|&\s*|aur\s+)?sambar\s*$/i,
    displayName: 'Vada Sambar',
    components: [
      { name: 'Medu Vada', query: 'medu vada', defaultPortionGrams: 80 },
      { name: 'Sambar', query: 'sambar', defaultPortionGrams: 150 },
    ],
  },
  {
    pattern: /^\s*idli\s+(?:and\s+|with\s+|\+\s*|&\s*|aur\s+)?(?:medu\s+)?vada\s*$/i,
    displayName: 'Idli Vada',
    components: [
      { name: 'Idli', query: 'idli', defaultPortionGrams: 100 },
      { name: 'Medu Vada', query: 'medu vada', defaultPortionGrams: 40 },
    ],
  },
  {
    pattern: /^\s*rajma\s+(?:and\s+|with\s+|\+\s*|&\s*|aur\s+)?(?:chawal|rice)\s*$/i,
    displayName: 'Rajma Chawal',
    components: [
      { name: 'Rajma', query: 'rajma', defaultPortionGrams: 150 },
      { name: 'White Rice', query: 'rice white cooked', defaultPortionGrams: 150 },
    ],
  },
  {
    pattern: /^\s*dal\s+(?:and\s+|with\s+|\+\s*|&\s*|aur\s+)?(?:chawal|rice)\s*$/i,
    displayName: 'Dal Chawal',
    components: [
      { name: 'Dal Tadka', query: 'dal tadka', defaultPortionGrams: 150 },
      { name: 'White Rice', query: 'rice white cooked', defaultPortionGrams: 150 },
    ],
  },
  {
    pattern: /^\s*kadhi\s+(?:and\s+|with\s+|\+\s*|&\s*|aur\s+)?(?:chawal|rice)\s*$/i,
    displayName: 'Kadhi Chawal',
    components: [
      { name: 'Kadhi', query: 'kadhi', defaultPortionGrams: 150 },
      { name: 'White Rice', query: 'rice white cooked', defaultPortionGrams: 150 },
    ],
  },
  {
    pattern: /^\s*chole\s+(?:and\s+|with\s+|\+\s*|&\s*|aur\s+)?(?:chawal|rice)\s*$/i,
    displayName: 'Chole Chawal',
    components: [
      { name: 'Chole', query: 'chole', defaultPortionGrams: 150 },
      { name: 'White Rice', query: 'rice white cooked', defaultPortionGrams: 150 },
    ],
  },
  {
    pattern: /^\s*(?:poori|puri)\s+(?:and\s+|with\s+|\+\s*|&\s*|aur\s+)?(?:bhaji|aloo|subji|sabzi)\s*$/i,
    displayName: 'Poori Bhaji',
    components: [
      { name: 'Poori', query: 'poori', defaultPortionGrams: 80 },
      { name: 'Aloo Bhaji', query: 'aloo', defaultPortionGrams: 120 },
    ],
  },
]

const DELIMITER_REGEX = /\s*(?:\+|\band\b|\bwith\b|\baur\b|&|,)\s*/i

function extractLeadingQuantity(part: string): { quantity?: number; cleaned: string } {
  const match = part.match(/^(\d+(?:\.\d+)?)\s*(?:pieces?|pcs?|bowls?|katoris?|plates?|servings?|nos?|x)?\s+(.+)$/i)
  if (match && match[1] && match[2]) {
    const qty = parseFloat(match[1])
    if (Number.isFinite(qty) && qty > 0) {
      return { quantity: qty, cleaned: match[2].trim() }
    }
  }
  return { cleaned: part.trim() }
}

/**
 * Checks whether a query string represents a composite meal.
 */
export function isCompositeMealQuery(query: string): boolean {
  const trimmed = query.trim()
  if (trimmed.length < 3) return false

  for (const pairing of KNOWN_PAIRINGS) {
    if (pairing.pattern.test(trimmed)) return true
  }

  // Check delimiter splitting
  const parts = trimmed.split(DELIMITER_REGEX).map((p) => p.trim()).filter((p) => p.length >= 2)
  return parts.length >= 2
}

/**
 * Splits a composite meal query into component strings.
 */
export function splitCompositeQuery(query: string): string[] {
  const trimmed = query.trim()
  if (trimmed.length < 3) return [trimmed]

  for (const pairing of KNOWN_PAIRINGS) {
    if (pairing.pattern.test(trimmed)) {
      return pairing.components.map((c) => c.query)
    }
  }

  const parts = trimmed.split(DELIMITER_REGEX).map((p) => p.trim()).filter((p) => p.length > 0)
  return parts.length > 0 ? parts : [trimmed]
}

/**
 * Decomposes a query into structured composite meal components, or returns null if not a composite query.
 */
export function decomposeCompositeMeal(query: string): DecomposedMeal | null {
  const trimmed = query.trim()
  if (trimmed.length < 3) return null

  // 1. Check known pairings
  for (const pairing of KNOWN_PAIRINGS) {
    if (pairing.pattern.test(trimmed)) {
      return {
        rawQuery: trimmed,
        displayName: pairing.displayName,
        components: pairing.components.map((c) => ({ ...c })),
      }
    }
  }

  // 2. Check explicit delimiter
  const rawParts = trimmed.split(DELIMITER_REGEX).map((p) => p.trim()).filter((p) => p.length >= 2)
  if (rawParts.length < 2) return null

  const components: CompositeMealComponent[] = rawParts.map((part) => {
    const { quantity, cleaned } = extractLeadingQuantity(part)
    const name = cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
    return {
      name,
      query: cleaned,
      ...(quantity ? { quantity } : {}),
    }
  })

  const displayName = components.map((c) => (c.quantity ? `${c.quantity} ${c.name}` : c.name)).join(' + ')

  return {
    rawQuery: trimmed,
    displayName,
    components,
  }
}
