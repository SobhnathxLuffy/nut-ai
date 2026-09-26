import { useState, useCallback } from 'react'
import { StyleSheet, Text, View, TextInput, ScrollView, Pressable } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { runAssistantChat, applyProposal, assistantGlobalStatus } from '../src/inference/pathA/assistant'
import { runAssistantChatApi } from '../src/inference/pathA/client'
import { LastWorkoutCard, NutritionSummaryCard, MealProposalCard, WorkoutRoutineProposalCard } from '../src/components/assistant/AssistantCards'
import { useTheme } from '../src/theme/ThemeProvider'
import { radius, space, type } from '../src/theme/tokens'
import { router, useFocusEffect } from 'expo-router'
import { encodeFoodReview } from '../src/data/food-review'
import { localDate } from '../src/data/date-utils'
import { db as openUserDb, setting } from '../src/data/repo'
import { cheapestModel, type ProviderId } from '@nutai/prompt'
import { loadFood, resolveByText } from '@nutai/resolver'
import { openIfctDb, openNutritionDb } from '../src/db/expo-adapter'
import { resolveSelection } from '../src/data/food-search-select'
import type { ManualFoodSelection } from '../src/data/manual-food'

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

export default function AssistantScreen() {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const [messages, setMessages] = useState<any[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  // INTENTIONALLY EPHEMERAL: Assistant proposals and their states (PROPOSED, PENDING, SAVED) are held in memory.
  // They are not durable across process death and UI will not claim recovery.
  const [proposalStatus, setProposalStatus] = useState<Record<string, 'PROPOSED' | 'PENDING' | 'SAVED' | 'FAILED' | 'CANCELLED'>>({})

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

      const res = await runAssistantChat(text, async (system, user) => {
        const r = await runAssistantChatApi({
          provider: configuredProvider,
          model,
          systemPrompt: system,
          userPrompt: user
        })
        if (!r?.ok) throw new Error(r.error?.message || 'API failed')
        return r.text
      })

      const aiMsgId = Date.now().toString()
      if (res.toolCard?.tool_name?.startsWith('propose_')) {
        setProposalStatus(prev => ({ ...prev, [aiMsgId]: 'PROPOSED' }))
      }
      setMessages(prev => [...prev, { id: aiMsgId, role: 'assistant', ...res }])
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

  return (
    <View style={[s.container, { backgroundColor: t.bg, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <Text style={[s.header, { color: t.text }]}>AI Assistant</Text>
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
          </View>
        ))}
      </ScrollView>
      <View style={s.inputRow}>
        <TextInput
          style={[s.input, { color: t.text, borderColor: t.border }]}
          value={input}
          onChangeText={setInput}
          placeholder="Ask about workouts or nutrition..."
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

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { ...type.title, fontWeight: 'bold', padding: space.md, textAlign: 'center' },
  scroll: { flex: 1, padding: space.md },
  bubble: { padding: space.md, borderRadius: radius.md, marginBottom: space.md, maxWidth: '85%' },
  userBubble: { alignSelf: 'flex-end', borderBottomRightRadius: 0 },
  aiBubble: { alignSelf: 'flex-start', borderBottomLeftRadius: 0 },
  inputRow: { flexDirection: 'row', padding: space.md, gap: space.sm },
  input: { flex: 1, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  btn: { paddingHorizontal: space.md, justifyContent: 'center', borderRadius: radius.md }
})
