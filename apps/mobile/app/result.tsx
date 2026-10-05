import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { WebLookupResult, MacroTotals, IngredientRow, CorrectionIntent } from '@nutai/core-schema'
import { CorrectionIntentZ } from '@nutai/core-schema'
import { TIER_GLYPH, type Band } from '@nutai/confidence'
import type { ScoredCandidate } from '@nutai/resolver'
import { loadFood, resolveByText } from '@nutai/resolver'
import { buildCorrectionPrompt, cheapestModel, type ProviderId } from '@nutai/prompt'
import { ConfidenceChip, ConfidenceReasons } from '../src/components/ConfidenceChip'
import { Button } from '../src/components/Screen'
import { Icon, type IconName } from '../src/components/Icon'
import { Badge } from '../src/components/Badge'
import { Sheet } from '../src/components/Sheet'
import { Empty } from '../src/components/Empty'
import { Skeleton, SkeletonLine, SkeletonRow } from '../src/components/Skeleton'
import { customProviderBaseUrl, logMeal, putSetting, setting, db as openUserDb, undoLastOperation } from '../src/data/repo'
import { resolveSelection } from '../src/data/food-search-select'
import type { ManualFoodSelection } from '../src/data/manual-food'
import { runCorrectionIntent } from '../src/inference/pathA/client'
import { describeCorrectionOperation, rowsNameOf, type CorrectionOperation } from '../src/data/correction-describe'
import { fixScan, lookupOther, retryScan } from '../src/scan/orchestrator'
import { recentFoodsWithGrams, type RecentFoodWithGrams } from '../src/data/one-tap-log'
import {
  CONFIDENCE_LEGEND_SETTING_KEY,
  analyzingSkeletonRowCount,
  estimateProvenanceLabel,
  formatInt,
  inlineUncertaintyReason,
  isWideTier,
  likelyRangeLabel,
  mealTitleFor,
  portionRangeFor,
  quickSetGramsFor,
  roundForUncertainty,
  sceneCaptionFor,
  shouldShowConfidenceLegend,
} from '../src/scan/review'
import {
  portionConfidenceNoteFor,
  preparationNoteFor,
  shouldShowModelQuestionCard,
  summaryLinesFor,
  type ScanResultV13,
  topUncertaintyFor,
} from '../src/scan/review'
import { openIfctDb, openNutritionDb } from '../src/db/expo-adapter'
import { isQuickEligible } from '../src/scan/quick-mode'
import {
  addRow,
  answerQuestion,
  applyWebOption,
  editGrams,
  getPhase,
  getScanReviewMode,
  removeRow,
  reset,
  useScan,
  type ScanReviewMode,
  type WebLookupState,
} from '../src/scan/store'
import { useTheme } from '../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../src/theme/tokens'
import { showToast } from '../src/components/toast-store'
// UI/UX report Table 9.2 (Wave 1c): "Log meal → Success" — the scan result's
// log path is the flagship reward moment.
import { success as hapticSuccess } from '../src/utils/haptics'

/**
 * UI/UX report §8.4 (Wave 3): the confidence legend.
 *
 * ONE explanatory line the first time a confidence chip appears on this
 * screen — dismissible, and the dismissal PERSISTS (settings row), so the
 * legend is a genuine one-time teacher, not a recurring caption. After it,
 * the chips speak for themselves: violet + glyph + "tap for range".
 *
 * THE MODEL CAPTION IS GONE from the scan flow on purpose (same report):
 * "users need confidence, not vendor names, mid-scan". The model identifier
 * now lives in ONE honest home — Profile → Diagnostics (app/diagnostics.tsx,
 * Task 16). The P1-2 model-hint on the FAILED state stays: that is failure
 * guidance, not a caption.
 */
function ConfidenceLegend() {
  const theme = useTheme()
  // null = not read yet; false = dismissed (or unreadable — quiet default).
  const [show, setShow] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    void setting(CONFIDENCE_LEGEND_SETTING_KEY)
      .then((v) => {
        if (live) setShow(shouldShowConfidenceLegend(v))
      })
      .catch(() => {
        if (live) setShow(false)
      })
    return () => {
      live = false
    }
  }, [])
  if (show !== true) return null
  return (
    <View
      accessibilityLabel="About the confidence chips"
      style={[styles.legendCard, { backgroundColor: theme.uncertainBg }]}
    >
      <View style={{ flexDirection: 'row', gap: space.xs, alignItems: 'flex-start' }}>
        <Text style={[type.caption, { color: theme.uncertainText }]}>{TIER_GLYPH.moderate}</Text>
        <Text style={[type.caption, { color: theme.text, flex: 1, lineHeight: 19 }]}>
          Violet chips mark estimates. Tap one for its likely range and the reasons behind it — numbers
          tighten as you confirm details.
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss the confidence guide"
        onPress={() => {
          setShow(false)
          void putSetting(CONFIDENCE_LEGEND_SETTING_KEY, '1')
        }}
        style={{ alignSelf: 'flex-start', minHeight: MIN_TAP_TARGET, justifyContent: 'center' }}
      >
        <Text style={[type.bodyStrong, { color: theme.uncertainText }]}>Got it</Text>
      </Pressable>
    </View>
  )
}

/**
 * §8.4: the skeleton ingredient list that BUILDS while the model works.
 *
 * Row count is anchored to the real pipeline stage (analyzingSkeletonRowCount)
 * — never a fake timer — and each row mimics the ingredient row it is about
 * to become: name + subtitle line on the left, the gram block on the right.
 * The last row renders shorter so a growing list reads as filling in, not
 * appending. The spinner + honest stage copy above stay: this is the 10s+
 * window, and the list is structure, not a fake result.
 */
function AnalyzingSkeletonRows({ stage }: { stage: 'preparing' | 'identifying' | 'matching' }) {
  const count = analyzingSkeletonRowCount(stage)
  return (
    <View style={styles.analyzingList}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.analyzingRow}>
          <View style={{ flex: 1, gap: space.xs }}>
            <SkeletonLine width={i === count - 1 ? '60%' : '80%'} height={16} />
            <SkeletonLine width="45%" height={12} />
          </View>
          <Skeleton width={64} height={16} />
        </View>
      ))}
    </View>
  )
}

/**
 * The result screen.
 *
 * SPEC-accuracy-engine.md §8.2, and ruling 2 of PLAN.md §3.3.
 *
 * ONE primary action: `Log it`. There is no `Fix Results` mode.
 *
 * That is not a simplification, it is the fix. A separate "fix mode" structurally
 * forces the interruption cost to be paid even when nothing is worth asking, and
 * it is what makes "re-analysis that deletes the ingredients you already
 * corrected" possible at all. THE REVIEW SCREEN IS THE FIX SCREEN. Every row is
 * editable in place, and every edit recomputes locally, instantly, for free.
 *
 * QUICK vs ADVANCED (review-mode batch): quick mode renders a compact one-tap
 * "Log it" card ONLY when isQuickEligible() says nothing in the result needs
 * attention — no highlighted questions, no AI-estimate rows, a tight meal band.
 * Anything that deserves a look drops the user into the full review below,
 * automatically. "Review ingredients" is always one tap away from the quick
 * card, and the confidence chip and its reasons are shown in both views.
 *
 * FIX RESULT now runs the AIP-004 correction parser first: the typed note is
 * parsed into structured operations against the current rows and shown as a
 * confirmation card. Updates and removes apply locally and instantly (the same
 * primitives as hand-editing); adds and swaps resolve against the bundled
 * corpus. Anything the parser cannot do — ambiguity, a parse miss, a food the
 * corpus does not know — falls back to the existing full re-analysis
 * (fixScan), exactly as before.
 */
export default function Result() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const phase = useScan()
  const [expandedBand, setExpandedBand] = useState(false)
  // Task 2-d: the per-ingredient range chips. The meal-level chip above keeps
  // its own `expandedBand`; each ROW tracks expansion independently here so a
  // row's chip can finally be tapped (it used to render with onPress undefined
  // and a permanent "tap for range" label — a dead control on the product's
  // most important screen). A Set, not a single id: two rows' ranges can be
  // open at once for comparing, and toggling one never touches the others.
  const [expandedRows, setExpandedRows] = useState<ReadonlySet<string>>(() => new Set())
  // Anchors the DERIVED gram range (grams × (1 ± halfPct)) at first expansion.
  // Without this, tapping [min] would re-center the range on min and every
  // further tap would ratchet the estimate downward. Rows with the model's own
  // portionRange never consult this. Screen-lifetime only, like the phase.
  const bandAnchorRef = useRef<Map<string, number>>(new Map())
  const [logging, setLogging] = useState(false)
  // P1-8: a failed DB write must say so — a silent catch here let the app's
  // most important write no-op without a word (or double-log on re-scan).
  const [logError, setLogError] = useState<string | null>(null)
  const [fixOpen, setFixOpen] = useState(false)
  const [fixText, setFixText] = useState('')
  const [fixBusy, setFixBusy] = useState(false)
  const [fixStage, setFixStage] = useState<'input' | 'confirm'>('input')
  const [fixMessage, setFixMessage] = useState('')
  const [pendingIntent, setPendingIntent] = useState<CorrectionIntent | null>(null)
  const [fixNotice, setFixNotice] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  // P2-5: the grams inputs are CONTROLLED on row state through a per-row draft.
  // A defaultValue input snapshots once — it went stale when applyWebOption
  // changed grams underneath, and clearing the field committed Number('') === 0 g.
  const [gramDrafts, setGramDrafts] = useState<Record<string, string>>({})
  // null = honor the camera's persisted choice; a tap overrides for this scan.
  const [viewOverride, setViewOverride] = useState<ScanReviewMode | null>(null)
  const initialReviewMode = getScanReviewMode()

  /** P2-5: drop the draft so the display snaps back to the stored, validated grams. */
  const snapGramDraft = (rowId: string) => {
    setGramDrafts((d) => {
      if (!(rowId in d)) return d
      const next = { ...d }
      delete next[rowId]
      return next
    })
  }

  /** Task 2-d: expand/collapse one row's range panel; freeze its anchor on first open. */
  const toggleRowBand = (rowId: string, currentGrams: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(rowId)) {
        next.delete(rowId)
      } else {
        next.add(rowId)
        if (!bandAnchorRef.current.has(rowId)) bandAnchorRef.current.set(rowId, currentGrams)
      }
      return next
    })
  }

  if (phase.kind === 'analyzing' || phase.kind === 'captured') {
    const stage = phase.kind === 'analyzing' ? phase.stage : 'preparing'
    const copy =
      stage === 'preparing'
        ? 'Preparing the photo…'
        : stage === 'identifying'
          ? 'Identifying ingredients…'
          : 'Matching the nutrition database…'
    return (
      <ScrollView
        style={{ backgroundColor: theme.bg }}
        contentContainerStyle={[styles.center, { paddingBottom: Math.max(insets.bottom, space.xl) }]}
      >
        <Image source={{ uri: phase.photoUri }} style={styles.photo} />
        <ActivityIndicator color={theme.textMuted} style={{ marginTop: space.xl }} />
        <Text style={[type.heading, { color: theme.text, marginTop: space.md }]}>{copy}</Text>
        <Text style={[type.caption, { color: theme.textMuted, marginTop: space.sm, textAlign: 'center' }]}>
          Your photo is saved — nothing is lost if this fails.
        </Text>
        {/* §8.4: the skeleton ingredient list builds while the model works —
            the mid-scan model caption it replaces is gone (see the
            ConfidenceLegend doc block for where the model id lives now). */}
        <AnalyzingSkeletonRows stage={stage} />
        <Pressable
          onPress={() => router.back()}
          hitSlop={space.md}
          style={{ marginTop: space.xl, minHeight: MIN_TAP_TARGET, justifyContent: 'center' }}
        >
          <Text style={[type.body, { color: theme.textMuted }]}>Close</Text>
        </Pressable>
      </ScrollView>
    )
  }

  if (phase.kind === 'failed') {
    // §8.4: the failed state is a real Empty — the SPECIFIC reason, then two
    // ways out. Retake replaces the scan when the failure says retrying the
    // same photo cannot work (auth, quota, refusal); "Try again" takes that
    // slot when the failure is honestly retryable (rate limit). Log manually
    // is the always-present escape hatch — a failed scan never strands the
    // meal. The P1-2 model hint stays (failure guidance, not a caption).
    const retake = () => {
      reset()
      router.replace('/camera')
    }
    const logManually = () => {
      reset()
      router.replace('/food-search')
    }
    return (
      <ScrollView
        style={{ backgroundColor: theme.bg }}
        contentContainerStyle={[styles.center, { paddingBottom: Math.max(insets.bottom, space.xl) }]}
      >
        <Empty
          icon="scan"
          title="Could not read this meal"
          message={phase.message}
          action={
            phase.canRetry
              ? { label: 'Try again', onPress: () => void retryScan() }
              : { label: 'Retake photo', onPress: retake }
          }
          secondaryAction={{ label: 'Log manually', onPress: logManually }}
        />
        {/* P1-2 (QA report Cycle 2): honest model guidance under the failure
            copy — present ONLY after the same model failed with gateway server
            errors twice in a row (the Ling-3.0-VL retry loop's way out). */}
        {phase.modelHint ? (
          <Text style={[type.caption, { color: theme.textFaint, marginTop: space.sm, textAlign: 'center', lineHeight: 19 }]}>
            {phase.modelHint}
          </Text>
        ) : null}
        <Pressable
          onPress={() => { reset(); router.back() }}
          hitSlop={space.md}
          style={{ marginTop: space.lg, minHeight: MIN_TAP_TARGET, justifyContent: 'center' }}
        >
          <Text style={[type.body, { color: theme.textMuted }]}>Close</Text>
        </Pressable>
      </ScrollView>
    )
  }

  if (phase.kind !== 'ready') {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <Text style={[type.heading, { color: theme.text }]}>Nothing to show yet</Text>
        <Pressable onPress={() => router.back()} hitSlop={space.md} style={{ marginTop: space.xl }}>
          <Text style={[type.body, { color: theme.textMuted }]}>Close</Text>
        </Pressable>
      </View>
    )
  }

  const { result } = phase
  const reviewMode = viewOverride ?? initialReviewMode
  const quickEligible = isQuickEligible(result)
  const highlighted = result.questions.filter((q) => q.state === 'highlighted')
  const preAnswered = result.questions.filter((q) => q.state === 'pre_answered')
  // Task 2-d: scene-aware title + caption, uncertainty-honest hero, and the
  // ONE meal-level lookup-failure notice (the old per-row failure banners
  // repeated the same sentence under every unmatched ingredient).
  const mealTitle = mealTitleFor(result)
  const sceneCaption = sceneCaptionFor(result)
  const heroKcal = roundForUncertainty(result.totals.kcal, result.mealBand.tier)
  const showLikelyRange = isWideTier(result.mealBand.tier)
  const failedLookupRowIds = Object.entries(phase.webLookups)
    .filter(([, s]) => s.status === 'failed')
    .map(([id]) => id)

  // Task 3-c: what the model itself flagged, per contract v1.3.0. Today's
  // pipeline does not set these fields yet; ScanResultV13 adds them OPTIONAL
  // (a checked assignment, not a cast), so this is the single seam that turns
  // into a no-op the moment 3-b lands the real declarations. Every decision
  // below is a tested helper in src/scan/review.ts — the JSX only renders.
  const resultV13: ScanResultV13 = result
  const summaryLines = summaryLinesFor(resultV13)
  const topUncertainty = topUncertaintyFor(resultV13.uncertaintyFactors, { rangeShown: showLikelyRange })
  const portionNote = portionConfidenceNoteFor(resultV13.portionContext)
  const modelQuestion = resultV13.highImpactQuestion ?? null
  // A pre-answered chip is the same question silently answered by a default —
  // it counts as "already on screen" for suppression, exactly like a
  // highlighted chip would.
  const showModelQuestion =
    modelQuestion != null &&
    shouldShowModelQuestionCard(resultV13, [
      ...highlighted.map((q) => q.text),
      ...preAnswered.map((q) => q.text),
    ])

  function logNow() {
    if (logging) return
    setLogging(true)
    setLogError(null)
    void (async () => {
      try {
        await logMeal(result, phase.kind === 'ready' ? phase.meta : null, phase.kind === 'ready' ? phase.photoUri : null, Date.now())
        reset({ retainPhoto: true })
        router.dismissAll()
        // Table 9.2: log meal → success haptic, alongside the flagship toast.
        void hapticSuccess()
        // UI/UX report §10.1 (Wave 1b): "meal logged with an Undo action" —
        // THE flagship toast. The host is mounted at the app root, so it
        // outlives dismissAll; undoLastOperation emits the food-mutation event,
        // which refreshes the Home/Food timelines without any wiring here.
        // 6s window: enough to reconsider without camping on screen.
        showToast({
          message: 'Meal logged.',
          tone: 'success',
          durationMs: 6000,
          action: {
            label: 'Undo',
            onPress: () => {
              void undoLastOperation().then((r) => {
                if (!r.success) {
                  showToast({ message: 'Could not undo — the log changed since this meal was added.', tone: 'error' })
                }
              })
            },
          },
        })
      } catch (caught) {
        const message = caught instanceof Error && caught.message ? caught.message : 'Could not log this meal. Your data is unchanged.'
        setLogError(message)
        setLogging(false)
        // QA P1-8 / UI/UX report §10.1 (Wave 1b): a failed DB write is never
        // silently swallowed. Two layers: the immediate error toast with Retry
        // (the task's fix), and the persistent inline banner with its own
        // Retry above the action bar (the report's "inline error plus retry")
        // for anyone who looks away for the toast's lifetime.
        showToast({
          message,
          tone: 'error',
          action: { label: 'Retry', onPress: logNow },
        })
      }
    })()
  }

  /** Shared failure banner: shown above whichever action bar is visible. */
  const logErrorEl = logError ? (
    <View
      accessibilityRole="alert"
      accessibilityLabel={`Logging failed: ${logError}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingTop: space.sm, backgroundColor: theme.safetyBg }}
    >
      <Text style={[type.caption, { color: theme.safety, flex: 1 }]}>{logError}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Retry logging"
        onPress={logNow}
        hitSlop={space.sm}
        style={{ minHeight: MIN_TAP_TARGET, justifyContent: 'center' }}
      >
        <Text style={[type.bodyStrong, { color: theme.safety }]}>Retry</Text>
      </Pressable>
    </View>
  ) : null

  if (reviewMode === 'quick' && quickEligible) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.lg, paddingBottom: 120 }}>
          {/* P2-14: an accidental scan gets an explicit way out — the analyzing
              and failed states already have Close; the ready state did not. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Discard this scan"
            onPress={() => { reset(); router.back() }}
            hitSlop={space.md}
            style={{ alignSelf: 'flex-end', minHeight: MIN_TAP_TARGET, justifyContent: 'center', paddingHorizontal: space.xs }}
          >
            <Text style={[type.body, { color: theme.textMuted }]}>Discard</Text>
          </Pressable>
          <Text style={[type.title, { color: theme.text }]}>
            {mealTitle}
          </Text>
          {sceneCaption ? (
            <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs }]}>
              {sceneCaption}
            </Text>
          ) : null}
          {/* Task 3-c: what the model could and could not see — under the
              title/caption block in BOTH views. */}
          <HonestySummaryCard known={summaryLines.known} unknown={summaryLines.unknown} />
          <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs }]}>
            Quick result — every ingredient matched the database with high confidence, nothing needs a check.
          </Text>
          {phase.kind === 'ready' && phase.unresolvedItems?.length ? (
            <Text style={[type.caption, { color: theme.textMuted, marginTop: space.md, lineHeight: 19 }]}>
              {`${phase.unresolvedItems.length} receipt ${phase.unresolvedItems.length === 1 ? 'item' : 'items'} could not be matched, so ${phase.unresolvedItems.length === 1 ? 'it was' : 'they were'} not logged: ${phase.unresolvedItems.join(', ')}.`}
            </Text>
          ) : null}

          <View style={{ marginTop: space.lg }}>
            <Text style={[type.display, { color: theme.text, lineHeight: 68 }]}>{heroKcal}</Text>
            <Text style={[type.caption, { color: theme.textMuted, marginTop: -space.xs }]}>kcal</Text>
            {showLikelyRange ? (
              // Task 2-d: a wide band may not claim a precise integer — the
              // measured range travels with the ≈ anchor, in the same view.
              <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs }]}>
                {likelyRangeLabel(result.totals.kcal, result.mealBand)}
              </Text>
            ) : null}
            {/* Task 3-c: the model's own biggest calorie flag, then the
                portion-context chip — both quick and advanced views. */}
            {topUncertainty ? (
              <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs }]}>
                {topUncertainty}
              </Text>
            ) : null}
            {portionNote ? (
              <View accessibilityLabel={portionNote} style={[styles.portionChip, { backgroundColor: theme.uncertainBg }]}>
                <Text style={[type.caption, { color: theme.uncertainText }]}>{portionNote}</Text>
              </View>
            ) : null}

            {/* §8.4: the legend rides the FIRST appearance of a confidence
                chip — one-time, dismissible, persisted. */}
            <ConfidenceLegend />
            <View style={{ marginTop: space.md }}>
              <ConfidenceChip
                value={result.totals.kcal}
                band={result.mealBand}
                expanded={expandedBand}
                onPress={() => setExpandedBand((v) => !v)}
              />
              {expandedBand && <ConfidenceReasons band={result.mealBand} />}
            </View>
          </View>

          <MacroStats totals={result.totals} />

          {/* Task 3-c: the model's ONE high-impact question — high-value
              enough for the quick view too (a quick-eligible scan can still
              carry one). Informational only, never a second way to answer. */}
          {modelQuestion && showModelQuestion ? (
            <ModelQuestionCard question={modelQuestion.question} options={modelQuestion.options} />
          ) : null}

          {/* P2-9: a custom (reseller) model has no catalogue price — say so
              instead of the ledger quietly reading as free. */}
          {phase.meta && phase.meta.costUsd == null ? (
            <Text style={[type.caption, { color: theme.textFaint, marginTop: space.md, textAlign: 'center' }]}>
              Custom model — this scan's exact cost is unknown to the ledger.
            </Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            onPress={() => setViewOverride('advanced')}
            hitSlop={space.sm}
            style={{ marginTop: space.xl, minHeight: MIN_TAP_TARGET, justifyContent: 'center' }}
          >
            <Text style={[type.body, { color: theme.uncertainText }]}>Review ingredients before logging</Text>
          </Pressable>
        </ScrollView>

        <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, space.lg), backgroundColor: theme.bg, borderColor: theme.border }]}>
          {logErrorEl}
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setViewOverride('advanced')}
              style={[styles.secondary, { borderColor: theme.border }]}
            >
              <Text style={[type.bodyStrong, { color: theme.text }]}>Review</Text>
            </Pressable>

            {/* UI/UX report Table 12.2 (Wave 2): the flagship log CTA joins the
                ONE Button at lg — press feedback, state layers and the icon
                slot arrive with it; the 0.6 busy opacity becomes the §4.3
                disabled layer. */}
            <Button
              label={logging ? 'Logging…' : 'Log it'}
              icon="check"
              size="lg"
              selected
              disabled={logging}
              onPress={logNow}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.lg, paddingBottom: 120 }}>
        {/* P2-14: same explicit discard path as the quick view. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Discard this scan"
          onPress={() => { reset(); router.back() }}
          hitSlop={space.md}
          style={{ alignSelf: 'flex-end', minHeight: MIN_TAP_TARGET, justifyContent: 'center', paddingHorizontal: space.xs }}
        >
          <Text style={[type.body, { color: theme.textMuted }]}>Discard</Text>
        </Pressable>
        <Text style={[type.title, { color: theme.text }]}>
          {mealTitle}
        </Text>
        {sceneCaption ? (
          <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs }]}>
            {sceneCaption}
          </Text>
        ) : null}
        {/* Task 3-c: known/unknown summary — under the title/caption block. */}
        <HonestySummaryCard known={summaryLines.known} unknown={summaryLines.unknown} />
        {reviewMode === 'quick' && !quickEligible && (
          <View style={[styles.quickNotice, { backgroundColor: theme.uncertainBg }]}>
            <Text style={[type.caption, { color: theme.text, lineHeight: 19 }]}>
              Some things here deserve a quick look — review before logging.
            </Text>
          </View>
        )}

        {fixNotice ? (
          <Text style={[type.caption, { color: theme.textMuted, marginTop: space.md, lineHeight: 19 }]}>
            {fixNotice}
          </Text>
        ) : null}

        {/* P3-A10: a partial receipt names what it dropped — photographed line
            items must never vanish without a word. */}
        {phase.kind === 'ready' && phase.unresolvedItems?.length ? (
          <Text style={[type.caption, { color: theme.textMuted, marginTop: space.md, lineHeight: 19 }]}>
            {`${phase.unresolvedItems.length} receipt ${phase.unresolvedItems.length === 1 ? 'item' : 'items'} could not be matched, so ${phase.unresolvedItems.length === 1 ? 'it was' : 'they were'} not logged: ${phase.unresolvedItems.join(', ')}.`}
          </Text>
        ) : null}

        {/* The point estimate leads. The band qualifies it — it never replaces it.
            Task 2-d: on a wide band the hero reads "≈ 1,400" and carries the
            measured range right under it — a precise-looking integer would be
            the exact fake certainty this screen exists to prevent. */}
        <View style={{ marginTop: space.lg }}>
          <Text style={[type.display, { color: theme.text, lineHeight: 68 }]}>{heroKcal}</Text>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: -space.xs }]}>kcal</Text>
          {showLikelyRange ? (
            <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs }]}>
              {likelyRangeLabel(result.totals.kcal, result.mealBand)}
            </Text>
          ) : null}
          {/* Task 3-c: the model's own biggest calorie flag, then the
              portion-context chip — both quick and advanced views. */}
          {topUncertainty ? (
            <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs }]}>
              {topUncertainty}
            </Text>
          ) : null}
          {portionNote ? (
            <View accessibilityLabel={portionNote} style={[styles.portionChip, { backgroundColor: theme.uncertainBg }]}>
              <Text style={[type.caption, { color: theme.uncertainText }]}>{portionNote}</Text>
            </View>
          ) : null}

          {/* §8.4: the legend rides the FIRST appearance of a confidence
              chip — one-time, dismissible, persisted. */}
          <ConfidenceLegend />
          <View style={{ marginTop: space.md }}>
            <ConfidenceChip
              value={result.totals.kcal}
              band={result.mealBand}
              expanded={expandedBand}
              onPress={() => setExpandedBand((v) => !v)}
            />
            {expandedBand && <ConfidenceReasons band={result.mealBand} />}
          </View>
        </View>

        <MacroStats totals={result.totals} />

        {/* P2-9: a custom (reseller) model has no catalogue price — say so
            instead of the ledger quietly reading as free. */}
        {phase.meta && phase.meta.costUsd == null ? (
          <Text style={[type.caption, { color: theme.textFaint, marginTop: space.md, textAlign: 'center' }]}>
            Custom model — this scan's exact cost is unknown to the ledger.
          </Text>
        ) : null}

        {/* Highlighted questions: at most two, ever. */}
        {highlighted.map((q) => (
          <View key={q.question.id} style={[styles.qCard, { borderColor: theme.uncertain, backgroundColor: theme.uncertainBg }]}>
            <Text style={[type.bodyStrong, { color: theme.text }]}>{q.text}</Text>
            <View style={styles.chipRow}>
              {q.question.options.map((opt) => (
                <Pressable
                  key={opt.value}
                  onPress={() => answerQuestion(q, opt.value)}
                  hitSlop={space.sm}
                  style={[styles.chip, { borderColor: theme.uncertain }]}
                >
                  <Text style={[type.label, { color: theme.text }]}>{opt.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}

        {/* Every silent default is shown. None is ever hidden. */}
        {preAnswered.length > 0 && (
          <View style={{ marginTop: space.lg, gap: space.xs }}>
            {preAnswered.map((q) => (
              <Pressable
                key={q.question.id}
                accessibilityRole="button"
                accessibilityLabel={`${q.disclosure} — change this answer`}
                onPress={() => answerQuestion(q, q.appliedDefault ?? '')}
                hitSlop={space.xs}
              >
                <Text style={[type.caption, { color: theme.textMuted }]}>
                  {q.disclosure} · <Text style={{ color: theme.uncertainText }}>change</Text>
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* Task 3-c: the model's ONE high-impact question, after the
            question-chip section. Deliberately NON-interactive — answering
            happens in the chips above; this only explains where one answer
            would most improve the estimate. Suppressed when a chip already
            carries the same question (shouldShowModelQuestionCard). */}
        {modelQuestion && showModelQuestion ? (
          <ModelQuestionCard question={modelQuestion.question} options={modelQuestion.options} />
        ) : null}

        <Text style={[type.label, { color: theme.textMuted, marginTop: space.xl }]}>Ingredients</Text>

        {result.meal.ingredients.map((row) => {
          const item = result.items.find((i) => i.row.id === row.id)
          const lookup = phase.webLookups[row.id]
          const lookupFailed = lookup?.status === 'failed'
          // Task 2-d: "Confirmed" once the user owns the quantity (typed or
          // quick-set grams, or a confirmed assumption); "AI ESTIMATE" only
          // while the number is still the model's own. Web-sourced rows keep
          // their citation — the per-100 g data it cites did not change.
          const provenance = estimateProvenanceLabel(row)
          // Task 3-c: the model's preparation read (contract v1.3.0) — only a
          // moderate/heavy ADDED cooking fat earns a note. Rendered as an
          // additional muted line under the provenance chain; never replaces
          // it (different facts: data source vs this meal's cooking).
          const prepNote = preparationNoteFor(row)
          // §8.4: the reason an uncertain row is uncertain, shown INLINE — not
          // behind the chip's tap. The tap still expands the full reason list
          // and the range controls; this line is the headline, not the whole
          // disclosure. Confident tiers stay quiet (inlineUncertaintyReason).
          const inlineReason = item ? inlineUncertaintyReason(item.band) : null
          return (
            <View key={row.id}>
              <View style={[styles.row, { borderColor: theme.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[type.body, { color: theme.text }]}>{row.displayName}</Text>
                  {row.origin === 'web_lookup' && row.sourceUrl ? (
                    <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
                      From {domainOf(row.sourceUrl)}
                    </Text>
                  ) : row.sourceAttribution ? (
                    <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
                      {row.sourceAttribution}
                    </Text>
                  ) : provenance ? (
                    <Text
                      style={[
                        type.caption,
                        { color: provenance.tone === 'positive' ? theme.affirmText : theme.uncertainText, marginTop: 2 },
                      ]}
                    >
                      {provenance.label}
                    </Text>
                  ) : lookupFailed ? (
                    // Task 2-d: the lookup failed on a row that is NOT a bare AI
                    // estimate (e.g. a branded item that matched the corpus), so
                    // nothing above already says the number is unverified. Rows
                    // showing AI ESTIMATE deliberately do NOT get this suffix —
                    // the amber badge already carries the whole message.
                    // Wave 4 wrap (report Ch 13 DoD): the marker is the real
                    // warning icon beside the plain word (the honesty card's
                    // glyph-row pattern) — the "⚠" text glyph dies here.
                    // Wave 5C a11y: the glyph carries the Wave 4d `label` so
                    // the row announces "Estimated" with image semantics —
                    // a lone unnamed role="img" is unnameable to readers.
                    <View style={[styles.honestyLine, { marginTop: 2 }]}>
                      <View style={styles.honestyGlyph}>
                        <Icon name="warning" size={12} color={theme.uncertainText} label="Estimated" />
                      </View>
                      <Text style={[type.caption, { color: theme.uncertainText, lineHeight: 19 }]}>Estimated</Text>
                    </View>
                  ) : null}
                  {prepNote ? (
                    <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>{prepNote}</Text>
                  ) : null}
                  {inlineReason ? (
                    <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
                      <Text style={{ color: theme.uncertainText }}>Why: </Text>
                      {inlineReason}
                    </Text>
                  ) : null}
                  {item && (
                    <ConfidenceChip
                      value={(row.nutrientSnapshot.kcal * row.grams) / 100}
                      band={item.band}
                      expanded={expandedRows.has(row.id)}
                      onPress={() => toggleRowBand(row.id, row.grams)}
                    />
                  )}
                  {item && expandedRows.has(row.id) ? (
                    <RowBandControls
                      row={row}
                      band={item.band}
                      anchorGrams={bandAnchorRef.current.get(row.id) ?? row.grams}
                      onSetGrams={(g) => editGrams(row.id, g)}
                    />
                  ) : null}
                </View>

                <TextInput
                  accessibilityLabel={`Grams of ${row.displayName}`}
                  // Android's TextInput ships font scaling OFF — the explicit
                  // prop keeps the input growing with the OS font size (the
                  // Screen/Field policy; the row is minHeight, no clip).
                  allowFontScaling
                  keyboardType="numeric"
                  value={gramDrafts[row.id] ?? String(Math.round(row.grams))}
                  onChangeText={(t) => {
                    setGramDrafts((d) => ({ ...d, [row.id]: t }))
                    // P2-5: blank text edits nothing — Number('') is 0, and
                    // clearing the field used to momentarily log zero grams.
                    if (t.trim() !== '') editGrams(row.id, Number(t))
                  }}
                  onEndEditing={() => snapGramDraft(row.id)}
                  onBlur={() => snapGramDraft(row.id)}
                  style={[styles.gramInput, { color: theme.text, borderColor: theme.border }]}
                />

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${row.displayName}`}
                  onPress={() => removeRow(row.id)}
                  hitSlop={space.md}
                  style={styles.remove}
                >
                {/* UI/UX report Table 12.1 (Wave 1b): the unicode × remove glyph
                    joins the icon set — one close affordance across the app. */}
                <Icon name="close" size={20} color={theme.textFaint} />
                </Pressable>
              </View>

              {lookup ? <WebLookupCard rowId={row.id} state={lookup} /> : null}
            </View>
          )
        })}

        {/* Task 2-d: ONE meal-level notice for any failed web lookups. The old
            per-row failure banner repeated the same two sentences under every
            unmatched ingredient — N identical alarms, zero added information.
            The per-row residue is the provenance line above. */}
        {failedLookupRowIds.length > 0 ? (
          <View
            accessibilityRole="alert"
            accessibilityLabel="Some ingredients could not be matched to an online source. Their nutrition stays estimated."
            style={[styles.lookupQuiet, { backgroundColor: theme.uncertainBg, marginTop: space.md }]}
          >
            <Icon name="close" size={14} color={theme.uncertain} />
            <Text style={[type.caption, { color: theme.text, flex: 1, lineHeight: 19 }]}>
              Some ingredients couldn't be matched to an online source — their nutrition stays estimated.
            </Text>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add an ingredient"
          onPress={() => setAddOpen(true)}
          style={[styles.addRow, { borderColor: theme.border }]}
        >
          <Icon name="plus" size={16} color={theme.text} />
          <Text style={[type.bodyStrong, { color: theme.text }]}>Add ingredient</Text>
        </Pressable>
      </ScrollView>

      <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, space.lg), backgroundColor: theme.bg, borderColor: theme.border }]}>
        {logErrorEl}
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <Pressable
            accessibilityRole="button"
            onPress={() => { setFixStage('input'); setFixMessage(''); setFixOpen(true) }}
            style={[styles.secondary, { borderColor: theme.border }]}
          >
            <Icon name="pencil" size={16} color={theme.text} />
            <Text style={[type.bodyStrong, { color: theme.text }]}>Fix result</Text>
          </Pressable>

          {/* Table 12.2 (Wave 2): advanced view's log CTA — same migration. */}
          <Button
            label={logging ? 'Logging…' : 'Log it'}
            icon="check"
            size="lg"
            selected
            disabled={logging}
            onPress={logNow}
            style={{ flex: 1 }}
          />
        </View>
      </View>

      {/* UI/UX report §8.4 (Wave 3): Fix collapses from a three-stage
          full-screen overlay into ONE bottom sheet on the Sheet primitive —
          the note field, the parsed before/after rows, Apply, and the
          explicit billed-re-analysis fallback (P2-3) all live in the same
          surface; only the content swaps between note and confirmation. */}
      <Sheet open={fixOpen} onClose={closeFixSheet} title="Fix result" accessibleTitle="Fix result">
        {fixStage === 'input' ? (
          <View style={{ gap: space.md }}>
            <TextInput
              autoFocus
              multiline
              allowFontScaling
              placeholder="Describe what needs to be fixed"
              placeholderTextColor={theme.textFaint}
              value={fixText}
              onChangeText={setFixText}
              style={[styles.fixInput, { color: theme.text, borderColor: theme.border }]}
            />
            <View style={[styles.fixExample, { backgroundColor: theme.bgSunken }]}>
              <Text style={[type.caption, { color: theme.textMuted, lineHeight: 19 }]}>
                <Text style={{ fontWeight: '600' }}>Example:</Text> The wrap is missing the chicken and
                avocado. Only what you mention gets changed — your other edits stay put.
              </Text>
            </View>
            {fixMessage ? (
              <Text style={[type.caption, { color: theme.uncertainText, lineHeight: 19 }]}>{fixMessage}</Text>
            ) : null}
            <Button
              label={fixBusy ? 'Checking…' : 'Update'}
              icon="check"
              size="lg"
              selected
              disabled={!fixText.trim() || fixBusy}
              onPress={() => void submitFix()}
            />
            {fixMessage ? (
              // P2-3: the billed re-analysis is an explicit choice, shown
              // exactly when the parser path failed.
              <Button
                label="Re-analyze the photo instead"
                size="lg"
                disabled={fixBusy}
                onPress={() => {
                  const note = fixText.trim()
                  if (!note) return
                  closeFixSheet()
                  void fixScan(note)
                }}
              />
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel fixing this result"
              onPress={closeFixSheet}
              hitSlop={space.md}
              style={{ alignSelf: 'center', minHeight: MIN_TAP_TARGET, justifyContent: 'center' }}
            >
              <Text style={[type.body, { color: theme.textMuted }]}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <View style={{ gap: space.md }}>
            <Text style={[type.caption, { color: theme.textMuted, lineHeight: 19 }]}>
              Check each change before applying — nothing below is applied until you confirm.
            </Text>
            <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ gap: space.sm }}>
              {fixText.trim() ? (
                <Text style={[type.caption, { color: theme.textFaint, lineHeight: 19 }]}>
                  You asked: “{fixText.trim()}”
                </Text>
              ) : null}
              {(pendingIntent?.operations ?? []).map((op, i) => (
                <FixOperationRow key={`${op.type}-${i}`} op={op} rows={result.meal.ingredients} />
              ))}
              {fixMessage ? (
                <Text style={[type.caption, { color: theme.uncertainText, lineHeight: 19 }]}>{fixMessage}</Text>
              ) : null}
            </ScrollView>
            <Button
              label={fixBusy ? 'Applying…' : 'Apply changes'}
              icon="check"
              size="lg"
              selected
              disabled={fixBusy}
              onPress={() => void applyIntent()}
            />
            <Button
              label="Re-analyze the photo instead"
              size="lg"
              disabled={fixBusy}
              onPress={() => {
                const note = fixText.trim()
                setFixStage('input')
                setPendingIntent(null)
                closeFixSheet()
                if (note) void fixScan(note)
              }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to the fix note"
              onPress={() => { setFixStage('input'); setPendingIntent(null); setFixMessage('') }}
              hitSlop={space.md}
              style={{ alignSelf: 'center', minHeight: MIN_TAP_TARGET, justifyContent: 'center' }}
            >
              <Text style={[type.body, { color: theme.textMuted }]}>Back</Text>
            </Pressable>
          </View>
        )}
      </Sheet>

      {/* §8.4: Add-ingredient is a bottom sheet WITH recents — the foods this
          user actually logs are one tap away before any search happens. */}
      <AddIngredientSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdd={(row) => {
          addRow(row)
          setAddOpen(false)
        }}
      />
    </View>
  )

  /** §8.4: close-and-reset for the Fix sheet (every stage returns to the note). */
  function closeFixSheet() {
    setFixOpen(false)
    setFixStage('input')
    setPendingIntent(null)
    setFixMessage('')
  }

  /**
   * AIP-004 fast path: parse the note into structured ops against the current
   * rows. P2-3: on ANY parser failure the billed full re-analysis is offered
   * as an EXPLICIT button — the old silent fallthrough fired a fully-billed
   * vision scan the user never asked for.
   */
  async function submitFix() {
    const note = fixText.trim()
    if (!note || fixBusy || phase.kind !== 'ready') return
    setFixBusy(true)
    const provider = (await setting('provider')) as ProviderId | 'none' | ''
    if (provider && provider !== 'none') {
      try {
        const model = (await setting('provider_model')) || cheapestModel(provider).id
        const built = buildCorrectionPrompt(note, phase.result.meal.ingredients)
        const res = await runCorrectionIntent({ provider, model, systemPrompt: built.system, userPrompt: built.user, baseUrl: await customProviderBaseUrl() })
        if (res.ok) {
          const intent = CorrectionIntentZ.parse(res.intent)
          if (intent.operations.length === 0 && intent.clarification_needed) {
            setFixMessage(intent.clarification_needed)
            setFixBusy(false)
            return
          }
          if (intent.operations.length > 0) {
            setPendingIntent(intent)
            setFixStage('confirm')
            setFixMessage('')
            setFixBusy(false)
            return
          }
        }
        // P2-3: the parser failed, returned garbage, or answered empty. Keep
        // the typed note and let the user CHOOSE the billed re-analysis.
        setFixMessage(
          res.ok
            ? 'The correction came back empty. You can re-analyze the photo instead — that re-runs the full scan and may cost more.'
            : res.error.kind === 'schema-violation'
              ? 'The correction answer was not in a shape we could read. You can re-analyze the photo instead — that re-runs the full scan and may cost more.'
              : `The correction could not run: ${res.error.message}`,
        )
        setFixBusy(false)
        return
      } catch {
        // CorrectionIntentZ.parse threw on a shape mismatch — same honest
        // treatment: never a silent billed re-analysis.
        setFixMessage('The correction answer was not in a shape we could read. You can re-analyze the photo instead — that re-runs the full scan and may cost more.')
        setFixBusy(false)
        return
      }
    }
    // No provider configured: the parser cannot run. The re-analysis lands on
    // the honest no-key failure phase.
    setFixBusy(false)
    setFixOpen(false)
    setFixStage('input')
    setFixText('')
    setFixMessage('')
    void fixScan(note)
  }

  /** Apply the confirmed operations to the editable draft via the same primitives as hand-editing. */
  async function applyIntent() {
    if (phase.kind !== 'ready' || !pendingIntent || fixBusy) return
    setFixBusy(true)
    // P3-A4: rows are re-read from the live store per operation — a
    // remove_item earlier in the same batch must not leave the later ops
    // resolving grams against a stale pre-removal snapshot.
    const findRow = (id: string) => {
      const current = getPhase()
      return current.kind === 'ready'
        ? current.result.meal.ingredients.find((r) => r.id === id)
        : undefined
    }
    const skipped: string[] = []
    for (const op of pendingIntent.operations) {
      try {
        if (op.type === 'update_quantity') {
          const row = findRow(op.id)
          if (!row) {
            skipped.push('One item to adjust is no longer in the list')
            continue
          }
          if (op.grams == null) {
            skipped.push(`Enter the grams for “${row.displayName}” — “${op.qualitative_size ?? 'that amount'}” could not be converted here`)
            continue
          }
          editGrams(row.id, op.grams)
        } else if (op.type === 'remove_item') {
          removeRow(op.id)
        } else if (op.type === 'add_item') {
          const sel = await resolveCorpusSelection(op.canonical_food_key || op.name, op.grams ?? undefined)
          if (!sel) {
            skipped.push(`“${op.name}” is not in the nutrition database`)
            continue
          }
          addRow(toIngredientRow(sel, op.name))
        } else if (op.type === 'replace_item') {
          const row = findRow(op.id)
          const sel = await resolveCorpusSelection(op.canonical_food_key || op.name, row?.grams)
          if (!sel) {
            skipped.push(`“${op.name}” is not in the nutrition database`)
            continue
          }
          if (row) removeRow(row.id)
          addRow(toIngredientRow(sel, op.name))
        }
      } catch {
        skipped.push('One change could not be applied')
      }
    }
    setFixBusy(false)
    setFixOpen(false)
    setFixStage('input')
    setPendingIntent(null)
    setFixText('')
    setFixMessage('')
    if (skipped.length > 0) setFixNotice(skipped.join(' · '))
  }
}


function domainOf(url: string): string {
  const m = url.match(/^https?:\/\/(?:www\.)?([^/]+)/i)
  return m?.[1] ?? url
}

/**
 * §8.4: one parsed correction as a BEFORE/AFTER row inside the Fix sheet.
 *
 * The "after" line is the ONE operation describer (describeCorrectionOperation
 * — the same text the assistant's proposal card renders, P2-30-e). Update and
 * swap operations also show what the row is NOW, so every change reads as
 * from → to instead of a bare instruction.
 */
function FixOperationRow({ op, rows }: { op: CorrectionOperation; rows: IngredientRow[] }) {
  const theme = useTheme()
  const current =
    op.type === 'update_quantity' || op.type === 'replace_item'
      ? rows.find((r) => r.id === op.id)
      : undefined
  return (
    <View style={[styles.optionRow, { borderColor: theme.border, backgroundColor: theme.bgSunken }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.body, { color: theme.text }]}>
          {describeCorrectionOperation(op, rowsNameOf(rows))}
        </Text>
        {current ? (
          <Text style={[type.caption, { color: theme.textMuted }]}>
            Now: {formatInt(current.grams)} g
          </Text>
        ) : null}
      </View>
    </View>
  )
}

// ---------------------------------------------------------------------------
// Add-from-search (#2) — corpus helpers shared by the add sheet and the
// AIP-004 add/replace operations.
// ---------------------------------------------------------------------------

async function openSourceContext() {
  const [handle, ifctDb, userDb] = await Promise.all([openNutritionDb(), openIfctDb(), openUserDb()])
  return { handle, sourceContext: { ifctDb, userDb } }
}

async function searchCorpusCandidates(query: string): Promise<ScoredCandidate[]> {
  const { handle, sourceContext } = await openSourceContext()
  const r = await resolveByText(handle, {
    canonicalFoodKey: query,
    observedBrand: null,
    prepFacet: null,
    modelCategory: null,
    estimatedGrams: 100,
  }, sourceContext)
  if (r.outcome.kind === 'auto_accept') return [r.outcome.match]
  if (r.outcome.kind === 'disambiguate') return r.outcome.candidates.slice(0, 8)
  return []
}

async function loadCorpusSelection(c: ScoredCandidate): Promise<ManualFoodSelection> {
  const { handle, sourceContext } = await openSourceContext()
  const resolved = await loadFood(handle, c.foodId, sourceContext)
  if (!resolved) throw new Error('No nutrition available for that item')
  return resolveSelection(handle, c, resolved)
}

/** Best single corpus match for a correction add/replace; null when the corpus does not know the food. */
async function resolveCorpusSelection(query: string, gramsOverride?: number): Promise<ManualFoodSelection | null> {
  const { handle, sourceContext } = await openSourceContext()
  const r = await resolveByText(handle, {
    canonicalFoodKey: query,
    observedBrand: null,
    prepFacet: null,
    modelCategory: null,
    estimatedGrams: gramsOverride ?? 100,
  }, sourceContext)
  const match = r.outcome.kind === 'auto_accept'
    ? r.outcome.match
    : r.outcome.kind === 'disambiguate'
      ? r.outcome.candidates[0]
      : null
  if (!match) return null
  const resolved = await loadFood(handle, match.foodId, sourceContext)
  if (!resolved) return null
  const sel = await resolveSelection(handle, match, resolved)
  if (gramsOverride != null) sel.grams = gramsOverride
  return sel
}

/**
 * A user-added row carries a REAL per-100 g snapshot from the corpus — never a
 * model guess — so it behaves exactly like every other row: editable grams,
 * local recompute, honest band. bandHalfPct 0.375 is the shipped
 * fndds_standard_portion baseline from @nutai/confidence, traceable like every
 * other pathway number.
 */
function toIngredientRow(sel: ManualFoodSelection, displayName: string): IngredientRow {
  return {
    id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    displayName,
    sourceFoodId: sel.foodId != null ? String(sel.foodId) : null,
    grams: sel.grams,
    nutrientSnapshot: sel.nutrientSnapshot,
    origin: 'db_search',
    sourceUrl: null,
    sourceAttribution: null,
    gramPathway: 'fndds_standard_portion',
    bandHalfPct: 0.375,
    isEstimate: false,
    assumptions: [],
  }
}

/**
 * The add-from-search sheet — §8.4 (Wave 3): a bottom sheet on the Sheet
 * primitive, WITH recents. The search runs the SAME resolver the manual
 * logging screen uses — one corpus, one ranking, no parallel lookup code to
 * drift. Tap a result (or a recent) and it joins the ingredient list as a
 * fully editable, DB-backed row.
 */
function AddIngredientSheet({
  open,
  onClose,
  onAdd,
}: {
  open: boolean
  onClose: () => void
  onAdd: (row: IngredientRow) => void
}) {
  const theme = useTheme()
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [candidates, setCandidates] = useState<ScoredCandidate[]>([])
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')
  // §8.4: recents — the foods this user actually logs, one tap away before
  // any search happens. Same derivation as the Food tab's one-tap cards.
  const [recents, setRecents] = useState<RecentFoodWithGrams[]>([])

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const db = await openUserDb()
        const foods = await recentFoodsWithGrams(db, Date.now())
        if (live) setRecents(foods.slice(0, 8))
      } catch {
        // Recents are a convenience, never a gate — quiet failure.
      }
    })()
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setCandidates([])
      setSearched(false)
      setError('')
      return
    }
    let live = true
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const found = await searchCorpusCandidates(q)
        if (!live) return
        setCandidates(found)
        setSearched(true)
        setError('')
      } catch {
        if (live) setError('Search failed — try again.')
      } finally {
        if (live) setSearching(false)
      }
    }, 250)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query])

  async function addCandidate(c: ScoredCandidate) {
    try {
      const sel = await loadCorpusSelection(c)
      onAdd(toIngredientRow(sel, sel.displayName))
    } catch {
      setError('Could not load nutrition for that item.')
    }
  }

  /** A recent resolves through the same corpus path as a search result. */
  async function addRecent(food: RecentFoodWithGrams) {
    try {
      const sel = await resolveCorpusSelection(food.name)
      if (!sel) {
        setError(`“${food.name}” is no longer in the nutrition database — try searching for it.`)
        return
      }
      onAdd(toIngredientRow(sel, food.name))
    } catch {
      setError('Could not load nutrition for that item.')
    }
  }

  const showRecents = recents.length > 0 && query.trim().length < 2

  return (
    <Sheet open={open} onClose={onClose} title="Add ingredient" accessibleTitle="Add ingredient">
      <View style={{ gap: space.md }}>
        <TextInput
          autoFocus
          allowFontScaling
          placeholder="Search foods and dishes"
          placeholderTextColor={theme.textFaint}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          style={[styles.otherInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSunken }]}
        />

        {showRecents ? (
          <View>
            <Text style={[type.caption, { color: theme.textFaint, textTransform: 'uppercase' as const }]}>
              Recent
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs }}>
              {recents.map((food) => (
                <Badge
                  key={`recent-${food.id}`}
                  label={food.name}
                  size="sm"
                  onPress={() => void addRecent(food)}
                  accessibilityLabel={`Add ${food.name}`}
                />
              ))}
            </View>
          </View>
        ) : null}

        {searching ? (
          // §9.2: the search is a 1–10s window — content-shaped skeleton rows,
          // not a spinner.
          <View style={{ gap: space.sm }}>
            <SkeletonRow lines={2} />
            <SkeletonRow lines={1} />
            <SkeletonRow lines={2} />
          </View>
        ) : null}

        {error ? (
          <Text accessibilityRole="alert" style={[type.caption, { color: theme.uncertainText }]}>
            {error}
          </Text>
        ) : null}

        <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: space.sm }}>
          {candidates.map((c) => (
            <Pressable
              key={c.foodId}
              accessibilityRole="button"
              accessibilityLabel={`Add ${c.name}`}
              onPress={() => void addCandidate(c)}
              style={[styles.optionRow, { borderColor: theme.border, backgroundColor: theme.bgSunken }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[type.body, { color: theme.text }]}>{c.name}</Text>
                {c.brand ? (
                  <Text style={[type.caption, { color: theme.textMuted, marginTop: 1 }]}>{c.brand}</Text>
                ) : null}
              </View>
              <Text style={[type.label, { color: theme.textMuted }]}>
                {c.energyKcal != null ? `${Math.round(c.energyKcal)} kcal / 100 g` : ''}
              </Text>
            </Pressable>
          ))}
          {searched && !searching && candidates.length === 0 && !error ? (
            <Text style={[type.caption, { color: theme.textMuted, marginTop: space.sm, lineHeight: 19 }]}>
              Nothing matched “{query.trim()}”. Try plainer words, or use Fix result to describe it for re-analysis.
            </Text>
          ) : null}
        </ScrollView>
      </View>
    </Sheet>
  )
}

/**
 * The web-lookup card under a row the corpus missed.
 *
 * Three states: a quiet "checking" line, a generated multiple-choice question
 * where EVERY option already carries its published nutrition (tapping is a
 * free local swap), and an Other row that runs one more search with whatever
 * the user typed.
 */
function WebLookupCard({ rowId, state }: { rowId: string; state: WebLookupState }) {
  const theme = useTheme()
  const [otherOpen, setOtherOpen] = useState(false)
  const [otherText, setOtherText] = useState('')

  if (state.status === 'running') {
    return (
      <View style={[styles.lookupQuiet, { backgroundColor: theme.bgSunken }]}>
        <ActivityIndicator size="small" color={theme.textFaint} />
        <Text style={[type.caption, { color: theme.textMuted }]}>
          Checking the web for published nutrition…
        </Text>
      </View>
    )
  }
  if (state.status === 'failed') {
    // P2-14 + Task 2-d: a failed lookup used to vanish silently; the fix first
    // rendered this banner per row — which repeated the same two sentences
    // under EVERY unmatched ingredient. The failure is now stated ONCE, in a
    // meal-level notice above (see result's failedLookupRowIds block), and
    // each failed row keeps only its provenance residue: the amber "AI
    // ESTIMATE" badge, or a tiny warning-icon "Estimated" line when the row is
    // not a bare estimate. Nothing is hidden — it is just not repeated N times.
    return null
  }

  const result: WebLookupResult = state.result
  // A single auto-applied option needs no card — the row above already shows
  // its source.
  if (result.options.length <= 1 && !result.question) return null

  return (
    <View style={[styles.qCard, { borderColor: theme.uncertain, backgroundColor: theme.uncertainBg, marginTop: space.sm }]}>
      <Text style={[type.bodyStrong, { color: theme.text }]}>
        {result.question ?? 'Which one was it?'}
      </Text>
      {result.source_url ? (
        <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
          Menu data from {domainOf(result.source_url)}
        </Text>
      ) : null}

      <View style={{ marginTop: space.md, gap: space.sm }}>
        {result.options.map((opt) => (
          <Pressable
            key={opt.label}
            accessibilityRole="button"
            accessibilityLabel={`${opt.label}${opt.serving_desc ? `, ${opt.serving_desc}` : ''}, ${Math.round(opt.calories_kcal)} kcal`}
            onPress={() => applyWebOption(rowId, opt, result.source_url)}
            style={[styles.optionRow, { borderColor: theme.uncertain, backgroundColor: theme.bg }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[type.body, { color: theme.text }]}>{opt.label}</Text>
              {opt.serving_desc ? (
                <Text style={[type.caption, { color: theme.textMuted, marginTop: 1 }]}>{opt.serving_desc}</Text>
              ) : null}
            </View>
            <Text style={[type.label, { color: theme.textMuted }]}>{Math.round(opt.calories_kcal)} kcal</Text>
          </Pressable>
        ))}

        {otherOpen ? (
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
            <TextInput
              autoFocus
              allowFontScaling
              placeholder="Type what it was"
              placeholderTextColor={theme.textFaint}
              value={otherText}
              onChangeText={setOtherText}
              onSubmitEditing={() => {
                if (otherText.trim()) void lookupOther(rowId, otherText.trim())
                setOtherOpen(false)
              }}
              returnKeyType="search"
              style={[styles.otherInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bg }]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Search the web for this food"
              onPress={() => {
                if (otherText.trim()) void lookupOther(rowId, otherText.trim())
                setOtherOpen(false)
              }}
              hitSlop={space.sm}
              style={{ minHeight: MIN_TAP_TARGET, justifyContent: 'center' }}
            >
              <Icon name="search" size={18} color={theme.text} />
            </Pressable>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="It was something else — search the web"
            onPress={() => setOtherOpen(true)}
            style={[styles.optionRow, { borderColor: theme.border, backgroundColor: theme.bg }]}
          >
            <Text style={[type.body, { color: theme.textMuted }]}>Other…</Text>
          </Pressable>
        )}
      </View>
    </View>
  )
}

/**
 * Task 2-d: the expanded panel under a row's range chip.
 *
 * Shows the honest gram range (the model's own portionRange when the scan
 * carried one, else the band-derived range around the anchored estimate), the
 * band's reasons, and the three quick controls. Every control routes through
 * editGrams — the same primitive as the grams field — so the edit recomputes
 * locally, tags the row user-edited, and flips its provenance to "Confirmed".
 * `typical` is the anchored estimate, so it doubles as "put it back".
 */
function RowBandControls({
  row,
  band,
  anchorGrams,
  onSetGrams,
}: {
  row: IngredientRow
  band: Band
  anchorGrams: number
  onSetGrams: (grams: number) => void
}) {
  const theme = useTheme()
  const range = portionRangeFor(row, band, anchorGrams)
  const quick = quickSetGramsFor(row, band, anchorGrams)
  return (
    <View style={{ marginTop: space.sm, gap: space.xs }}>
      <Text style={[type.caption, { color: theme.textMuted }]}>
        Likely {formatInt(range.minG)}–{formatInt(range.maxG)} g
      </Text>
      <ConfidenceReasons band={band} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        {(['min', 'typical', 'max'] as const).map((k) => (
          <Pressable
            key={k}
            accessibilityRole="button"
            accessibilityLabel={`Set ${row.displayName} to ${Math.round(quick[k])} grams`}
            onPress={() => onSetGrams(quick[k])}
            hitSlop={space.xs}
            style={[styles.quickSet, { borderColor: theme.border }]}
          >
            <Text style={[type.label, { color: theme.text }]}>
              {k} · {formatInt(quick[k])} g
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

function Macro({
  label,
  value,
  unit = 'g',
  color,
  icon,
}: {
  label: string
  value: number
  unit?: string
  color: string
  icon: IconName
}) {
  const theme = useTheme()
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
        <Text style={[type.heading, { color: theme.text }]}>{Math.round(value)}</Text>
        <Text style={[type.caption, { color: theme.textFaint }]}>{unit}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: 2 }}>
        <Icon name={icon} size={14} color={color} />
        <Text style={[type.caption, { color: theme.textMuted }]}>{label}</Text>
      </View>
    </View>
  )
}

/** Only nutrients with reliable end-to-end coverage are shown here. */
function MacroStats({ totals }: { totals: MacroTotals }) {
  const theme = useTheme()
  return (
    <View style={[styles.statsPage, { marginTop: space.xl }]}>
      <Macro label="Protein" value={totals.protein_g} color={theme.protein} icon="protein" />
      <Macro label="Carbs" value={totals.carbs_g} color={theme.carbs} icon="carbs" />
      <Macro label="Fat" value={totals.fat_g} color={theme.fat} icon="fat" />
    </View>
  )
}

/**
 * Task 3-c: the known/unknown summary card (contract v1.3.0).
 *
 * Two independent, optional lines: what the model could SEE (affirm) and what
 * it could NOT (uncertain — violet, an invitation to check, never a scold).
 * Non-interactive by design; the card exists so silence can never fake
 * knowledge. Renders nothing when both lines are absent — summaryLinesFor
 * already applied the trimming/emptiness rules.
 *
 * Wave 4d (report Ch 13 DoD “no text glyph standing in for a symbol”): the
 * line markers are the real check/search ICONS beside the text, replacing
 * the old "✓ "/"? " text prefixes — the app's last text glyph dies here.
 * Wave 5C a11y: each glyph carries the Wave 4d `label` (the icon-label
 * call-site migration this row pattern was waiting for) so the markers
 * announce "Identified" / "Could not identify" with image semantics
 * instead of surfacing as unnamed role="img" nodes in the tree.
 */
function HonestySummaryCard({ known, unknown }: { known: string | null; unknown: string | null }) {
  const theme = useTheme()
  if (known == null && unknown == null) return null
  return (
    <View accessibilityLabel="What the model could and could not identify" style={[styles.honestyCard, { backgroundColor: theme.bgSunken }]}>
      {known != null ? (
        <View style={styles.honestyLine}>
          <View style={styles.honestyGlyph}>
            <Icon name="check" size={12} color={theme.affirmText} label="Identified" />
          </View>
          <Text style={[type.caption, { color: theme.affirmText, lineHeight: 19 }]}>{known}</Text>
        </View>
      ) : null}
      {unknown != null ? (
        <View style={styles.honestyLine}>
          <View style={styles.honestyGlyph}>
            <Icon name="search" size={12} color={theme.uncertainText} label="Could not identify" />
          </View>
          <Text style={[type.caption, { color: theme.uncertainText, lineHeight: 19 }]}>{unknown}</Text>
        </View>
      ) : null}
    </View>
  )
}

/**
 * Task 3-c: the model's ONE high-impact question, stated as information.
 *
 * Deliberately NOT a chip: answering happens in the interactive violet chips
 * above (3-b promotes keyword matches there); this card only explains which
 * single answer would most improve the estimate. Neutral border + sunken
 * background keep it visually distinct from the interactive question cards,
 * and the explainer says so in words. No Pressable anywhere — it renders in
 * both quick and advanced views whenever a chip does not already carry it.
 */
function ModelQuestionCard({ question, options }: { question: string; options: ReadonlyArray<string> }) {
  const theme = useTheme()
  return (
    <View
      accessibilityLabel={`The model's biggest question: ${question}`}
      style={[styles.qCard, { borderColor: theme.border, backgroundColor: theme.bgSunken }]}
    >
      <Text style={[type.label, { color: theme.textMuted }]}>The model's biggest question</Text>
      <Text style={[type.bodyStrong, { color: theme.text, marginTop: space.xs }]}>{question}</Text>
      {options.length > 0 ? (
        <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs, lineHeight: 19 }]}>
          {options.join(' · ')}
        </Text>
      ) : null}
      <Text style={[type.caption, { color: theme.textFaint, marginTop: space.sm, lineHeight: 19 }]}>
        Answering this improves the estimate most. (Informational — tap a chip above to answer.)
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  statsPage: { flexDirection: 'row', gap: space.md },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    minHeight: MIN_TAP_TARGET,
  },
  fixInput: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    minHeight: 88,
    // Wave 1a: 16px fix textarea already matched type.body — reference the
    // token programmatically (Table 3.1).
    fontSize: type.body.fontSize,
    textAlignVertical: 'top',
    backgroundColor: 'transparent',
  },
  fixExample: { padding: space.lg, borderRadius: radius.lg },
  // §8.4: the skeleton ingredient list that builds while the model works —
  // bounded width, row rhythm matches the real ingredient rows.
  analyzingList: { width: '100%', maxWidth: 420, marginTop: space.xl, gap: space.md },
  analyzingRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  // §8.4: the one-time confidence legend — violet wash, quiet border.
  legendCard: {
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.md,
    gap: space.xs,
  },
  qCard: { marginTop: space.lg, padding: space.lg, borderRadius: radius.lg, borderWidth: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  // Task 2-d: the [min] [typical] [max] quick controls. Full tap target — a
  // control that sets 300 g on a child's dinner earns the same 44 pt the
  // primary buttons get.
  quickSet: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    minHeight: MIN_TAP_TARGET,
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  gramInput: {
    width: 64,
    textAlign: 'right',
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: MIN_TAP_TARGET,
  },
  photo: { width: 160, height: 160, borderRadius: radius.lg },
  lookupQuiet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    marginTop: space.sm,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: MIN_TAP_TARGET,
  },
  otherInput: {
    flex: 1,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: MIN_TAP_TARGET,
  },
  remove: { width: MIN_TAP_TARGET, height: MIN_TAP_TARGET, alignItems: 'center', justifyContent: 'center' },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    minHeight: MIN_TAP_TARGET,
    marginTop: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    borderRadius: radius.md,
  },
  quickNotice: {
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.md,
  },
  // Task 3-c: the known/unknown summary card — neutral sunken surface, the
  // affirm/uncertain line colors carry the meaning. Static text, no tap.
  honestyCard: {
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.md,
    gap: space.xs,
  },
  // Wave 4d: each summary line is an icon + text row (the icon replaces the
  // old "✓ "/"? " text prefix). The glyph drops 3.5 into the caption's 19px
  // first line so it optically centers against the text, and the row keeps
  // wrapping text hanging off a first-line icon instead of centering against
  // the whole block.
  honestyLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.xs,
  },
  honestyGlyph: {
    marginTop: 3.5,
  },
  // Task 3-c: the portion-context honesty chip — a static badge (a View, not
  // a Pressable), so it intentionally has no MIN_TAP_TARGET.
  portionChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    marginTop: space.xs,
  },
  actions: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
})
