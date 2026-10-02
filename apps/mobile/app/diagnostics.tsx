import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Text, View } from 'react-native'
import {
  ASSISTANT_PROMPT_VERSION,
  LABEL_SCAN_PROMPT_VERSION,
  PROVIDER_IDS,
  PROMPT_VERSION,
  WEB_LOOKUP_PROMPT_VERSION,
  type ProviderId,
} from '@nutai/prompt'
import { customProviderBaseUrl, setting } from '../src/data/repo'
import { loadCredential, maskCredential } from '../src/inference/credentials'
import { describeActiveModel } from '../src/inference/active-model'
import { PROVIDER_NAME } from '../src/components/CredentialForm'
import { ItemRow } from '../src/components/ItemRow'
import { Screen } from '../src/components/Screen'
import { useTheme } from '../src/theme/ThemeProvider'
import { space, type } from '../src/theme/tokens'

/**
 * Diagnostics — UI/UX report Ch 8.8 (Wave 3): "a diagnostics page that becomes
 * the new home for the debug-class information this report removes from user
 * surfaces: active scan and chat model identifiers, base URL, and webhook
 * status."
 *
 * Every value here is read LIVE from the same settings and resolvers the
 * inference layer itself uses — provider, masked key, custom base URL, the
 * scan/chat model lines via describeActiveModel (which resolves each scope's
 * fallback exactly as the calls do), and the prompt versions from
 * @nutai/prompt. There is no webhook in Nut AI (nothing to report) — the
 * provider row is the honest status line.
 */
export default function Diagnostics() {
  const theme = useTheme()
  const [provider, setProvider] = useState<ProviderId | 'none' | ''>('')
  const [keyMask, setKeyMask] = useState<string | null>(null)
  const [baseUrl, setBaseUrl] = useState<string | null>(null)
  const [assistantModelId, setAssistantModelId] = useState('')
  const [scanLine, setScanLine] = useState<string | null>(null)
  const [chatLine, setChatLine] = useState<string | null>(null)
  const [crossFallback, setCrossFallback] = useState(false)

  useFocusEffect(
    useCallback(() => {
      let alive = true
      void (async () => {
        try {
          const p = (await setting('provider')) as ProviderId | 'none' | ''
          const active: ProviderId | 'none' | '' = PROVIDER_IDS.includes(p as ProviderId)
            ? (p as ProviderId)
            : p // 'none' | ''
          const [cred, base, assistant, scan, chat, fallback] = await Promise.all([
            active && active !== 'none' ? loadCredential(active) : Promise.resolve(null),
            customProviderBaseUrl(),
            setting('assistant_model'),
            describeActiveModel('scan'),
            describeActiveModel('chat'),
            setting('cross_provider_fallback'),
          ])
          if (!alive) return
          setProvider(active)
          setKeyMask(cred ? maskCredential(cred.value) : null)
          setBaseUrl(base)
          setAssistantModelId(assistant)
          setScanLine(scan)
          setChatLine(chat)
          setCrossFallback(fallback === 'on')
        } catch {
          if (alive) setProvider('none')
        }
      })()
      return () => {
        alive = false
      }
    }, []),
  )

  const connected = provider !== '' && provider !== 'none'
  const providerLabel = connected ? PROVIDER_NAME[provider as ProviderId] : 'Not connected'

  return (
    <Screen title="Diagnostics" back backLabel="Back to profile">
      <Text style={[type.caption, { color: theme.textMuted, lineHeight: 18 }]}>
        The debug-class detail the app surfaces: which models actually run, the endpoint they are
        reached through, and which prompt versions produced your data. Every value below is read
        live from your settings — nothing here is a placeholder.
      </Text>

      <Text style={[type.label, { color: theme.textMuted }]}>Provider</Text>
      <View style={{ gap: space.sm }}>
        <ItemRow
          icon="handshake"
          label="Provider"
          value={connected ? `${providerLabel} · ${keyMask ?? 'key missing'}` : providerLabel}
        />
        <ItemRow
          icon="check"
          label="API key"
          value={connected ? (keyMask ?? 'Key missing — scans will fail') : 'No provider configured'}
        />
        <ItemRow
          icon="target"
          label="Base URL"
          value={baseUrl ?? (connected ? `Official ${providerLabel} endpoint` : '—')}
        />
        <ItemRow
          icon="run"
          label="Cross-provider chat fallback"
          value={
            crossFallback
              ? 'On — your other saved keys may answer (billed, labeled)'
              : 'Off — this provider only'
          }
        />
      </View>

      <Text style={[type.label, { color: theme.textMuted, marginTop: space.md }]}>Models</Text>
      <View style={{ gap: space.sm }}>
        <ItemRow
          icon="scan"
          label="Active scan model"
          value={scanLine ?? 'Not connected'}
        />
        <ItemRow
          icon="sparkles"
          label="Active chat model"
          value={connected ? (assistantModelId ? (chatLine ?? '—') : 'Same as the scan model') : 'Not connected'}
        />
      </View>
      <Text style={[type.caption, { color: theme.textFaint, lineHeight: 18 }]}>
        The scan model id is sent exactly as configured (reseller overrides included); the chat
        model falls back to it when no separate chatbot model is set.
      </Text>

      <Text style={[type.label, { color: theme.textMuted, marginTop: space.md }]}>Prompt versions</Text>
      <View style={{ gap: space.sm }}>
        <ItemRow icon="nutritionLabel" label="Food photo scan" value={PROMPT_VERSION} />
        <ItemRow icon="person" label="Assistant" value={ASSISTANT_PROMPT_VERSION} />
        <ItemRow icon="barcode" label="Label scan" value={LABEL_SCAN_PROMPT_VERSION} />
        <ItemRow icon="search" label="Web lookup" value={WEB_LOOKUP_PROMPT_VERSION} />
      </View>
      <Text style={[type.caption, { color: theme.textFaint, lineHeight: 18 }]}>
        Prompt versions are fixed at build time — they identify the honesty contract each
        prediction was produced under, not a per-device setting.
      </Text>
    </Screen>
  )
}
