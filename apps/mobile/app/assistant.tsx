import { useState, useCallback, useEffect, useRef } from 'react'
import {
  KeyboardAvoidingView,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  StyleSheet,
  Text,
  View,
  TextInput,
  ScrollView,
  Pressable,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  runAssistantChat,
  buildAssistantTurn,
  parseAssistantReply,
  applyProposal,
  assistantGlobalStatus,
  stripStreamingToolJson,
} from '../src/inference/pathA/assistant'
import { runAssistantChatApi, runAssistantChatApiStream, type ChatTurn } from '../src/inference/pathA/client'
import { LastWorkoutCard, NutritionSummaryCard, MealProposalCard, WorkoutRoutineProposalCard, ProposalStatusBadge } from '../src/components/assistant/AssistantCards'
import { Icon } from '../src/components/Icon'
import { Button } from '../src/components/Screen'
import { Empty } from '../src/components/Empty'
import { SkeletonLine } from '../src/components/Skeleton'
import { useTheme, useMotionScale } from '../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, elevationStyle, radius, space, stateLayerFor, type } from '../src/theme/tokens'
import { router, useFocusEffect } from 'expo-router'
import { encodeFoodReview } from '../src/data/food-review'
import { localDate } from '../src/data/date-utils'
import { customProviderBaseUrl, db as openUserDb, setting, putSetting } from '../src/data/repo'
import { loadCorrectionRows, applyLoggedMealCorrections, type LoggedCorrectionWrite } from '../src/data/log-corrections'
import { expandProposalIngredients } from '../src/data/proposal-ingredients'
import { describeActiveModel, composeModelLine } from '../src/inference/active-model'
import { cheapestModel, type ProviderId } from '@nutai/prompt'
import { loadFood, resolveByText } from '@nutai/resolver'
import type { CorrectionIntent } from '@nutai/core-schema'
import { describeCorrectionOperation } from '../src/data/correction-describe'
import { openIfctDb, openNutritionDb } from '../src/db/expo-adapter'
import { resolveSelection } from '../src/data/food-search-select'
import type { ManualFoodSelection } from '../src/data/manual-food'
import { STREAM_STALL_TIMEOUT_MS } from '@nutai/prompt'

const HISTORY_SETTING = 'assistant_history'
const HISTORY_MAX_TURNS = 40

// Chat context rides along with every send. The full persisted memory stays
// at 40 turns, but the PROVIDER only ever sees the last 16 — older turns add
// tokens the model barely uses, and the today-context block already carries
// everything current.
const HISTORY_MAX_REPLAY = 16

// UI/UX report Table 10.1 / §8.7 (Wave 1c): the first-open Empty state's three
// starter prompts — a meal-planning question, a knowledge lookup, a weekly
// review — each demonstrates a different thing the assistant can do. Tapping
// one fills the input AND sends (one tap, per the report's intent).
const STARTER_PROMPTS = [
  'What should I eat for a high-protein breakfast?',
  'How much protein is in 100g of dal?',
  'Review my week',
] as const

// §9.2: "assistant gets a three-line reply skeleton when the first byte is
// slow" — 1.5s of silence after send crosses from fast to slow.
const SLOW_FIRST_BYTE_MS = 1500

// §8.7 Message Scroller: how far from the bottom (px) the view may sit and
// still count as "following" the stream. Beyond it the auto-follow pauses and
// the anchored Latest pill appears, so reading history mid-stream never fights
// the scroll position.
const AT_BOTTOM_THRESHOLD = 120

async function resolveMealProposal(data: any): Promise<{ selection: ManualFoodSelection; selections: ManualFoodSelection[] }> {
  const [handle, ifctDb, userDb] = await Promise.all([openNutritionDb(), openIfctDb(), openUserDb()])
  const sourceContext = { ifctDb, userDb }
  const resolvedSelections: ManualFoodSelection[] = []

  // "2 rotis" expands to 2 rows of 40 g each (unit_count + per-unit grams);
  // bowls and total-weight foods stay one row.
  for (const ing of expandProposalIngredients(data.ingredients)) {
    const r = await resolveByText(handle, {
      canonicalFoodKey: ing.name,
      observedBrand: null,
      prepFacet: null,
      modelCategory: null,
      estimatedGrams: ing.perUnitGrams,
    }, sourceContext)

    const matchCandidate = r.outcome.kind === 'auto_accept'
      ? r.outcome.match
      : r.outcome.kind === 'disambiguate'
      ? r.outcome.candidates[0]
      : null

    if (matchCandidate) {
      const resolved = await loadFood(handle, matchCandidate.foodId, sourceContext)
      if (resolved) {
        const sel = await resolveSelection(handle, matchCandidate, resolved)
        sel.displayName = ing.name
        for (let row = 0; row < ing.rows; row++) {
          resolvedSelections.push({ ...sel, grams: ing.perUnitGrams })
        }
        continue
      }
    }

    throw new Error(`Could not find nutrition for "${ing.name}". Try rephrasing or using standard ingredients.`)
  }

  const totalGrams = resolvedSelections.reduce((sum, item) => sum + item.grams, 0) || 100
  const totalKcal = resolvedSelections.reduce((sum, s) => sum + (s.nutrientSnapshot.kcal * s.grams / 100), 0)
  const totalProtein = resolvedSelections.reduce((sum, s) => sum + (s.nutrientSnapshot.protein_g * s.grams / 100), 0)
  const totalCarbs = resolvedSelections.reduce((sum, s) => sum + (s.nutrientSnapshot.carbs_g * s.grams / 100), 0)
  const totalFat = resolvedSelections.reduce((sum, s) => sum + (s.nutrientSnapshot.fat_g * s.grams / 100), 0)

  const selection: ManualFoodSelection = {
    foodId: null,
    matchedFoodSource: 'assistant_proposal',
    displayName: data.name,
    grams: totalGrams,
    gramPathway: 'decomposed_recipe',
    portionSource: 'user_decomposition',
    nutrientSnapshot: {
      kcal: Math.round((totalKcal * 100) / totalGrams * 10) / 10,
      protein_g: Math.round((totalProtein * 100) / totalGrams * 10) / 10,
      carbs_g: Math.round((totalCarbs * 100) / totalGrams * 10) / 10,
      fat_g: Math.round((totalFat * 100) / totalGrams * 10) / 10,
      fiber_g: null,
      sugar_g: null,
      sodium_mg: null,
    }
  }

  return { selection, selections: resolvedSelections }
}

/** Best corpus match for a correction add/replace; null when the corpus does not know the food. */
async function resolveCorrectionFood(query: string, grams?: number): Promise<ManualFoodSelection | null> {
  const [handle, ifctDb, userDb] = await Promise.all([openNutritionDb(), openIfctDb(), openUserDb()])
  const sourceContext = { ifctDb, userDb }
  const r = await resolveByText(handle, {
    canonicalFoodKey: query,
    observedBrand: null,
    prepFacet: null,
    modelCategory: null,
    estimatedGrams: grams ?? 100,
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
  if (grams != null) sel.grams = grams
  return sel
}

export default function AssistantScreen() {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const motionScale = useMotionScale()
  // Chat autoscroll (P1-7 → §8.7 Message Scroller): every content-size change
  // — a new message, or a streaming bubble growing word by word — pins the
  // view to the newest line, but ONLY while the user is following the
  // conversation. Scrolling up to reread pauses the auto-follow; the anchored
  // Latest pill (§8.7) offers the way back down.
  const scrollRef = useRef<ScrollView>(null)
  const isAtBottomRef = useRef(true)
  const [isAtBottom, setIsAtBottom] = useState(true)

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y
    const atBottom = distanceFromBottom < AT_BOTTOM_THRESHOLD
    // State only moves on a real flip — a 60fps scroll stream must not
    // re-render the whole transcript per frame.
    if (atBottom !== isAtBottomRef.current) {
      isAtBottomRef.current = atBottom
      setIsAtBottom(atBottom)
    }
  }

  const scrollToLatest = (animated: boolean) => {
    isAtBottomRef.current = true
    setIsAtBottom(true)
    scrollRef.current?.scrollToEnd({ animated })
  }
  const [messages, setMessages] = useState<any[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  // Wave 1c (§9.2): armed when a reply is sent, cleared on the first streamed
  // delta; while true the newest streaming bubble renders the reply skeleton
  // instead of the static "Thinking…" text.
  const [slowFirstByte, setSlowFirstByte] = useState(false)
  const firstByteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // INTENTIONALLY EPHEMERAL: Assistant proposals and their states (PROPOSED, PENDING, SAVED) are held in memory.
  // They are not durable across process death and UI will not claim recovery.
  const [proposalStatus, setProposalStatus] = useState<Record<string, 'PROPOSED' | 'PENDING' | 'SAVED' | 'FAILED' | 'CANCELLED'>>({})
  // Chat memory: TEXT turns persist across sessions (settings store); tool cards
  // stay ephemeral exactly as before. historyRef is what gets replayed to the
  // provider; messages is what the user sees.
  const historyRef = useRef<ChatTurn[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  // Word-by-word streaming: the in-flight request can be aborted when the user
  // leaves the screen or starts over.
  const abortRef = useRef<{ current: null | (() => void) }>({ current: null })
  const [modelLine, setModelLine] = useState('')
  const [openReasoning, setOpenReasoning] = useState<Set<string>>(new Set())

  useEffect(() => {
    // Leaving the screen mid-stream releases the request.
    const aborts = abortRef
    return () => {
      aborts.current.current?.()
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void describeActiveModel('chat').then((line) => setModelLine(line ?? ''))
    }, [])
  )

  const closeAssistant = () => {
    abortRef.current.current?.()
    try {
      // eslint-disable-next-line no-restricted-syntax -- expo-router feature detect (canDismiss is version-gated)
      if (typeof (router as any).canDismiss === 'function' && router.canDismiss()) {
        router.back()
        return
      }
    } catch {
      // Fall through to the plain navigate below.
    }
    // P3-U2: replace('/') re-creates the Home screen and resets its
    // tab/scroll state; '/(tabs)' lands on the existing tab root instead.
    router.replace('/(tabs)')
  }

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const raw = await setting(HISTORY_SETTING)
        const turns: ChatTurn[] = raw ? JSON.parse(raw) : []
        if (live && Array.isArray(turns)) {
          historyRef.current = turns
          setMessages(turns.map((turn, i) => ({ id: `h_${i}`, role: turn.role, content: turn.content })))
        }
      } catch {
        // Corrupt or absent history — start a fresh chat, never crash.
      }
      if (live) setHistoryLoaded(true)
    })()
    return () => {
      live = false
    }
  }, [])

  const persistHistory = (turns: ChatTurn[]) => {
    historyRef.current = turns.slice(-HISTORY_MAX_TURNS)
    void putSetting(HISTORY_SETTING, JSON.stringify(historyRef.current)).catch(() => {})
  }

  const clearChat = () => {
    historyRef.current = []
    setMessages([])
    void putSetting(HISTORY_SETTING, '').catch(() => {})
  }

  useFocusEffect(useCallback(() => {
    let changed = false
    const nextStatus = { ...proposalStatus }
    for (const [msgId, status] of Object.entries(assistantGlobalStatus)) {
      if (nextStatus[msgId] !== status) {
// eslint-disable-next-line no-restricted-syntax -- proposal-status union arrives via a dynamic status map
        nextStatus[msgId] = status as any
        changed = true
      }
      delete assistantGlobalStatus[msgId]
    }
    for (const msgId of Object.keys(nextStatus)) {
      if (nextStatus[msgId] === 'PENDING') {
        nextStatus[msgId] = 'PROPOSED'
        changed = true
      }
    }

    if (changed) {
      setProposalStatus(nextStatus)
    }
  }, [proposalStatus]))

  const send = async (textArg?: string) => {
    // Starter-prompt chips pass their prompt directly; the TextInput's
    // onSubmitEditing keeps calling send() with no argument.
    const text = typeof textArg === 'string' ? textArg.trim() : input.trim()
    if (!text || loading) return
    setInput('')
    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', content: text }])
    setLoading(true)
    // P3-A2: the placeholder id is declared outside the try so the catch can
    // turn the bubble into the error bubble instead of appending a second one.
    const aiMsgId = (Date.now() + 1).toString()

    try {
      const configuredProvider = (await setting('provider')) as ProviderId | 'none' | ''
      if (!configuredProvider || configuredProvider === 'none') {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'assistant',
          text: 'No AI provider is configured. Please configure an API key in Profile → AI Provider settings to use the assistant.'
        }])
        setLoading(false)
        return
      }
      // Chatbot model split: the assistant prefers its OWN model (cheap text
      // models are fine here — no vision needed) and only falls back to the
      // scan model when no separate choice was made.
      const model =
        (await setting('assistant_model')) ||
        (await setting('provider_model')) ||
        cheapestModel(configuredProvider).id
      const baseUrl = await customProviderBaseUrl()
      setModelLine(composeModelLine(model, baseUrl, configuredProvider))

      // The streaming bubble exists from the moment the send happens — deltas
      // patch it in place, word by word.
      setMessages(prev => [...prev, { id: aiMsgId, role: 'assistant', text: '', reasoning: '', streaming: true }])
      // §9.2 slow first byte: if nothing streams within 1.5s, the placeholder
      // swaps "Thinking…" for a three-line reply skeleton.
      firstByteTimer.current = setTimeout(() => setSlowFirstByte(true), SLOW_FIRST_BYTE_MS)
      const patchStream = (d: { text?: string; reasoning?: string }) => {
        if (firstByteTimer.current != null) {
          clearTimeout(firstByteTimer.current)
          firstByteTimer.current = null
        }
        setSlowFirstByte(false)
        setMessages(prev =>
          prev.map(m =>
            m.id === aiMsgId
              ? {
                  ...m,
                  text: d.text ? (m.text || '') + d.text : m.text,
                  reasoning: d.reasoning ? (m.reasoning || '') + d.reasoning : m.reasoning,
                }
              : m,
          ),
        )
      }

      const { system, user } = await buildAssistantTurn(text)
      const replay = historyRef.current.slice(-HISTORY_MAX_REPLAY)
      // P2-8: cross-provider fallbacks run ONLY on the explicit settings
      // opt-in (provider settings → 'Fallback when the chat model fails').
      let allowCrossProvider = false
      try {
        allowCrossProvider = (await setting('cross_provider_fallback')) === 'on'
      } catch {
        allowCrossProvider = false
      }

      let res = await parseAssistantReply('')
      let streamError: string | null = null

      const stream = await runAssistantChatApiStream(
        {
          provider: configuredProvider,
          model,
          systemPrompt: system,
          userPrompt: user,
          history: replay,
          baseUrl,
          // Abort if the gateway sends nothing for 45s — before the first byte
          // or mid-stream — so the chat never hangs on 'Thinking…' forever.
          stallTimeoutMs: STREAM_STALL_TIMEOUT_MS,
        },
        { onDelta: patchStream, abortRef: abortRef.current },
      )
      // P2-6: the user aborted before any bytes arrived (screen closed, stop
      // pressed). Re-firing the request through the legacy non-streaming call
      // would bill for an answer nobody will read — drop the placeholder and
      // stop. The user's message stays; the empty AI bubble goes.
      if (stream.cancelled && !stream.text.trim()) {
        setMessages(prev => prev.filter(m => m.id !== aiMsgId))
        return
      }
      if (stream.ok) {
        res = await parseAssistantReply(stream.text)
      } else if (stream.text.trim()) {
        // Mid-stream drop with visible content: keep what arrived rather than
        // discarding a half-read answer. A user stop is not an error — never
        // paste the raw 'cancelled' marker into the bubble.
        res = await parseAssistantReply(stream.text)
        streamError = stream.cancelled ? '' : stream.error?.message || 'The connection dropped mid-answer.'
      } else {
        // Nothing streamed (no SSE support, dead gateway, empty stream) — the
        // legacy non-streaming chain still answers, with its provider fallbacks.
        // P2-8: when a FALLBACK answered, the reply carries an 'answered via'
        // disclosure so the header's configured model is never a false claim.
        const answeredViaRef: { current: { provider: ProviderId; model: string } | null } = { current: null }
        const legacy = await runAssistantChat(text, async (sys, usr, history) => {
          const r = await runAssistantChatApi({
            provider: configuredProvider,
            model,
            systemPrompt: sys,
            userPrompt: usr,
            history: (history ?? []).slice(-HISTORY_MAX_REPLAY),
            baseUrl,
            allowCrossProvider,
          })
          if (!r?.ok) throw new Error(r.error?.message || 'API failed')
          if (r.answeredVia) answeredViaRef.current = r.answeredVia
          return r.text
        }, historyRef.current)
        res = legacy
        if (answeredViaRef.current) {
          streamError = `Answered via ${answeredViaRef.current.model} (${answeredViaRef.current.provider}) — your configured model could not be reached.`
        }
      }

      if (res.toolCard?.tool_name?.startsWith('propose_') || res.toolCard?.tool_name === 'correct_logged_meal') {
        setProposalStatus(prev => ({ ...prev, [aiMsgId]: 'PROPOSED' }))
      }
      const finalText = res.text ?? ''
      setMessages(prev =>
        prev.map(m =>
          m.id === aiMsgId
            ? {
                ...m,
                streaming: false,
                text: streamError ? `${finalText}${finalText ? '\n\n' : ''}${streamError}` : finalText,
                reasoning: stream.reasoning || (m.reasoning ?? ''),
                toolCard: res.toolCard,
              }
            : m,
        ),
      )

      // Persist the exchange as plain text turns; tool-card-only replies leave
      // no turn (normalizeHistory merges whatever comes next). Reasoning is
      // display-only and never replayed to the provider.
      persistHistory([
        ...historyRef.current,
        { role: 'user', content: text },
        ...(finalText.trim() ? [{ role: 'assistant' as const, content: finalText.trim() }] : []),
      ])
    } catch (e: any) {
      // P3-A2: the streaming placeholder added for this turn must not survive
      // as an empty bubble when the legacy chain throws before producing text
      // — turn the placeholder ITSELF into the error bubble instead of
      // appending a second, duplicate one.
      const errText = e?.message || 'Sorry, an error occurred.'
      setMessages(prev => {
        const placeholder = prev.find(m => m.id === aiMsgId)
        if (placeholder && placeholder.streaming) {
          return prev.map(m => (m.id === aiMsgId ? { ...m, streaming: false, text: errText } : m))
        }
        return [...prev, { id: Date.now().toString(), role: 'assistant', text: errText }]
      })
    } finally {
      if (firstByteTimer.current != null) {
        clearTimeout(firstByteTimer.current)
        firstByteTimer.current = null
      }
      setSlowFirstByte(false)
      abortRef.current.current = null
      setLoading(false)
    }
  }

  const handleMealConfirm = async (msgId: string, data: any) => {
    if (proposalStatus[msgId] !== 'PROPOSED' && proposalStatus[msgId] !== 'FAILED') return
    setProposalStatus(prev => ({ ...prev, [msgId]: 'PENDING' }))
    try {
      const { selection, selections } = await resolveMealProposal(data)
      router.push({
        pathname: '/food-review',
        params: { payload: encodeFoodReview({ selection, selections, date: localDate(Date.now()) }), assistantMsgId: msgId }
      } as never)
      setProposalStatus(prev => ({ ...prev, [msgId]: 'PENDING' }))
    } catch {
      setProposalStatus(prev => ({ ...prev, [msgId]: 'FAILED' }))
    }
  }

  const handleRoutineConfirm = async (msgId: string, data: any) => {
    if (proposalStatus[msgId] !== 'PROPOSED' && proposalStatus[msgId] !== 'FAILED') return
    setProposalStatus(prev => ({ ...prev, [msgId]: 'PENDING' }))
    try {
      await applyProposal('propose_workout_routine', data)
      setProposalStatus(prev => ({ ...prev, [msgId]: 'SAVED' }))
    } catch {
      setProposalStatus(prev => ({ ...prev, [msgId]: 'FAILED' }))
    }
  }

  /**
   * AIP-004 apply step: the user CONFIRMED these operations. Ops are mapped to
   * concrete writes against today's real log rows; add/replace resolve against
   * the corpus first so the write batch is fully concrete. Everything lands in
   * the operation log via applyLoggedMealCorrections — undoable like any meal edit.
   */
  const handleCorrectionConfirm = async (msgId: string, data: any) => {
    if (proposalStatus[msgId] !== 'PROPOSED' && proposalStatus[msgId] !== 'FAILED') return
    setProposalStatus(prev => ({ ...prev, [msgId]: 'PENDING' }))
    try {
      const intent: CorrectionIntent = { operations: data?.operations ?? [], clarification_needed: data?.clarification_needed ?? null }
      const now = Date.now()
      const handle = await openUserDb()
      const rows = await loadCorrectionRows(handle, localDate(now))
      const byKey = new Map(rows.map((r) => [r.key, r]))
      const latestMealId = rows.length > 0 ? rows[rows.length - 1].mealId : null
      const writes: LoggedCorrectionWrite[] = []
      const unknown: string[] = []

      if (intent.operations.length === 0) {
        throw new Error(data?.clarification_needed || 'Nothing to apply.')
      }

      for (const op of intent.operations) {
        if (op.type === 'remove_item') {
          if (byKey.has(op.id)) writes.push({ kind: 'remove', key: op.id })
          else unknown.push(op.id)
        } else if (op.type === 'update_quantity') {
          if (op.grams == null) {
            unknown.push(op.id)
            continue
          }
          if (byKey.has(op.id)) writes.push({ kind: 'update', key: op.id, grams: op.grams })
          else unknown.push(op.id)
        } else if (op.type === 'add_item') {
          if (latestMealId == null) throw new Error('Nothing is logged today — use “I had …” to log it instead.')
          const sel = await resolveCorrectionFood(op.canonical_food_key || op.name, op.grams ?? undefined)
          if (!sel) throw new Error(`Could not find nutrition for "${op.name}".`)
          writes.push({ kind: 'add', mealId: latestMealId, selection: sel })
        } else if (op.type === 'replace_item') {
          const ref = byKey.get(op.id)
          if (!ref) {
            unknown.push(op.id)
            continue
          }
          const sel = await resolveCorrectionFood(op.canonical_food_key || op.name, ref.grams)
          if (!sel) throw new Error(`Could not find nutrition for "${op.name}".`)
          writes.push({ kind: 'remove', key: op.id })
          writes.push({ kind: 'add', mealId: ref.mealId, selection: sel })
        }
      }

      if (writes.length === 0) {
        throw new Error('None of those changes match today\'s log — try naming the food exactly as it appears in your log.')
      }

      const applied = await applyLoggedMealCorrections(handle, writes, now)
      if (applied.appliedMeals.length === 0) throw new Error('The correction could not be applied.')
      setProposalStatus(prev => ({ ...prev, [msgId]: 'SAVED' }))
    } catch (e: any) {
      console.error('correction apply failed', e)
      setProposalStatus(prev => ({ ...prev, [msgId]: 'FAILED' }))
    }
  }

  const toggleReasoning = (id: string) =>
    setOpenReasoning(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <KeyboardAvoidingView
      style={[s.container, { backgroundColor: t.bg, paddingTop: insets.top, paddingBottom: insets.bottom }]}
      // §8.7 keyboard-safe insets: iOS lifts the input bar above the software
      // keyboard (Android adjusts via windowSoftInputMode; web browsers scroll
      // the focused input into view themselves — no behavior needed there).
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={s.headerRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close assistant"
          onPress={closeAssistant}
          hitSlop={space.sm}
          style={[s.closeBtn, { borderColor: t.border }]}
        >
          {/* UI/UX report Table 12.1 (Wave 1b): the unicode × close glyph joins
              the icon set's close glyph — one close affordance across the app. */}
          <Icon name="close" size={18} color={t.textMuted} />
        </Pressable>
        <View style={s.headerCenter}>
          <Text style={[s.header, { color: t.text }]}>AI Assistant</Text>
          {modelLine ? <Text style={[type.caption, { color: t.textFaint, marginTop: 1 }]}>{modelLine}</Text> : null}
        </View>
        {historyLoaded && messages.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start a new chat"
            onPress={clearChat}
            hitSlop={space.sm}
            style={[s.newChat, { borderColor: t.border }]}
          >
            <Text style={[type.label, { color: t.textMuted }]}>New chat</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={s.chatArea}>
        <ScrollView
          ref={scrollRef}
          style={s.scroll}
          scrollEventThrottle={16}
          onScroll={onScroll}
          onContentSizeChange={() =>
            // §8.7 auto-scroll-to-new-reply: animated scrolling respects
            // reduce-motion (motionScale 0 = jump cut) and pauses when the
            // user has scrolled up (isAtBottomRef) — the Latest pill takes
            // them back down on their own tap.
            isAtBottomRef.current &&
            scrollRef.current?.scrollToEnd({ animated: motionScale !== 0 })
          }
        >
        {messages.map((m, i) => {
          // §8.7 "raw JSON guards become silent states": while a tool-call
          // JSON is streaming in — at the head of the reply or arriving after
          // prose — the bubble keeps showing the prose plus a quiet preparing
          // state; raw JSON never pours into the conversation.
          const streamingStrip = m.streaming ? stripStreamingToolJson(m.text || '') : null
          const displayText = streamingStrip ? streamingStrip.text : (m.text || '')
          const toolJsonInFlight = streamingStrip?.toolJson === true
          const thinkingOnly = !!m.streaming && !!m.reasoning && !m.text
          return (
          <View
            key={m.id || i}
            style={[
              s.bubble,
              m.role === 'user' ? s.userBubble : s.aiBubble,
              // §8.7 bubble tone: user right in the accent tint at 12%
              // (stateLayer.selected), assistant left on the card background.
              {
                backgroundColor:
                  m.role === 'user'
                    ? stateLayerFor(t.isDark).selected.backgroundColor
                    : t.bgElevated,
              },
            ]}
          >
            {m.content ? <Text style={{ color: t.text }}>{m.content}</Text> : null}
            {thinkingOnly ? (
              slowFirstByte && i === messages.length - 1 ? (
                // §9.2: three-line reply skeleton while the first byte is slow.
                // Streaming itself stays a spinner-free live bubble — this is
                // the sanctioned assistant case, not a full-screen skeleton.
                <View style={{ gap: space.xs, marginTop: space.xs }}>
                  <SkeletonLine width="100%" height={12} />
                  <SkeletonLine width="92%" height={12} />
                  <SkeletonLine width="68%" height={12} />
                </View>
              ) : (
                <Text style={[type.caption, { color: t.textMuted }]}>Thinking…</Text>
              )
            ) : null}
            {!thinkingOnly && m.reasoning ? (
              <View style={{ marginTop: space.xs }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={openReasoning.has(m.id) ? 'Hide thinking' : 'Show thinking'}
                  onPress={() => toggleReasoning(m.id)}
                  hitSlop={space.sm}
                >
                  {/* §8.7: the reasoning disclosure is a clean collapsible — one
                      chevron glyph that rotates open (the header back-chevron's
                      flip is the established dialect), not unicode arrows. */}
                  <View style={s.reasoningToggle}>
                    <View style={openReasoning.has(m.id) ? s.chevronOpen : s.chevronClosed}>
                      <Icon name="chevron" size={14} color={t.textFaint} />
                    </View>
                    <Text style={[type.caption, { color: t.textFaint }]}>Thinking</Text>
                  </View>
                </Pressable>
                {openReasoning.has(m.id) ? (
                  <Text style={[type.caption, { color: t.textFaint, marginTop: space.xs, lineHeight: 16 }]}>{m.reasoning}</Text>
                ) : null}
              </View>
            ) : null}
            {displayText ? <Text style={{ color: t.text }}>{displayText}</Text> : null}
            {toolJsonInFlight ? (
              <Text style={[type.caption, { color: t.textMuted }]}>Preparing…</Text>
            ) : null}
            {m.toolCard?.tool_name === 'get_last_workout' && <LastWorkoutCard data={m.toolCard.data} />}
            {m.toolCard?.tool_name === 'get_nutrition_summary' && <NutritionSummaryCard data={m.toolCard.data} />}
            {m.toolCard?.tool_name === 'propose_meal' && (
              <MealProposalCard
                data={m.toolCard.data}
                status={proposalStatus[m.id]}
                onConfirm={() => handleMealConfirm(m.id, m.toolCard.data)}
                onCancel={() => setProposalStatus(prev => ({ ...prev, [m.id]: 'CANCELLED' }))}
              />
            )}
            {m.toolCard?.tool_name === 'propose_workout_routine' && (
              <WorkoutRoutineProposalCard
                data={m.toolCard.data}
                status={proposalStatus[m.id]}
                onConfirm={() => handleRoutineConfirm(m.id, m.toolCard.data)}
                onCancel={() => setProposalStatus(prev => ({ ...prev, [m.id]: 'CANCELLED' }))}
              />
            )}
            {m.toolCard?.tool_name === 'correct_logged_meal' && (
              <CorrectionProposalCard
                data={m.toolCard.data}
                status={proposalStatus[m.id]}
                onConfirm={() => handleCorrectionConfirm(m.id, m.toolCard.data)}
                onCancel={() => setProposalStatus(prev => ({ ...prev, [m.id]: 'CANCELLED' }))}
              />
            )}
          </View>
          )
        })}

        {/* UI/UX report Table 10.1 / §8.7 (Wave 1c): the first-open Empty state.
            The audit found "the assistant has no empty state at all, so first
            open shows a blank scroll area" — an icon, an explanation, and three
            starter prompts now fill it, and each chip fills the input AND sends. */}
        {historyLoaded && messages.length === 0 ? (
          <>
            <Empty
              icon="sparkles"
              title="Ask anything"
              message="Questions about your food, log or training get answers; proposals arrive as review cards; nothing is logged until you confirm it."
            />
            <View style={{ gap: space.sm, marginTop: space.xl }}>
              {STARTER_PROMPTS.map((prompt) => (
                <Pressable
                  key={prompt}
                  accessibilityRole="button"
                  accessibilityLabel={`Ask: ${prompt}`}
                  disabled={loading}
                  onPress={() => void send(prompt)}
                  style={[s.starterChip, { borderColor: t.border, backgroundColor: t.bgElevated }]}
                >
                  <Text style={[type.body, { color: t.text }]}>{prompt}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
        </ScrollView>

        {/* §8.7 anchored scroll-to-bottom pill: when the user has scrolled up
            (mid-stream or after replies), a floating Latest pill sits above the
            input — 44pt target, chevron-down glyph, one tap returns to the
            newest line and resumes the auto-follow. */}
        {!isAtBottom && messages.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Scroll to the latest message"
            onPress={() => scrollToLatest(motionScale !== 0)}
            style={[
              s.latestPill,
              elevationStyle('medium', t.isDark),
              { backgroundColor: t.bgElevated, borderColor: t.border },
            ]}
          >
            <View style={s.latestPillIcon}>
              <Icon name="chevron" size={16} color={t.text} />
            </View>
            <Text style={[type.label, { color: t.text }]}>Latest</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={s.inputRow}>
        <TextInput
          style={[s.input, { color: t.text, borderColor: t.border }]}
          value={input}
          onChangeText={setInput}
          placeholder="Ask about your food, workouts, or say “remove the roti”…"
          placeholderTextColor={t.textMuted}
          onSubmitEditing={() => void send()}
        />
        {/* UI/UX report Table 12.2 (Wave 2): the private send dialect (bold
            one-off fontWeight, no a11y role, no pressed state) joins the ONE
            Button — the token-weighted label, state layers and press feedback
            arrive with it. */}
        <Button label="Send" selected onPress={() => void send()} />
      </View>
    </KeyboardAvoidingView>
  )
}


/**
 * AIP-004 confirmation card. The model proposed; the user decides. Every
 * operation is listed as a before/after line, and Apply is the ONLY path to
 * the write layer.
 */
function CorrectionProposalCard({
  data,
  status,
  onConfirm,
  onCancel,
}: {
  data: any
  status?: 'PROPOSED' | 'PENDING' | 'SAVED' | 'FAILED' | 'CANCELLED'
  onConfirm: () => void
  onCancel: () => void
}) {
  const t = useTheme()
  const operations: CorrectionIntent['operations'] = data?.operations ?? []
  const clarification: string | null = typeof data?.clarification_needed === 'string' ? data.clarification_needed : null

  // Names come from today's log at render time is not possible here (async);
  // the id is compact ("m12i3") but the operation text carries the food name
  // for add/replace, and update/remove lines name the item via the id map the
  // assistant context gave the model — good enough to recognize, and the
  // result is visible on the timeline the moment it applies.
  const nameOf = (id: string) => id

  if (status === 'SAVED') {
    return (
      <View style={[s.card, { borderColor: t.border }]}>
        <ProposalStatusBadge status={status} savedLabel="Applied" />
        <Text style={[type.body, { color: t.text, marginTop: space.xs }]}>Applied to your log. You can undo it from the Home timeline.</Text>
      </View>
    )
  }
  if (status === 'CANCELLED') {
    return (
      <View style={[s.card, { borderColor: t.border }]}>
        <ProposalStatusBadge status={status} />
        <Text style={[type.body, { color: t.textMuted, marginTop: space.xs }]}>Correction cancelled — your log is unchanged.</Text>
      </View>
    )
  }
  if (status === 'FAILED') {
    return (
      <View style={[s.card, { borderColor: t.border }]}>
        <ProposalStatusBadge status={status} />
        <Text style={[type.body, { color: t.text, marginTop: space.xs }]}>
          {clarification || 'That correction could not be applied. Try naming the food exactly as it appears in your log.'}
        </Text>
        <Pressable onPress={onConfirm} style={[s.cardBtn, { backgroundColor: t.text }]}>
          <Text style={{ color: t.bgElevated, fontWeight: '700' }}>Try again</Text>
        </Pressable>
      </View>
    )
  }

  if (operations.length === 0 && clarification) {
    return (
      <View style={[s.card, { borderColor: t.border }]}>
        <Text style={[type.bodyStrong, { color: t.text }]}>Quick question</Text>
        <Text style={[type.body, { color: t.textMuted, marginTop: space.xs }]}>{clarification}</Text>
      </View>
    )
  }

  return (
    <View style={[s.card, { borderColor: t.border }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Text style={[type.bodyStrong, { color: t.text, flex: 1 }]}>Correct today&apos;s log</Text>
        <ProposalStatusBadge status={status} />
      </View>
      <View style={{ marginTop: space.sm, gap: space.xs }}>
        {operations.map((op, i) => (
          <Text key={i} style={[type.body, { color: t.text }]}>• {describeCorrectionOperation(op, nameOf)}</Text>
        ))}
      </View>
      <Text style={[type.caption, { color: t.textMuted, marginTop: space.sm }]}>
        Nothing changes until you confirm. Unmentioned items stay untouched.
      </Text>
      {status === 'PENDING' ? null : (
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
          <Pressable onPress={onConfirm} style={[s.cardBtn, { backgroundColor: t.text, flex: 1 }]}>
            <Text style={{ color: t.bgElevated, fontWeight: '700' }}>Confirm</Text>
          </Pressable>
          <Pressable onPress={onCancel} style={[s.cardBtn, { backgroundColor: 'transparent', borderWidth: 1, borderColor: t.border, flex: 1 }]}>
            <Text style={{ color: t.text, fontWeight: '700' }}>Cancel</Text>
          </Pressable>
        </View>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: space.md, position: 'relative', minHeight: 56 },
  headerCenter: { alignItems: 'center' },
  header: { ...type.title, fontWeight: 'bold', textAlign: 'center' },
  closeBtn: {
    position: 'absolute',
    left: space.md,
    top: '50%',
    marginTop: -16,
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newChat: {
    position: 'absolute',
    right: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.xs + 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  scroll: { flex: 1, padding: space.md },
  // §8.7: the transcript column the Latest pill anchors to — the pill floats
  // above the input row, inside this relative wrapper.
  chatArea: { flex: 1 },
  // §8.7 anchored scroll-to-bottom pill: floating element (elevation
  // medium), 44pt target, pill radius. Sits `space.xs` above the input row
  // (inputRow = 2× space.md padding + 48pt control ≈ 72pt tall).
  latestPill: {
    position: 'absolute',
    right: space.lg,
    bottom: 76,
    minHeight: MIN_TAP_TARGET,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
  },
  // The icon set's chevron points right (forward); rotated 90° it points
  // down — the "to the latest" direction (the header back-chevron's flip is
  // the same one-asset-mirrors dialect).
  latestPillIcon: { transform: [{ rotate: '90deg' }] },
  // §8.7 reasoning disclosure row: chevron glyph + caption label.
  reasoningToggle: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  chevronClosed: { transform: [{ rotate: '0deg' }] },
  chevronOpen: { transform: [{ rotate: '90deg' }] },
  // Wave 1c starter-prompt chips (report §8.7): 44pt pill targets, full width
  // so each prompt reads on one line at body size.
  starterChip: {
    minHeight: MIN_TAP_TARGET,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    justifyContent: 'center',
  },
  // §8.7 bubble system radius/tone: radius.lg with the corner "tail"
  // (user bottom-right, assistant bottom-left); colour is applied inline from
  // the §4.3 state-layer selected tint (user) / bgElevated card token
  // (assistant).
  bubble: { padding: space.md, borderRadius: radius.lg, marginBottom: space.md, maxWidth: '85%' },
  userBubble: { alignSelf: 'flex-end', borderBottomRightRadius: radius.sm },
  aiBubble: { alignSelf: 'flex-start', borderBottomLeftRadius: radius.sm },
  card: { marginTop: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: 1, maxWidth: '100%', backgroundColor: 'transparent' },
  cardBtn: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  inputRow: { flexDirection: 'row', padding: space.md, gap: space.sm, alignItems: 'center' },
  input: { flex: 1, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm },
})
