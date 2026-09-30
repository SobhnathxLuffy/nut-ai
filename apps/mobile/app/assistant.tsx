import { useState, useCallback, useEffect, useRef } from 'react'
import { StyleSheet, Text, View, TextInput, ScrollView, Pressable } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  runAssistantChat,
  applyProposal,
  assistantGlobalStatus,
} from '../src/inference/pathA/assistant'
import { runAssistantChatApi, type ChatTurn } from '../src/inference/pathA/client'
import { LastWorkoutCard, NutritionSummaryCard, MealProposalCard, WorkoutRoutineProposalCard } from '../src/components/assistant/AssistantCards'
import { useTheme } from '../src/theme/ThemeProvider'
import { radius, space, type } from '../src/theme/tokens'
import { router, useFocusEffect } from 'expo-router'
import { encodeFoodReview } from '../src/data/food-review'
import { localDate } from '../src/data/date-utils'
import { db as openUserDb, setting, putSetting } from '../src/data/repo'
import { loadCorrectionRows, applyLoggedMealCorrections, type LoggedCorrectionWrite } from '../src/data/log-corrections'
import { cheapestModel, type ProviderId } from '@nutai/prompt'
import { loadFood, resolveByText } from '@nutai/resolver'
import type { CorrectionIntent } from '@nutai/core-schema'
import { openIfctDb, openNutritionDb } from '../src/db/expo-adapter'
import { resolveSelection } from '../src/data/food-search-select'
import type { ManualFoodSelection } from '../src/data/manual-food'

const HISTORY_SETTING = 'assistant_history'
const HISTORY_MAX_TURNS = 40

async function resolveMealProposal(data: any): Promise<{ selection: ManualFoodSelection; selections: ManualFoodSelection[] }> {
  const [handle, ifctDb, userDb] = await Promise.all([openNutritionDb(), openIfctDb(), openUserDb()])
  const sourceContext = { ifctDb, userDb }
  const resolvedSelections: ManualFoodSelection[] = []

  for (const ing of (data.ingredients || [])) {
    const grams = Number(ing.grams) || 100
    const r = await resolveByText(handle, {
      canonicalFoodKey: ing.name,
      observedBrand: null,
      prepFacet: null,
      modelCategory: null,
      estimatedGrams: grams,
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
        sel.grams = grams
        resolvedSelections.push(sel)
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
  const [messages, setMessages] = useState<any[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  // INTENTIONALLY EPHEMERAL: Assistant proposals and their states (PROPOSED, PENDING, SAVED) are held in memory.
  // They are not durable across process death and UI will not claim recovery.
  const [proposalStatus, setProposalStatus] = useState<Record<string, 'PROPOSED' | 'PENDING' | 'SAVED' | 'FAILED' | 'CANCELLED'>>({})
  // Chat memory: TEXT turns persist across sessions (settings store); tool cards
  // stay ephemeral exactly as before. historyRef is what gets replayed to the
  // provider; messages is what the user sees.
  const historyRef = useRef<ChatTurn[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)

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

  const send = async () => {
    if (!input.trim() || loading) return
    const text = input.trim()
    setInput('')
    const msgId = Date.now().toString()
    setMessages(prev => [...prev, { id: msgId + '_user', role: 'user', content: text }])
    setLoading(true)

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
      const model = (await setting('provider_model')) || cheapestModel(configuredProvider).id

      // Multi-turn memory: every prior persisted text turn rides along.
      const res = await runAssistantChat(text, async (system, user, history) => {
        const r = await runAssistantChatApi({
          provider: configuredProvider,
          model,
          systemPrompt: system,
          userPrompt: user,
          history,
        })
        if (!r?.ok) throw new Error(r.error?.message || 'API failed')
        return r.text
      }, historyRef.current)

      const aiMsgId = Date.now().toString()
      if (res.toolCard?.tool_name?.startsWith('propose_') || res.toolCard?.tool_name === 'correct_logged_meal') {
        setProposalStatus(prev => ({ ...prev, [aiMsgId]: 'PROPOSED' }))
      }
      setMessages(prev => [...prev, { id: aiMsgId, role: 'assistant', ...res }])

      // Persist the exchange as plain text turns; tool-card-only replies leave
      // no turn (normalizeHistory merges whatever comes next).
      persistHistory([
        ...historyRef.current,
        { role: 'user', content: text },
        ...(res.text?.trim() ? [{ role: 'assistant' as const, content: res.text.trim() }] : []),
      ])
    } catch (e: any) {
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', text: e?.message || 'Sorry, an error occurred.' }])
    } finally {
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

  return (
    <View style={[s.container, { backgroundColor: t.bg, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={s.headerRow}>
        <Text style={[s.header, { color: t.text }]}>AI Assistant</Text>
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
      <ScrollView style={s.scroll}>
        {messages.map((m, i) => (
          <View key={m.id || i} style={[s.bubble, m.role === 'user' ? s.userBubble : s.aiBubble, { backgroundColor: m.role === 'user' ? t.text : t.bgElevated }]}>
            {m.content && <Text style={{ color: m.role === 'user' ? t.bgElevated : t.text }}>{m.content}</Text>}
            {m.text && <Text style={{ color: m.role === 'user' ? t.bgElevated : t.text }}>{m.text}</Text>}
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
        ))}
      </ScrollView>
      <View style={s.inputRow}>
        <TextInput
          style={[s.input, { color: t.text, borderColor: t.border }]}
          value={input}
          onChangeText={setInput}
          placeholder="Ask about your food, workouts, or say “remove the roti”…"
          placeholderTextColor={t.textMuted}
          onSubmitEditing={send}
        />
        <Pressable onPress={send} style={[s.btn, { backgroundColor: t.text }]}>
          <Text style={{ color: t.bgElevated, fontWeight: 'bold' }}>Send</Text>
        </Pressable>
      </View>
    </View>
  )
}

function describeCorrectionOp(op: CorrectionIntent['operations'][number], nameOf: (id: string) => string): string {
  switch (op.type) {
    case 'update_quantity':
      return op.grams != null
        ? `Set “${nameOf(op.id)}” to ${Math.round(op.grams)} g`
        : `Adjust “${nameOf(op.id)}”`
    case 'remove_item':
      return `Remove “${nameOf(op.id)}”`
    case 'add_item':
      return `Add “${op.name}”${op.grams != null ? ` (~${Math.round(op.grams)} g)` : ''}`
    case 'replace_item':
      return `Swap “${nameOf(op.id)}” for “${op.name}”`
  }
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
        <Text style={[type.body, { color: t.text }]}>Applied to your log. You can undo it from the Home timeline.</Text>
      </View>
    )
  }
  if (status === 'CANCELLED') {
    return (
      <View style={[s.card, { borderColor: t.border }]}>
        <Text style={[type.body, { color: t.textMuted }]}>Correction cancelled — your log is unchanged.</Text>
      </View>
    )
  }
  if (status === 'FAILED') {
    return (
      <View style={[s.card, { borderColor: t.border }]}>
        <Text style={[type.body, { color: t.text }]}>
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
      <Text style={[type.bodyStrong, { color: t.text }]}>Correct today&apos;s log</Text>
      <View style={{ marginTop: space.sm, gap: space.xs }}>
        {operations.map((op, i) => (
          <Text key={i} style={[type.body, { color: t.text }]}>• {describeCorrectionOp(op, nameOf)}</Text>
        ))}
      </View>
      <Text style={[type.micro, { color: t.textMuted, marginTop: space.sm }]}>
        Nothing changes until you confirm. Unmentioned items stay untouched.
      </Text>
      {status === 'PENDING' ? (
        <Text style={[type.body, { color: t.textMuted, marginTop: space.md }]}>Applying…</Text>
      ) : (
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
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: space.md, position: 'relative' },
  header: { ...type.title, fontWeight: 'bold', textAlign: 'center' },
  newChat: {
    position: 'absolute',
    right: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.xs + 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    minHeight: 32,
    justifyContent: 'center',
  },
  scroll: { flex: 1, padding: space.md },
  bubble: { padding: space.md, borderRadius: radius.md, marginBottom: space.md, maxWidth: '85%' },
  userBubble: { alignSelf: 'flex-end', borderBottomRightRadius: 0 },
  aiBubble: { alignSelf: 'flex-start', borderBottomLeftRadius: 0 },
  card: { marginTop: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, maxWidth: '100%' },
  cardBtn: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    minHeight: 40,
    justifyContent: 'center',
  },
  inputRow: { flexDirection: 'row', padding: space.md, gap: space.sm },
  input: { flex: 1, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  btn: { paddingHorizontal: space.md, justifyContent: 'center', borderRadius: radius.md }
})
