import { useState } from 'react'
import { StyleSheet, Text, View, TextInput, ScrollView, Pressable } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { runAssistantChat, applyProposal } from '../src/inference/pathA/assistant'
import { runAssistantChatApi } from '../src/inference/pathA/client'
import { LastWorkoutCard, NutritionSummaryCard, MealProposalCard, WorkoutRoutineProposalCard } from '../src/components/assistant/AssistantCards'
import { useTheme } from '../src/theme/ThemeProvider'
import { radius, space, type } from '../src/theme/tokens'

export default function AssistantScreen() {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const [messages, setMessages] = useState<any[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  const send = async () => {
    if (!input.trim() || loading) return
    const text = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setLoading(true)

    try {
      const res = await runAssistantChat(text, async (system, user) => {
        const r = await runAssistantChatApi({
          provider: 'openai',
          model: 'gpt-4o', // Default to GPT-4o for now or fetch cheapest
          systemPrompt: system,
          userPrompt: user
        })
        if (!r?.ok) throw new Error('API failed')
        return r.text
      })

      setMessages(prev => [...prev, { role: 'assistant', ...res }])
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', text: 'Sorry, an error occurred.' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={[s.container, { backgroundColor: t.bg, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <Text style={[s.header, { color: t.text }]}>AI Assistant</Text>
      <ScrollView style={s.scroll}>
        {messages.map((m, i) => (
          <View key={i} style={[s.bubble, m.role === 'user' ? s.userBubble : s.aiBubble, { backgroundColor: m.role === 'user' ? t.text : t.bgElevated }]}>
            {m.content && <Text style={{ color: m.role === 'user' ? t.bgElevated : t.text }}>{m.content}</Text>}
            {m.text && <Text style={{ color: m.role === 'user' ? t.bgElevated : t.text }}>{m.text}</Text>}
            {m.toolCard?.tool_name === 'get_last_workout' && <LastWorkoutCard data={m.toolCard.data} />}
            {m.toolCard?.tool_name === 'get_nutrition_summary' && <NutritionSummaryCard data={m.toolCard.data} />}
            {m.toolCard?.tool_name === 'propose_meal' && <MealProposalCard data={m.toolCard.data} onConfirm={() => { applyProposal('propose_meal', m.toolCard.data); setMessages(prev => [...prev, { role: 'assistant', text: 'Meal saved successfully!' }]); }} onCancel={() => setMessages(prev => [...prev, { role: 'assistant', text: 'Proposal cancelled.' }])} />}
            {m.toolCard?.tool_name === 'propose_workout_routine' && <WorkoutRoutineProposalCard data={m.toolCard.data} onConfirm={() => { applyProposal('propose_workout_routine', m.toolCard.data); setMessages(prev => [...prev, { role: 'assistant', text: 'Routine saved successfully!' }]); }} onCancel={() => setMessages(prev => [...prev, { role: 'assistant', text: 'Proposal cancelled.' }])} />}
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
