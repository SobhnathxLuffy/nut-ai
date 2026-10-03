#!/usr/bin/env node
/**
 * WCAG 2.1 contrast gate (UI/UX report Table 11.1 / §11.1, Wave 4).
 *
 * The report's finding: the dark palette (and half the light one) was "designed
 * to AA targets but never computed" — colours shipped on trust. This script is
 * the CI gate that ends that: it parses the SINGLE source of truth
 * (`apps/mobile/src/theme/tokens.ts`), computes the WCAG 2.1 relative
 * luminance + contrast ratio for every declared pair in BOTH themes, and fails
 * the build on any text (<4.5:1) or graphical (<3:1) miss.
 *
 * Why regex parsing and not an import/AST: same reasoning as
 * check-node-purity.mjs — the gate must run before any build step and must not
 * depend on the very toolchain it is guarding. tokens.ts is plain object
 * literals; a small disciplined parser is enough. There is deliberately NO
 * JSON mirror of the tokens: a second copy is a second thing that drifts.
 *
 * Guard rails:
 *   1. COMPLETENESS — every key of `export interface Theme` (except `isDark`)
 *      must resolve in BOTH `lightTheme` and `darkTheme`. A renamed or added
 *      token the parser cannot follow fails the gate with the key name, so a
 *      refactor can never silently drop a pair from the manifest.
 *   2. TIERS — text pairs gate at 4.5:1 (every role below renders at <24px, so
 *      the large-text relief never applies; type-scale.test.ts pins the caption
 *      floor as normal-size), graphical pairs (WCAG 1.4.11: ring strokes, chart
 *      series, icon fills) gate at 3:1, and decorative pairs (hairlines,
 *      skeleton washes, tints, the disabled-CTA surface WCAG exempts) are
 *      LOGGED with no threshold so drift stays visible without gating
 *      decoration.
 *   3. ALPHA — 8-digit hexes (tints/skeletons) are composited over their base
 *      surface before the ratio is computed, because that is what actually
 *      renders: a 10% wash over a card, not the raw ink.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const TOKENS_PATH = join(ROOT, 'apps/mobile/src/theme/tokens.ts')

// ---------------------------------------------------------------------------
// WCAG 2.1 relative luminance + contrast — plain math, no dependencies.
const channel = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))

function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
}

function luminance(rgb) {
  return 0.2126 * channel(rgb[0] / 255) + 0.7152 * channel(rgb[1] / 255) + 0.0722 * channel(rgb[2] / 255)
}

function contrast(fgHex, bgHex) {
  const l1 = luminance(hexToRgb(fgHex))
  const l2 = luminance(hexToRgb(bgHex))
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

function alphaOf(hex) {
  return hex.length === 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1
}

/** Composite an 8-digit-hex wash over a solid base — what actually renders. */
function composite(fgHex, baseHex) {
  const a = alphaOf(fgHex)
  const fg = hexToRgb(fgHex)
  const base = hexToRgb(baseHex)
  const out = [0, 1, 2].map((i) => fg[i] * a + base[i] * (1 - a))
  return `#${out.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`
}

// ---------------------------------------------------------------------------
// Parser: strip comments, then brace-match the four blocks.
const HEX_RE = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** Extract the balanced `{ … }` block following `marker` (marker must be unique). */
function extractBlock(src, marker) {
  const at = src.indexOf(marker)
  if (at === -1) throw new Error(`cannot find "${marker}" in tokens.ts`)
  const open = src.indexOf('{', at)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(open + 1, i)
    }
  }
  throw new Error(`unbalanced braces after "${marker}"`)
}

/** Parse `key: value` entries where value is `'hex'` or `palette.ref`. */
function parseEntries(body) {
  const entries = new Map()
  const re = /([A-Za-z_$][\w$]*)\s*:\s*(?:'([^']+)'|palette\.([A-Za-z_$][\w$]*))/g
  let m
  while ((m = re.exec(body)) !== null) {
    entries.set(m[1], m[2] !== undefined ? m[2] : `palette.${m[3]}`)
  }
  return entries
}

/** Interface keys declared `: string` (booleans like `isDark` are not colours). */
function parseInterfaceKeys(body) {
  const keys = []
  const re = /([A-Za-z_$][\w$]*)\s*:\s*string\b/g
  let m
  while ((m = re.exec(body)) !== null) keys.push(m[1])
  return keys
}

async function loadTokens() {
  const raw = await readFile(TOKENS_PATH, 'utf8')
  const src = stripComments(raw)

  const palette = new Map()
  for (const [k, v] of parseEntries(extractBlock(src, 'export const palette ='))) {
    if (!HEX_RE.test(v)) throw new Error(`palette.${k} is not a 6/8-digit hex: ${v}`)
    palette.set(k, v)
  }

  const themes = {}
  for (const name of ['lightTheme', 'darkTheme']) {
    themes[name] = parseEntries(extractBlock(src, `export const ${name}: Theme =`))
  }

  const interfaceKeys = parseInterfaceKeys(extractBlock(src, 'export interface Theme'))

  // Resolve a theme entry to a concrete hex, or undefined.
  const resolve = (themeName, key) => {
    const raw = themes[themeName].get(key)
    if (raw === undefined) return undefined
    if (raw.startsWith('palette.')) return palette.get(raw.slice(8))
    return HEX_RE.test(raw) ? raw : undefined
  }

  // COMPLETENESS GUARD — every Theme key must resolve in BOTH themes.
  const missing = []
  for (const key of interfaceKeys) {
    for (const themeName of ['lightTheme', 'darkTheme']) {
      if (resolve(themeName, key) === undefined) missing.push(`${themeName}.${key}`)
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `unresolvable Theme key(s) — a token was renamed/added that the contrast gate cannot follow: ${missing.join(', ')}`,
    )
  }

  const light = {}
  const dark = {}
  for (const key of interfaceKeys) {
    light[key] = resolve('lightTheme', key)
    dark[key] = resolve('darkTheme', key)
  }
  return { light, dark }
}

// ---------------------------------------------------------------------------
// The pair manifest — declared once, mirrored across BOTH themes.
//
// Entry shapes:
//   { fg, bg, mode, note }            — solid fg on solid bg.
//   { fg, wash, mode, note }           — fg on (wash composited over bgElevated)
//                                        — the Badge variant rendering.
//   { wash, bg, mode, note, over? }    — LOG-only: the wash's own visibility
//                                        against bg, composited first (and over
//                                        `over` first when stacked, e.g. the
//                                        skeleton sweep crossing the resting
//                                        block).
const TEXT_ROLES = [
  'text',
  'textMuted',
  'textFaint',
  'safety',
  'accent',
  'proteinText',
  'carbsText',
  'fatText',
  'uncertainText',
  'affirmText',
]
const TEXT_SURFACES = ['bg', 'bgElevated', 'bgSunken']

const TIER = {
  text: { threshold: 4.5, label: 'AA text (4.5:1)' },
  graphical: { threshold: 3.0, label: 'WCAG 1.4.11 graphical (3:1)' },
  log: { threshold: null, label: 'logged (no threshold — decorative)' },
}

function buildManifest() {
  const pairs = []
  for (const fg of TEXT_ROLES) {
    for (const bg of TEXT_SURFACES) {
      pairs.push({ fg, bg, mode: 'text', note: 'text-grade role on surface' })
    }
  }
  // Semantic solid backgrounds (Badge tone variants).
  pairs.push({ fg: 'safety', bg: 'safetyBg', mode: 'text', note: 'safety copy on the safety wash' })
  pairs.push({ fg: 'uncertainText', bg: 'uncertainBg', mode: 'text', note: 'uncertain copy on the uncertain wash' })
  // Tint-composited badge pairs (Badge macro/tone variants render on cards).
  pairs.push({ fg: 'proteinText', wash: 'proteinTint', mode: 'text', note: 'protein badge label on its tint over bgElevated' })
  pairs.push({ fg: 'carbsText', wash: 'carbsTint', mode: 'text', note: 'carbs badge label on its tint over bgElevated' })
  pairs.push({ fg: 'fatText', wash: 'fatTint', mode: 'text', note: 'fat badge label on its tint over bgElevated' })
  pairs.push({ fg: 'affirmText', wash: 'affirmTint', mode: 'text', note: 'affirm badge label on its tint over bgElevated' })
  pairs.push({ fg: 'text', wash: 'affirmTint', mode: 'text', note: 'completed-set row text on the affirm tint over bgElevated' })
  // Graphical (3:1) — ring strokes, chart series, icon fills.
  for (const fg of ['protein', 'carbs', 'fat', 'uncertain', 'heart']) {
    for (const bg of ['bg', 'bgElevated']) {
      pairs.push({ fg, bg, mode: 'graphical', note: 'identity stroke/series/fill on surface' })
    }
  }
  pairs.push({ fg: 'ring', bg: 'bg', mode: 'graphical', note: 'progress ring stroke on surface' })
  pairs.push({ fg: 'ring', bg: 'ringTrack', mode: 'graphical', note: 'progress ring stroke on its track' })
  pairs.push({ fg: 'bg', bg: 'affirm', mode: 'graphical', note: 'check-button glyph on the filled affirm surface' })
  // Log-only — decorative drift visibility, never gated.
  for (const bg of ['bg', 'bgElevated']) {
    pairs.push({ fg: 'border', bg, mode: 'log', note: 'decorative hairline' })
  }
  pairs.push({ fg: 'ringTrack', bg: 'bg', mode: 'log', note: 'resting track' })
  pairs.push({ wash: 'skeletonBase', bg: 'bg', mode: 'log', note: 'resting skeleton block over bg' })
  pairs.push({ wash: 'skeletonSweep', bg: 'bg', over: 'skeletonBase', mode: 'log', note: 'shimmer band over the resting block' })
  for (const wash of ['affirmTint', 'uncertainTint', 'proteinTint', 'carbsTint', 'fatTint', 'accentTint']) {
    pairs.push({ wash, bg: 'bg', mode: 'log', note: 'tint wash over bg' })
  }
  pairs.push({ fg: 'textFaint', bg: 'bgSunkenStrong', mode: 'log', note: 'disabled-CTA surface (WCAG exempts disabled)' })
  return pairs
}

const fmt = (n) => n.toFixed(2)

/** Resolve a manifest entry to { name, fgHex, bgHex } inside one theme. */
function resolvePair(entry, theme) {
  if (entry.fg != null) {
    const fgHex = theme[entry.fg]
    if (fgHex === undefined) throw new Error(`pair key "${entry.fg}" does not resolve`)
    let bgHex
    let bgName
    if (entry.wash != null) {
      // Badge-style: the wash composited over the elevated card surface.
      const washHex = theme[entry.wash]
      if (washHex === undefined) throw new Error(`pair key "${entry.wash}" does not resolve`)
      bgHex = composite(washHex, theme.bgElevated)
      bgName = `${entry.wash}/bgElevated`
    } else {
      bgHex = theme[entry.bg]
      if (bgHex === undefined) throw new Error(`pair key "${entry.bg}" does not resolve`)
      bgName = entry.bg
    }
    return { name: `${entry.fg} on ${bgName}`, fgHex, bgHex }
  }
  // Log wash visibility: composited (over `over`, then bg) vs that base.
  const washHex = theme[entry.wash]
  if (washHex === undefined) throw new Error(`pair key "${entry.wash}" does not resolve`)
  let base = theme[entry.bg]
  let baseName = entry.bg
  if (entry.over != null) {
    base = composite(theme[entry.over], base)
    baseName = `${entry.over}/${entry.bg}`
  }
  const rendered = composite(washHex, base)
  return { name: `${entry.wash} on ${baseName}`, fgHex: rendered, bgHex: base }
}

async function main() {
  const { light, dark } = await loadTokens()
  const manifest = buildManifest()

  let failures = 0
  let passed = 0
  let logged = 0
  const perTheme = { light: 0, dark: 0 }
  const failureLines = []

  for (const themeName of ['light', 'dark']) {
    const theme = themeName === 'light' ? light : dark
    console.log(`\n[${themeName}]`)
    for (const entry of manifest) {
      const { name, fgHex, bgHex } = resolvePair(entry, theme)
      const ratio = contrast(fgHex, bgHex)
      const tier = TIER[entry.mode]
      const line = `${name.padEnd(38)} ${fmt(ratio).padStart(6)}:1  ${entry.mode === 'text' ? 'text' : entry.mode === 'graphical' ? 'graph' : 'log  '}  `
      if (tier.threshold === null) {
        logged++
        console.log(`${line}— ${entry.note}`)
      } else if (ratio >= tier.threshold) {
        passed++
        perTheme[themeName]++
        console.log(`${line}pass`)
      } else {
        failures++
        console.log(`${line}FAIL`)
        failureLines.push(
          `pair ${name} [${themeName}]: ${fmt(ratio)}:1 < ${fmt(tier.threshold)}:1 — ${entry.note} (${tier.label})`,
        )
      }
    }
  }

  const gated = passed + failures
  console.log(`\nlogged (no threshold): ${logged} pairs`)

  if (failures > 0) {
    console.error(`\ncontrast: ${failures} FAILING pair(s):`)
    for (const line of failureLines) console.error(`  ${line}`)
    console.error(
      '\n  Every text pair must reach 4.5:1 and every graphical pair 3:1 (WCAG 2.1)\n' +
        '  in BOTH themes. Fix the token in apps/mobile/src/theme/tokens.ts — it is\n' +
        '  the single source of truth this gate parses. Decorative pairs are logged\n' +
        '  above without a threshold.\n',
    )
    process.exit(1)
  }

  console.log(
    `\ncontrast: OK — ${gated}/${gated} pairs pass (light ${perTheme.light}, dark ${perTheme.dark})`,
  )
}

main().catch((err) => {
  console.error('contrast: checker itself failed:', err.message)
  process.exit(1)
})
