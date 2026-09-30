import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PROVIDER_MODELS, providersByPrice, type ProviderId } from '@nutai/prompt'
import { CredentialForm, PROVIDER_NAME } from '../src/components/CredentialForm'
import { Icon } from '../src/components/Icon'
import { putSetting, setting } from '../src/data/repo'
import { clearCredential, loadCredential, maskCredential } from '../src/inference/credentials'
import { useTheme } from '../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../src/theme/tokens'

/**
 * Provider settings — everything the onboarding key screen can do, available
 * forever. Change provider, change model, re-verify a key, clear it. Nothing
 * decided during onboarding is a life sentence.
 */
export default function ProviderSettings() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [provider, setProvider] = useState<ProviderId>('anthropic')
  const [modelId, setModelId] = useState<string>('')
  const [masked, setMasked] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  // Chatbot model split: '' means "follow the scan model". The drafts back the
  // reseller inputs (base URL + custom model IDs) so a vendor's exact strings
  // can be typed even when they are not in the built-in catalogue.
  const [assistantModelId, setAssistantModelId] = useState<string>('')
  const [baseUrlDraft, setBaseUrlDraft] = useState<string>('')
  const [customModelDraft, setCustomModelDraft] = useState<string>('')

  const refresh = useCallback(() => {
    void (async () => {
      const p = (await setting('provider')) as ProviderId | 'none' | ''
      const active = p && p !== 'none' ? p : 'anthropic'
      setProvider(active)
      const scanModel = await setting('provider_model')
      setModelId(scanModel)
      setAssistantModelId(await setting('assistant_model'))
      setBaseUrlDraft(await setting('provider_base_url'))
      setCustomModelDraft(scanModel)
      const cred = await loadCredential(active)
      setMasked(cred ? maskCredential(cred.value) : null)
      setShowForm(!cred)
    })()
  }, [])
  useFocusEffect(refresh)

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={[styles.head, { paddingTop: insets.top + space.sm }]}>
        <Text style={[type.title, { color: theme.text }]}>AI provider</Text>
        <Pressable onPress={() => router.back()} hitSlop={space.md}>
          <Icon name="close" size={22} color={theme.textMuted} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 120 }}>
        <View style={styles.chipRow}>
          {providersByPrice().map((p) => (
            <Pressable
              key={p}
              onPress={() => {
                setProvider(p)
                setShowForm(true)
                void (async () => {
                  const cred = await loadCredential(p)
                  setMasked(cred ? maskCredential(cred.value) : null)
                  setShowForm(!cred)
                  if (cred) {
                    await putSetting('provider', p)
                    const m = PROVIDER_MODELS[p][0]!.id
                    setModelId(m)
                    setCustomModelDraft(m)
                    await putSetting('provider_model', m)
                    // A chatbot model chosen for the previous provider cannot
                    // be valid here — reset to "follow the scan model".
                    setAssistantModelId('')
                    await putSetting('assistant_model', '')
                  }
                })()
              }}
              style={[
                styles.chip,
                provider === p
                  ? { backgroundColor: theme.text }
                  : { borderWidth: 1.5, borderColor: theme.border },
              ]}
            >
              <Text style={[type.label, { color: provider === p ? theme.bg : theme.text }]}>
                {PROVIDER_NAME[p]}
              </Text>
            </Pressable>
          ))}
        </View>

        {masked ? (
          <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Icon name="check" size={16} color={theme.affirm} weight={2.4} />
              <Text style={[type.bodyStrong, { color: theme.text }]}>Key saved</Text>
              <Text style={[type.body, { color: theme.textMuted }]}>{masked}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: space.lg, marginTop: space.md }}>
              <Pressable onPress={() => setShowForm(true)} hitSlop={space.sm}>
                <Text style={[type.label, { color: theme.protein }]}>Replace key</Text>
              </Pressable>
              <Pressable
                onPress={() =>
                  Alert.alert(
                    'Remove this key?',
                    `Photo scans stop working until you add a ${PROVIDER_NAME[provider]} key again. Your logged data is not touched.`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Remove',
                        style: 'destructive',
                        onPress: () => {
                          void (async () => {
                            await clearCredential(provider)
                            await putSetting('provider', 'none')
                            refresh()
                          })()
                        },
                      },
                    ],
                  )
                }
                hitSlop={space.sm}
              >
                <Text style={[type.label, { color: theme.safety }]}>Remove key</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {showForm ? (
          <View style={{ marginTop: space.lg }}>
            <CredentialForm
              provider={provider}
              onSaved={(m) => {
                setModelId(m)
                refresh()
              }}
            />
          </View>
        ) : null}

        {masked ? (
          <>
            <Text style={[type.label, { color: theme.textMuted, marginTop: space.xl }]}>Model</Text>
            <View style={{ marginTop: space.sm, gap: space.sm }}>
              {PROVIDER_MODELS[provider].map((m) => {
                const active = m.id === modelId
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => {
                      setModelId(m.id)
                      setCustomModelDraft(m.id)
                      void putSetting('provider_model', m.id)
                    }}
                    style={[styles.modelRow, { borderColor: active ? theme.text : theme.border, borderWidth: active ? 2 : StyleSheet.hairlineWidth }]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[type.bodyStrong, { color: theme.text }]}>{m.label}</Text>
                      <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
                        ~${m.approxScanCostUsd.toFixed(4)} per scan
                      </Text>
                    </View>
                    {active ? <Icon name="check" size={18} color={theme.text} weight={2.4} /> : null}
                  </Pressable>
                )
              })}
            </View>
            <Text style={[type.caption, { color: theme.textFaint, marginTop: space.md, lineHeight: 18 }]}>
              The cheapest vision model is the honest default: frontier models are not measurably
              better at portion size, which is where nearly all the error lives.
            </Text>

            {provider === 'openai' ? (
              <View style={[styles.card, { backgroundColor: theme.bgSunken, marginTop: space.xl }]}>
                <Text style={[type.bodyStrong, { color: theme.text }]}>Custom API endpoint (resellers)</Text>
                <Text style={[type.caption, { color: theme.textMuted, marginTop: 4, lineHeight: 18 }]}>
                  Works with any OpenAI-compatible API reseller (aicredits.in, OpenRouter, a proxy).
                  Paste the base URL their dashboard shows — it must end in /v1. Leave empty to use
                  api.openai.com directly.
                </Text>
                <TextInput
                  value={baseUrlDraft}
                  onChangeText={setBaseUrlDraft}
                  onEndEditing={() => void putSetting('provider_base_url', baseUrlDraft.trim())}
                  onBlur={() => void putSetting('provider_base_url', baseUrlDraft.trim())}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  placeholder="https://aicredits.in/v1"
                  placeholderTextColor={theme.textFaint}
                  style={[styles.input, { borderColor: theme.border, color: theme.text }]}
                />
                <Text style={[type.caption, { color: theme.textMuted, marginTop: space.md, lineHeight: 18 }]}>
                  Model ID override — type the exact model name your reseller uses (e.g. gpt-4o-mini,
                  deepseek-chat). Replaces the picker above.
                </Text>
                <TextInput
                  value={customModelDraft}
                  onChangeText={setCustomModelDraft}
                  onEndEditing={() => {
                    const v = customModelDraft.trim()
                    if (v) {
                      setModelId(v)
                      void putSetting('provider_model', v)
                    }
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="gpt-4o-mini"
                  placeholderTextColor={theme.textFaint}
                  style={[styles.input, { borderColor: theme.border, color: theme.text }]}
                />
              </View>
            ) : null}

            <Text style={[type.label, { color: theme.textMuted, marginTop: space.xl }]}>Chatbot model</Text>
            <View style={{ marginTop: space.sm, gap: space.sm }}>
              <Pressable
                onPress={() => {
                  setAssistantModelId('')
                  void putSetting('assistant_model', '')
                }}
                style={[styles.modelRow, { borderColor: assistantModelId === '' ? theme.text : theme.border, borderWidth: assistantModelId === '' ? 2 : StyleSheet.hairlineWidth }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[type.bodyStrong, { color: theme.text }]}>Same as scan model</Text>
                  <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
                    One model for everything
                  </Text>
                </View>
                {assistantModelId === '' ? <Icon name="check" size={18} color={theme.text} weight={2.4} /> : null}
              </Pressable>
              {PROVIDER_MODELS[provider].map((m) => {
                const active = m.id === assistantModelId
                return (
                  <Pressable
                    key={`chat-${m.id}`}
                    onPress={() => {
                      setAssistantModelId(m.id)
                      void putSetting('assistant_model', m.id)
                    }}
                    style={[styles.modelRow, { borderColor: active ? theme.text : theme.border, borderWidth: active ? 2 : StyleSheet.hairlineWidth }]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[type.bodyStrong, { color: theme.text }]}>{m.label}</Text>
                      <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
                        Text only — no photo cost
                      </Text>
                    </View>
                    {active ? <Icon name="check" size={18} color={theme.text} weight={2.4} /> : null}
                  </Pressable>
                )
              })}
            </View>
            <TextInput
              value={assistantModelId && !PROVIDER_MODELS[provider].some((m) => m.id === assistantModelId) ? assistantModelId : ''}
              onChangeText={(v) => {
                setAssistantModelId(v.trim())
                if (v.trim()) void putSetting('assistant_model', v.trim())
              }}
              onEndEditing={() => {
                if (!assistantModelId.trim()) void putSetting('assistant_model', '')
              }}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Custom chatbot model ID (optional)"
              placeholderTextColor={theme.textFaint}
              style={[styles.input, { borderColor: theme.border, color: theme.text, marginTop: space.sm }]}
            />
            <Text style={[type.caption, { color: theme.textFaint, marginTop: space.md, lineHeight: 18 }]}>
              The chatbot is text-only: it reads your log and proposes changes, and never sees a
              photo. A cheap model here barely changes answer quality and makes credits last far
              longer — photo scans remain on the scan model above.
            </Text>
          </>
        ) : null}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    minHeight: MIN_TAP_TARGET,
    justifyContent: 'center',
  },
  card: { marginTop: space.lg, padding: space.lg, borderRadius: radius.lg },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
  },
  input: {
    borderWidth: 1.5,
    borderRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    marginTop: space.md,
    fontSize: 14,
  },
})
