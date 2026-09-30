import { router } from 'expo-router'
import { useEffect, useState } from 'react'
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
import type { ScoredCandidate } from '@nutai/resolver'
import { loadFood, resolveByText } from '@nutai/resolver'
import { buildCorrectionPrompt, cheapestModel, type ProviderId } from '@nutai/prompt'
import { ConfidenceChip, ConfidenceReasons } from '../src/components/ConfidenceChip'
import { Icon, type IconName } from '../src/components/Icon'
import { customProviderBaseUrl, logMeal, setting, db as openUserDb } from '../src/data/repo'
import { resolveSelection } from '../src/data/food-search-select'
import type { ManualFoodSelection } from '../src/data/manual-food'
import { runCorrectionIntent } from '../src/inference/pathA/client'
import { fixScan, lookupOther, retryScan } from '../src/scan/orchestrator'
import { describeActiveModel } from '../src/inference/active-model'
import { openIfctDb, openNutritionDb } from '../src/db/expo-adapter'
import { isQuickEligible } from '../src/scan/quick-mode'
import {
  addRow,
  answerQuestion,
  applyWebOption,
  editGrams,
  getScanReviewMode,
  removeRow,
  reset,
  useScan,
  type ScanReviewMode,
  type WebLookupState,
} from '../src/scan/store'
import { useTheme } from '../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../src/theme/tokens'

/**
 * The small "which model is reading this photo" line. BYO-key means the user
 * chose (and pays) a specific model — the scan screen should show exactly what
 * runs, the same way the assistant header does.
 */
function ScanModelCaption() {
  const theme = useTheme()
  const [line, setLine] = useState('')
  useEffect(() => {
    let live = true
    void describeActiveModel('scan').then((m) => {
      if (live) setLine(m ?? '')
    })
    return () => {
      live = false
    }
  }, [])
  if (!line) return null
  return (
    <Text style={[type.micro, { color: theme.textFaint, marginTop: space.xs, textAlign: 'center' }]}>
      Scanning with {line}
    </Text>
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
  // null = honor the camera's persisted choice; a tap overrides for this scan.
  const [viewOverride, setViewOverride] = useState<ScanReviewMode | null>(null)
  const initialReviewMode = getScanReviewMode()

  if (phase.kind === 'analyzing' || phase.kind === 'captured') {
    const stage = phase.kind === 'analyzing' ? phase.stage : 'preparing'
    const copy =
      stage === 'preparing'
        ? 'Preparing the photo…'
        : stage === 'identifying'
          ? 'Identifying ingredients…'
          : 'Matching the nutrition database…'
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <Image source={{ uri: phase.photoUri }} style={styles.photo} />
        <ActivityIndicator color={theme.textMuted} style={{ marginTop: space.xl }} />
        <Text style={[type.heading, { color: theme.text, marginTop: space.md }]}>{copy}</Text>
        <ScanModelCaption />
        <Text style={[type.caption, { color: theme.textMuted, marginTop: space.sm, textAlign: 'center' }]}>
          Your photo is saved — nothing is lost if this fails.
        </Text>
        <Pressable onPress={() => router.back()} hitSlop={space.md} style={{ marginTop: space.xl }}>
          <Text style={[type.body, { color: theme.textMuted }]}>Close</Text>
        </Pressable>
      </View>
    )
  }

  if (phase.kind === 'failed') {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <Image source={{ uri: phase.photoUri }} style={[styles.photo, { opacity: 0.5 }]} />
        <Text style={[type.heading, { color: theme.text, marginTop: space.xl, textAlign: 'center' }]}>
          Could not read this meal
        </Text>
        <Text style={[type.caption, { color: theme.textMuted, marginTop: space.sm, textAlign: 'center', lineHeight: 19 }]}>
          {phase.message}
        </Text>
        {phase.canRetry ? (
          <Pressable
            onPress={() => void retryScan()}
            style={[styles.primary, { backgroundColor: theme.text, marginTop: space.xl, paddingHorizontal: space.xl }]}
          >
            <Text style={[type.bodyStrong, { color: theme.bg }]}>Try again</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => { reset(); router.back() }}
          hitSlop={space.md}
          style={{ marginTop: space.lg }}
        >
          <Text style={[type.body, { color: theme.textMuted }]}>Close</Text>
        </Pressable>
      </View>
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

  function logNow() {
    if (logging) return
    setLogging(true)
    setLogError(null)
    void (async () => {
      try {
        await logMeal(result, phase.kind === 'ready' ? phase.meta : null, phase.kind === 'ready' ? phase.photoUri : null, Date.now())
        reset({ retainPhoto: true })
        router.dismissAll()
      } catch (caught) {
        setLogError(caught instanceof Error && caught.message ? caught.message : 'Could not log this meal. Your data is unchanged.')
        setLogging(false)
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
          <Text style={[type.title, { color: theme.text }]}>
            {result.items[0]?.row.displayName ?? 'Your meal'}
          </Text>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs }]}>
            Quick result — every ingredient matched the database with high confidence, nothing needs a check.
          </Text>

          <View style={{ marginTop: space.lg }}>
            <Text style={[type.hero, { color: theme.text }]}>{result.totals.kcal}</Text>
            <Text style={[type.caption, { color: theme.textMuted, marginTop: -space.xs }]}>kcal</Text>

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

          <Pressable
            accessibilityRole="button"
            onPress={() => setViewOverride('advanced')}
            hitSlop={space.sm}
            style={{ marginTop: space.xl, minHeight: MIN_TAP_TARGET, justifyContent: 'center' }}
          >
            <Text style={[type.body, { color: theme.uncertain }]}>Review ingredients before logging</Text>
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

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Log it"
              disabled={logging}
              onPress={logNow}
              style={[styles.primary, { flex: 1, backgroundColor: theme.text }, logging && { opacity: 0.6 }]}
            >
              <Text style={[type.bodyStrong, { color: theme.bg }]}>{logging ? 'Logging…' : 'Log it'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.lg, paddingBottom: 120 }}>
        <Text style={[type.title, { color: theme.text }]}>
          {result.items[0]?.row.displayName ?? 'Your meal'}
        </Text>

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

        {/* The point estimate leads. The band qualifies it — it never replaces it. */}
        <View style={{ marginTop: space.lg }}>
          <Text style={[type.hero, { color: theme.text }]}>{result.totals.kcal}</Text>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: -space.xs }]}>kcal</Text>

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
              <Pressable key={q.question.id} onPress={() => answerQuestion(q, q.appliedDefault ?? '')} hitSlop={space.xs}>
                <Text style={[type.caption, { color: theme.textMuted }]}>
                  {q.disclosure} · <Text style={{ color: theme.uncertain }}>change</Text>
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        <Text style={[type.label, { color: theme.textMuted, marginTop: space.xl }]}>Ingredients</Text>

        {result.meal.ingredients.map((row) => {
          const item = result.items.find((i) => i.row.id === row.id)
          const lookup = phase.webLookups[row.id]
          return (
            <View key={row.id}>
              <View style={[styles.row, { borderColor: theme.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[type.body, { color: theme.text }]}>{row.displayName}</Text>
                  {row.origin === 'web_lookup' && row.sourceUrl ? (
                    <Text style={[type.micro, { color: theme.textMuted, marginTop: 2 }]}>
                      From {domainOf(row.sourceUrl)}
                    </Text>
                  ) : row.sourceAttribution ? (
                    <Text style={[type.micro, { color: theme.textMuted, marginTop: 2 }]}>
                      {row.sourceAttribution}
                    </Text>
                  ) : row.isEstimate ? (
                    <Text style={[type.micro, { color: theme.uncertain, marginTop: 2 }]}>AI ESTIMATE</Text>
                  ) : null}
                  {item && <ConfidenceChip value={(row.nutrientSnapshot.kcal * row.grams) / 100} band={item.band} />}
                </View>

                <TextInput
                  accessibilityLabel={`Grams of ${row.displayName}`}
                  keyboardType="numeric"
                  defaultValue={String(Math.round(row.grams))}
                  onChangeText={(t) => editGrams(row.id, Number(t))}
                  style={[styles.gramInput, { color: theme.text, borderColor: theme.border }]}
                />

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${row.displayName}`}
                  onPress={() => removeRow(row.id)}
                  hitSlop={space.md}
                  style={styles.remove}
                >
                  <Text style={{ color: theme.textFaint, fontSize: 20 }}>×</Text>
                </Pressable>
              </View>

              {lookup ? <WebLookupCard rowId={row.id} state={lookup} /> : null}
            </View>
          )
        })}

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

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Log it"
            disabled={logging}
            onPress={logNow}
            style={[styles.primary, { flex: 1, backgroundColor: theme.text }, logging && { opacity: 0.6 }]}
          >
            <Text style={[type.bodyStrong, { color: theme.bg }]}>{logging ? 'Logging…' : 'Log it'}</Text>
          </Pressable>
        </View>
      </View>

      {fixOpen ? (
        <View style={[styles.fixOverlay, { backgroundColor: theme.bg, paddingTop: insets.top + space.xl }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Icon name="pencil" size={20} color={theme.text} />
            <Text style={[type.title, { color: theme.text }]}>Fix result</Text>
          </View>

          {fixStage === 'input' ? (
            <>
              <TextInput
                autoFocus
                multiline
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
                <Text style={[type.caption, { color: theme.uncertain, marginTop: space.lg, lineHeight: 19 }]}>
                  {fixMessage}
                </Text>
              ) : null}
              <View style={{ flex: 1 }} />
              <Pressable
                accessibilityRole="button"
                disabled={!fixText.trim() || fixBusy}
                onPress={() => void submitFix()}
                style={[
                  styles.primary,
                  { backgroundColor: theme.text, marginBottom: Math.max(insets.bottom, space.lg) },
                  (!fixText.trim() || fixBusy) && { opacity: 0.4 },
                ]}
              >
                <Text style={[type.bodyStrong, { color: theme.bg }]}>{fixBusy ? 'Checking…' : 'Update'}</Text>
              </Pressable>
              <Pressable
                onPress={() => { setFixOpen(false); setFixStage('input'); setFixMessage('') }}
                hitSlop={space.md}
                style={{ alignSelf: 'center', marginBottom: Math.max(insets.bottom, space.lg) }}
              >
                <Text style={[type.body, { color: theme.textMuted }]}>Cancel</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={[type.caption, { color: theme.textMuted, marginTop: space.md, lineHeight: 19 }]}>
                Check each change before applying — nothing below is applied until you confirm.
              </Text>
              <ScrollView style={{ marginTop: space.lg }} contentContainerStyle={{ gap: space.sm }}>
                {(pendingIntent?.operations ?? []).map((op, i) => (
                  <View key={`${op.type}-${i}`} style={[styles.optionRow, { borderColor: theme.border, backgroundColor: theme.bgSunken }]}>
                    <Text style={[type.body, { color: theme.text, flex: 1 }]}>
                      {describeOperation(op, result.meal.ingredients)}
                    </Text>
                  </View>
                ))}
                {fixMessage ? (
                  <Text style={[type.caption, { color: theme.uncertain, lineHeight: 19 }]}>{fixMessage}</Text>
                ) : null}
              </ScrollView>
              <View style={{ flex: 1 }} />
              <Pressable
                accessibilityRole="button"
                disabled={fixBusy}
                onPress={() => void applyIntent()}
                style={[styles.primary, { backgroundColor: theme.text, marginBottom: space.md }, fixBusy && { opacity: 0.4 }]}
              >
                <Text style={[type.bodyStrong, { color: theme.bg }]}>{fixBusy ? 'Applying…' : 'Apply changes'}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={fixBusy}
                onPress={() => {
                  const note = fixText.trim()
                  setFixOpen(false)
                  setFixStage('input')
                  setPendingIntent(null)
                  setFixText('')
                  setFixMessage('')
                  if (note) void fixScan(note)
                }}
                style={[styles.primary, { backgroundColor: theme.bgSunken, marginBottom: space.md }]}
              >
                <Text style={[type.bodyStrong, { color: theme.text }]}>Re-analyze the photo instead</Text>
              </Pressable>
              <Pressable
                onPress={() => { setFixStage('input'); setPendingIntent(null); setFixMessage('') }}
                hitSlop={space.md}
                style={{ alignSelf: 'center', marginBottom: Math.max(insets.bottom, space.lg) }}
              >
                <Text style={[type.body, { color: theme.textMuted }]}>Back</Text>
              </Pressable>
            </>
          )}
        </View>
      ) : null}

      {addOpen ? (
        <AddIngredientSheet
          onClose={() => setAddOpen(false)}
          onAdd={(row) => {
            addRow(row)
            setAddOpen(false)
          }}
        />
      ) : null}
    </View>
  )

  /** AIP-004 fast path: parse the note into structured ops; fall back to full re-analysis when it cannot. */
  async function submitFix() {
    const note = fixText.trim()
    if (!note || fixBusy || phase.kind !== 'ready') return
    setFixBusy(true)
    try {
      const provider = (await setting('provider')) as ProviderId | 'none' | ''
      if (provider && provider !== 'none') {
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
      }
    } catch {
      // Parser unavailable (no key, malformed response) — the classic path below
      // is exactly the behavior every earlier version shipped.
    }
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
    const rows = phase.result.meal.ingredients
    const skipped: string[] = []
    for (const op of pendingIntent.operations) {
      try {
        if (op.type === 'update_quantity') {
          const row = rows.find((r) => r.id === op.id)
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
          const row = rows.find((r) => r.id === op.id)
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

function describeOperation(
  op: CorrectionIntent['operations'][number],
  rows: IngredientRow[],
): string {
  const nameOf = (id: string) => rows.find((r) => r.id === id)?.displayName ?? 'that item'
  switch (op.type) {
    case 'update_quantity':
      return op.grams != null
        ? `Set “${nameOf(op.id)}” to ${Math.round(op.grams)} g`
        : `Adjust “${nameOf(op.id)}” (${op.qualitative_size ?? 'amount'})`
    case 'remove_item':
      return `Remove “${nameOf(op.id)}”`
    case 'add_item':
      return `Add “${op.name}”${op.grams != null ? ` (~${Math.round(op.grams)} g)` : ''}`
    case 'replace_item':
      return `Swap “${nameOf(op.id)}” for “${op.name}”`
  }
}

function domainOf(url: string): string {
  const m = url.match(/^https?:\/\/(?:www\.)?([^/]+)/i)
  return m?.[1] ?? url
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
 * The add-from-search sheet. The search runs the SAME resolver the manual
 * logging screen uses — one corpus, one ranking, no parallel lookup code to
 * drift. Tap a result and it joins the ingredient list as a fully editable,
 * DB-backed row.
 */
function AddIngredientSheet({
  onClose,
  onAdd,
}: {
  onClose: () => void
  onAdd: (row: IngredientRow) => void
}) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [candidates, setCandidates] = useState<ScoredCandidate[]>([])
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')

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

  return (
    <View style={[styles.fixOverlay, { backgroundColor: theme.bg, paddingTop: insets.top + space.xl }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Icon name="search" size={20} color={theme.text} />
        <Text style={[type.title, { color: theme.text }]}>Add ingredient</Text>
      </View>
      <TextInput
        autoFocus
        placeholder="Search foods and dishes"
        placeholderTextColor={theme.textFaint}
        value={query}
        onChangeText={setQuery}
        returnKeyType="search"
        style={[styles.otherInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSunken, marginTop: space.lg }]}
      />

      {searching ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.lg }}>
          <ActivityIndicator size="small" color={theme.textFaint} />
          <Text style={[type.caption, { color: theme.textMuted }]}>Searching the database…</Text>
        </View>
      ) : null}

      {error ? (
        <Text style={[type.caption, { color: theme.uncertain, marginTop: space.lg }]}>{error}</Text>
      ) : null}

      <ScrollView style={{ marginTop: space.lg }} contentContainerStyle={{ gap: space.sm, paddingBottom: 120 }}>
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
                <Text style={[type.micro, { color: theme.textMuted, marginTop: 1 }]}>{c.brand}</Text>
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

      <Pressable
        accessibilityRole="button"
        onPress={onClose}
        hitSlop={space.md}
        style={{ alignSelf: 'center', marginBottom: Math.max(insets.bottom, space.lg) }}
      >
        <Text style={[type.body, { color: theme.textMuted }]}>Cancel</Text>
      </Pressable>
    </View>
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
  if (state.status === 'failed') return null

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
        <Text style={[type.micro, { color: theme.textMuted, marginTop: 2 }]}>
          Menu data from {domainOf(result.source_url)}
        </Text>
      ) : null}

      <View style={{ marginTop: space.md, gap: space.sm }}>
        {result.options.map((opt) => (
          <Pressable
            key={opt.label}
            onPress={() => applyWebOption(rowId, opt, result.source_url)}
            style={[styles.optionRow, { borderColor: theme.uncertain, backgroundColor: theme.bg }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[type.body, { color: theme.text }]}>{opt.label}</Text>
              {opt.serving_desc ? (
                <Text style={[type.micro, { color: theme.textMuted, marginTop: 1 }]}>{opt.serving_desc}</Text>
              ) : null}
            </View>
            <Text style={[type.label, { color: theme.textMuted }]}>{Math.round(opt.calories_kcal)} kcal</Text>
          </Pressable>
        ))}

        {otherOpen ? (
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
            <TextInput
              autoFocus
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
              onPress={() => {
                if (otherText.trim()) void lookupOther(rowId, otherText.trim())
                setOtherOpen(false)
              }}
              hitSlop={space.sm}
            >
              <Icon name="search" size={18} color={theme.text} />
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => setOtherOpen(true)} style={[styles.optionRow, { borderColor: theme.border, backgroundColor: theme.bg }]}>
            <Text style={[type.body, { color: theme.textMuted }]}>Other…</Text>
          </Pressable>
        )}
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
  fixOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, padding: space.lg },
  fixInput: {
    marginTop: space.xl,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    minHeight: 88,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  fixExample: { marginTop: space.lg, padding: space.lg, borderRadius: radius.lg },
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
  actions: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  primary: {
    paddingVertical: space.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    minHeight: MIN_TAP_TARGET,
    justifyContent: 'center',
  },
})
