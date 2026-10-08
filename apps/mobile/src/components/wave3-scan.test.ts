import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CONFIDENCE_LEGEND_SETTING_KEY,
  analyzingSkeletonRowCount,
  inlineUncertaintyReason,
  shouldShowConfidenceLegend,
} from '../scan/review'
import type { Band } from '@nutai/confidence'

/**
 * UI/UX report Ch. 8.4 (Wave 3) — "Scan and result: confidence you can see".
 *
 * The app/ screens sit behind expo imports vitest's node environment cannot
 * load, so their wiring is pinned by SOURCE SWEEP (the established pattern —
 * wave3-food.test.ts, wave3-home.test.ts, model-hint.test.ts). The pure
 * rulings the screens consume (legend gate, inline reason, skeleton row
 * count) are unit-tested here against the real module that owns them,
 * src/scan/review.ts. Runtime behaviour (pills render, the failed state's
 * Empty + actions, zero console errors) is verified in the headless browser
 * pass for this wave.
 */

const here = dirname(fileURLToPath(import.meta.url))
const camera = readFileSync(join(here, '..', '..', 'app', 'camera.tsx'), 'utf8')
const result = readFileSync(join(here, '..', '..', 'app', 'result.tsx'), 'utf8')
const review = readFileSync(join(here, '..', 'scan', 'review.ts'), 'utf8')

// ---------------------------------------------------------------------------
// Pure rulings (src/scan/review.ts)
// ---------------------------------------------------------------------------

describe('§8.4 — the confidence legend gate (first appearance, persisted dismissal)', () => {
  it('the persistence key is stable and names what it is', () => {
    expect(CONFIDENCE_LEGEND_SETTING_KEY).toBe('confidence_legend_dismissed')
  })

  it('the legend shows by default — only an explicit dismissal hides it', () => {
    expect(shouldShowConfidenceLegend(undefined)).toBe(true)
    expect(shouldShowConfidenceLegend(null)).toBe(true)
    expect(shouldShowConfidenceLegend('')).toBe(true)
    expect(shouldShowConfidenceLegend('1')).toBe(false)
  })
})

describe('§8.4 — inline uncertainty reason (the reason, not behind a tap)', () => {
  const band = (tier: Band['tier'], reasons: string[]): Band => ({ halfPct: 0.3, tier, reasons })

  it('moderate/wide/very_wide bands show their FIRST reason inline', () => {
    expect(inlineUncertaintyReason(band('moderate', ['Cooking oil is not visible in a photo.', 'Mixed composition']))).toBe(
      'Cooking oil is not visible in a photo.',
    )
    expect(inlineUncertaintyReason(band('wide', ['portion estimated visually']))).toBe('portion estimated visually')
    expect(inlineUncertaintyReason(band('very_wide', ['unsure']))).toBe('unsure')
  })

  it('confident tiers stay quiet — an inline reason would be noise that trains ignoring the signal', () => {
    expect(inlineUncertaintyReason(band('none', ['x']))).toBeNull()
    expect(inlineUncertaintyReason(band('tight', ['near-label rounding']))).toBeNull()
  })

  it('no reasons means no line (the chip still offers its tap)', () => {
    expect(inlineUncertaintyReason(band('moderate', []))).toBeNull()
  })
})

describe('§8.4 — the skeleton list BUILDS with the real pipeline stage, never a timer', () => {
  it('rows grow monotonically across the stages: preparing → identifying → matching', () => {
    const stages: Array<'preparing' | 'identifying' | 'matching'> = ['preparing', 'identifying', 'matching']
    const rows = stages.map((s) => analyzingSkeletonRowCount(s))
    expect(rows).toEqual([2, 4, 6])
    expect(rows[0]).toBeLessThan(rows[1])
    expect(rows[1]).toBeLessThan(rows[2])
  })

  it('the count derivation lives in the node-pure review module, not the screen', () => {
    expect(review).toContain('export function analyzingSkeletonRowCount')
  })
})

// ---------------------------------------------------------------------------
// Camera screen — 44pt pills on the Badge primitive + the capture-guide arc
// ---------------------------------------------------------------------------

describe('§8.4 item 1 — mode pills ride the ONE Badge (44pt targets); review mode is GONE', () => {
  // T-IMPL-A (Cal AI overhaul): the Quick/Advanced review toggle is deleted —
  // ONE scan path per capture type. The toggle's absence is now the lock: the
  // camera source may not reference a review mode anywhere again.
  it('no review mode exists on the camera screen', () => {
    expect(camera).not.toContain('ReviewModeToggle')
    expect(camera).not.toContain('reviewRow')
    expect(camera).not.toContain('scan_review_mode')
    expect(camera).not.toContain("role=\"radio\"")
  })

  it('the native mode pills ride the Badge with camera-chrome children — no private pill style remains', () => {
    expect(camera).toMatch(/<Badge[\s\S]*?style=\{\{ width: '47%', backgroundColor: active \? '#fff' : 'rgba\(0,0,0,0\.45\)' \}\}/)
    // The hand-rolled pill styles are dead — an interactive Badge IS the
    // 44pt target (Table 11.1), so no minHeight bookkeeping can regrow.
    expect(camera).not.toContain('modePill')
    expect(camera).not.toContain('reviewPill')
  })

  it('the web mode pills keep the theme-driven Badge with labels (e2e P2-9 contract)', () => {
    expect(camera).toMatch(/<Badge[\s\S]*?label=\{m\.label\}/)
  })
})

describe('§8.4 item 2 — the capture-guide arc doubles as the shutter animation', () => {
  it('the arc exists (SVG ring + quarter arc) and wraps both shutters', () => {
    expect(camera).toContain('function CaptureGuideArc')
    expect(camera).toMatch(/strokeDasharray=\{`\$\{circumference \/ 4\} \$\{circumference\}`\}/)
    expect(camera.match(/<CaptureGuideArc active=\{busy\}/g)?.length).toBe(2) // native + web
  })

  it('the sweep runs only while the shutter works, and reduce-motion never starts it', () => {
    expect(camera).toMatch(/if \(!active\) \{[\s\S]*?sweep\.setValue\(0\)/)
    expect(camera).toMatch(/if \(motionScale === 0\) return/)
    expect(camera).toContain('Easing')
    expect(camera).toContain('motion.slow * 2')
  })
})

// ---------------------------------------------------------------------------
// Analyzing state — skeleton builds, model caption GONE
// ---------------------------------------------------------------------------

describe('§8.4 item 3 — skeleton-during-analyze; the model caption leaves the scan flow', () => {
  it('the analyzing state renders the building skeleton list + the honest spinner/stage copy', () => {
    expect(result).toContain('<AnalyzingSkeletonRows stage={stage} />')
    expect(result).toContain('ActivityIndicator')
    expect(result).toMatch(/stage === 'preparing'\s*\? 'Preparing the photo…'/)
  })

  it('the model caption is gone from BOTH scan-flow screens — no model ids mid-scan', () => {
    // "users need confidence, not vendor names, mid-scan" (§8.4). The model
    // identifier's one honest home is Profile → Diagnostics (Task 16's page);
    // this wave ships pure REMOVAL from the scan flow (no in-flow link).
    expect(result).not.toContain('Scanning with')
    expect(result).not.toContain('ScanModelCaption')
    expect(result).not.toContain('describeActiveModel')
    expect(camera).not.toContain('describeActiveModel')
    expect(camera).not.toContain('Scanning with')
  })

  it('the P1-2 model-hint failure copy STAYS (failure guidance, not a caption)', () => {
    expect(result).toContain('phase.modelHint ? (')
    expect(result).toContain('{phase.modelHint}')
  })
})

// ---------------------------------------------------------------------------
// Result screen — legend, inline reasons, single-sheet Fix, add sheet, failed Empty
// ---------------------------------------------------------------------------

describe('§8.4 item 4 — the confidence legend on first chip appearance', () => {
  it('the legend renders above the meal chip in BOTH views and dismisses through settings', () => {
    expect(result.match(/<ConfidenceLegend \/>/g)?.length).toBe(1) // one editor view — the quick/advanced split is gone (T-IMPL-A)
    expect(result).toContain('function ConfidenceLegend()')
    expect(result).toContain('shouldShowConfidenceLegend(v)')
    expect(result).toContain('putSetting(CONFIDENCE_LEGEND_SETTING_KEY')
    expect(result).toMatch(/accessibilityLabel="Dismiss the confidence guide"/)
  })
})

describe('§8.4 item 5 — uncertain rows show the reason INLINE', () => {
  it('each row computes the inline reason from its band and renders it under the name', () => {
    expect(result).toContain('const inlineReason = item ? inlineUncertaintyReason(item.band) : null')
    expect(result).toMatch(/<Text style=\{\{ color: theme\.uncertainText \}\}>Why: <\/Text>/)
    // The tap-to-expand list SURVIVES — inline is the headline, not a replacement.
    expect(result).toMatch(/expandedRows\.has\(row\.id\)/)
  })
})

describe('§8.4 item 6 — Fix collapses into ONE bottom sheet with note + before/after rows', () => {
  it('the Fix flow is a single Sheet — the full-screen overlay is gone', () => {
    expect(result).toMatch(/<Sheet open=\{fixOpen\} onClose=\{closeFixSheet\} title="Fix result"/)
    expect(result).not.toContain('fixOverlay')
    expect(result).not.toMatch(/fixStage === 'input'[\s\S]{0,80}fixStage === 'confirm'/)
  })

  it('the note field and the parsed before/after rows live in the SAME surface', () => {
    expect(result).toMatch(/placeholder="Describe what needs to be fixed"/)
    expect(result).toContain('function FixOperationRow')
    expect(result).toContain('describeCorrectionOperation(op, nameOf)')
    // The "before" half: update/swap ops show what the row is NOW.
    expect(result).toContain('Now: {formatInt(current.grams)} g')
    // P2-3 survives the collapse: the billed re-analysis stays an explicit button.
    expect(result.match(/label="Re-analyze the photo instead"/g)?.length).toBeGreaterThanOrEqual(2)
  })
})

describe('§8.4 item 7 — Add-ingredient is a bottom sheet with recents', () => {
  it('the add flow rides the Sheet primitive — the full-screen overlay is gone', () => {
    expect(result).toMatch(/<Sheet open=\{open\} onClose=\{onClose\} title="Add ingredient"/)
  })

  it('recents load from the same derivation the Food tab uses, and resolve through the corpus', () => {
    expect(result).toContain('recentFoodsWithGrams(db, Date.now())')
    expect(result).toContain('function addRecent(food: RecentFoodWithGrams)')
    expect(result).toMatch(/<Badge[\s\S]*?label=\{food\.name\}/)
  })
})

describe('§8.4 item 8 — the failed state: real Empty, specific reason, two actions', () => {
  it('the Empty primitive renders the failure with its specific message', () => {
    expect(result).toMatch(/<Empty\s+icon="scan"\s+title="Could not read this meal"\s+message=\{phase\.message\}/)
  })

  it('two actions: retake (or honest retry when retryable) + log manually', () => {
    expect(result).toMatch(/phase\.canRetry\s*\?\s*\{ label: 'Try again', onPress: \(\) => void retryScan\(\) \}\s*: \{ label: 'Retake photo', onPress: retake \}/)
    expect(result).toContain("secondaryAction={{ label: 'Log manually', onPress: logManually }}")
    // Retake discards the dead scan and returns to the camera; manual goes to search.
    expect(result).toContain("router.replace('/camera')")
    expect(result).toContain("router.replace('/food-search')")
  })
})
