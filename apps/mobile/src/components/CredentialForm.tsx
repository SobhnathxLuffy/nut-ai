import * as Clipboard from 'expo-clipboard'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { PROVIDER_MODELS, cheapestModel, type ProviderId } from '@nutai/prompt'
import { customProviderBaseUrl, putSetting, setting } from '../data/repo'
import { normalizeBaseUrl } from '../inference/base-url'
import { looksPlausible, saveCredential, type CredentialKind } from '../inference/credentials'
import { validateCredential } from '../inference/pathA/validate'
import { useTheme } from '../theme/ThemeProvider'
import { radius, space, type } from '../theme/tokens'
import { Icon } from './Icon'

/**
 * The credential entry + validation form, shared VERBATIM between onboarding
 * and settings. The validation UX here — two Anthropic credential shapes, six
 * named failure states, wrong-tab recovery, raw HTTP detail on failure — is
 * exactly the kind of logic that silently drifts when copy-pasted, and a
 * drifted copy is how "works in onboarding, broken in settings" happens.
 *
 * On success it persists everything scans need (Keychain credential + the
 * provider/provider_model settings the orchestrator reads) and reports up.
 */

const CONSOLE_URL: Record<ProviderId, string> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  google: 'https://aistudio.google.com/apikey',
}

export const PROVIDER_NAME: Record<ProviderId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
}

export function CredentialForm({
  provider,
  onSaved,
}: {
  provider: ProviderId
  onSaved: (modelId: string) => void
}) {
  const theme = useTheme()
  const [kind, setKind] = useState<CredentialKind>('api_key')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The raw status and body. Shown on failure so a bad key is diagnosable
  // instead of mysterious — a generic message is what made this unfixable.
  const [detail, setDetail] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [shape, setShape] = useState<string | null>(null)
  // Reseller support (OpenAI-compatible gateways like aicredits.in). These live
  // INSIDE the form — not behind a saved key in settings — because the exact
  // bug that motivated them: the base URL was only configurable AFTER a key
  // was saved, so a first-time reseller key was always verified against
  // api.openai.com and always rejected. Drafts initialize from the saved
  // settings so the Replace-key flow never silently drops them.
  const [baseUrl, setBaseUrl] = useState('')
  const [modelOverride, setModelOverride] = useState('')
  const [hint, setHint] = useState<string | null>(null)

  const model = cheapestModel(provider)
  const modelId = modelOverride.trim() || model.id
  const customModel = PROVIDER_MODELS[provider].some((m) => m.id === modelId) ? null : modelId
  const plausible = looksPlausible(provider, kind, value)

  useEffect(() => {
    void (async () => {
      const savedUrl = await customProviderBaseUrl()
      if (savedUrl) setBaseUrl(savedUrl)
      const savedModel = await setting('provider_model')
      // Prefill when the saved model can belong to this provider: a catalogue
      // id, a vendor-prefixed reseller id ("openai/gpt-4o-mini"), or ANY id
      // outside every catalogue — a bare custom id like "gemini-2.5-flash" is
      // exactly what a reseller user types, and it must survive a re-verify
      // instead of being silently replaced by the cheapest catalogue model.
      const inAnyCatalogue = savedModel
        ? Object.values(PROVIDER_MODELS).some((list) => list.some((m) => m.id === savedModel))
        : false
      if (
        savedModel &&
        (PROVIDER_MODELS[provider].some((m) => m.id === savedModel) ||
          savedModel.includes('/') ||
          !inAnyCatalogue)
      ) {
        setModelOverride(savedModel)
      }
    })()
  }, [provider])

  async function verify() {
    if (busy || !plausible) return
    setBusy(true)
    setError(null)
    setHint(null)

    const usedBaseUrl = normalizeBaseUrl(baseUrl) || null
    const res = await validateCredential(
      provider,
      modelId,
      { kind, value: value.trim() },
      fetch,
      15_000,
      usedBaseUrl,
    )
    setBusy(false)

    if (!res.ok) {
      setError(explain(res.error.kind, res.error.message))
      setDetail(res.detail)
      setHint(res.hint ?? null)
      return
    }

    // Store the shape the provider ACTUALLY accepted, not the tab that was
    // selected — pasting a CLI token into the API-key tab is the most common
    // mistake here, and correcting it silently beats failing on it.
    const acceptedKind = res.usedShape === 'bearer' ? 'oauth' : 'api_key'
    await saveCredential(provider, { kind: acceptedKind, value: value.trim() })
    await putSetting('provider', provider)
    await putSetting('provider_model', modelId)
    // Persist the base URL exactly as verified — including a deliberate empty
    // value, which clears a stale reseller override.
    await putSetting('provider_base_url', usedBaseUrl ?? '')
    setShape(res.usedShape)
    setOk(true)
    onSaved(modelId)
  }

  return (
    <View>
      {/* Anthropic accepts either shape, so the choice is explicit. */}
      {provider === 'anthropic' ? (
        <View style={[styles.tabs, { backgroundColor: theme.bgSunken }]}>
          {(['api_key', 'oauth'] as const).map((k) => (
            <Pressable
              key={k}
              onPress={() => {
                setKind(k)
                setError(null)
              }}
              style={[styles.tab, kind === k && { backgroundColor: theme.bgElevated }]}
            >
              <Text style={[type.label, { color: kind === k ? theme.text : theme.textMuted }]}>
                {k === 'api_key' ? 'API key' : 'Claude CLI token'}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={[styles.how, { backgroundColor: theme.bgSunken }]}>
        {provider === 'anthropic' && kind === 'oauth' ? (
          <>
            <Text style={[type.bodyStrong, { color: theme.text }]}>Sign in through the Claude CLI</Text>
            <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs, lineHeight: 19 }]}>
              On a computer with Claude Code installed, run this and paste what it prints:
            </Text>
            <Pressable
              onPress={() => void Clipboard.setStringAsync('claude setup-token')}
              style={[styles.code, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}
            >
              <Text style={[styles.mono, { color: theme.text }]}>claude setup-token</Text>
              <Icon name="bookmark" size={16} color={theme.textFaint} />
            </Pressable>
            <Text style={[type.caption, { color: theme.textFaint, marginTop: space.sm, lineHeight: 18 }]}>
              This uses your existing Claude subscription instead of API credit. The check below
              proves it can actually run scans, not just log in.
            </Text>
          </>
        ) : (
          <>
            <Text style={[type.bodyStrong, { color: theme.text }]}>
              Get a key from {PROVIDER_NAME[provider]}
            </Text>
            <Pressable
              onPress={() => void Linking.openURL(CONSOLE_URL[provider])}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.sm }}
            >
              <Text style={[type.label, { color: theme.protein }]}>Open the console</Text>
              <Icon name="chevron" size={14} color={theme.protein} />
            </Pressable>
            <Text style={[type.caption, { color: theme.textFaint, marginTop: space.sm, lineHeight: 18 }]}>
              Billing is between you and {PROVIDER_NAME[provider]}. We never see the key, and there
              is no account here to attach it to.
            </Text>
          </>
        )}
      </View>

      {/*
       * Reseller fields live HERE, before Verify — a reseller key verified
       * without its base URL always lands on the official endpoint and always
       * 401s. Shown for EVERY provider: on a custom base URL the scan, chat
       * and validation calls all speak the OpenAI-compatible dialect for any
       * provider, so a Google/Anthropic user pointed at a reseller needs the
       * same fields an OpenAI user does. The URL is persisted on blur too, so
       * a failed verify for an unrelated reason does not lose what was typed.
       */}
      <View style={[styles.reseller, { backgroundColor: theme.bgSunken, borderColor: theme.border }]}>
        <Text style={[type.bodyStrong, { color: theme.text }]}>Using a reseller? (optional)</Text>
        <Text style={[type.caption, { color: theme.textMuted, marginTop: 4, lineHeight: 18 }]}>
          Keys from OpenAI-compatible resellers work here for every provider —
          aicredits.in, OpenRouter, a proxy. Paste the base URL their dashboard
          shows (ends in /v1), and the exact model ID if it differs from the
          default. Leave empty for the official {PROVIDER_NAME[provider]} endpoint.
        </Text>
        <TextInput
          accessibilityLabel="Reseller base URL"
          placeholder="https://aicredits.in/v1"
          placeholderTextColor={theme.textFaint}
          value={baseUrl}
          onChangeText={(t) => {
            setBaseUrl(t)
            setError(null)
            setDetail(null)
            setHint(null)
            setOk(false)
          }}
          onEndEditing={() => void putSetting('provider_base_url', normalizeBaseUrl(baseUrl))}
          onBlur={() => void putSetting('provider_base_url', normalizeBaseUrl(baseUrl))}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          editable={!busy}
          style={[styles.resellerInput, { color: theme.text, backgroundColor: theme.bgElevated, borderColor: theme.border }]}
        />
        <TextInput
          accessibilityLabel="Reseller model ID"
          placeholder={`Model ID (default ${model.id})`}
          placeholderTextColor={theme.textFaint}
          value={modelOverride}
          onChangeText={(t) => {
            setModelOverride(t)
            setError(null)
            setDetail(null)
            setHint(null)
            setOk(false)
          }}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
          style={[styles.resellerInput, { color: theme.text, backgroundColor: theme.bgElevated, borderColor: theme.border }]}
        />
      </View>

      <TextInput
        accessibilityLabel="API credential"
        placeholder={kind === 'oauth' ? 'Paste the token' : 'sk-…'}
        placeholderTextColor={theme.textFaint}
        value={value}
        onChangeText={(t) => {
          setValue(t)
          setError(null)
          setDetail(null)
          setOk(false)
        }}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={!ok}
        editable={!busy}
        style={[styles.input, { color: theme.text, backgroundColor: theme.bgSunken, borderColor: error ? theme.safety : theme.border }]}
      />

      {busy ? (
        <View style={{ marginTop: space.lg, alignItems: 'center' }}>
          <ActivityIndicator color={theme.textFaint} />
        </View>
      ) : null}

      {error ? (
        <View style={[styles.result, { backgroundColor: theme.safetyBg }]}>
          <Text style={[type.caption, { color: theme.safety, lineHeight: 19 }]}>{error}</Text>
          {hint ? (
            <Text style={[type.caption, { color: theme.safety, marginTop: space.sm, lineHeight: 19 }]}>
              {hint}
            </Text>
          ) : null}
          {detail ? (
            <Text style={[styles.mono, { color: theme.safety, marginTop: space.sm, fontSize: 11 }]}>
              {detail}
            </Text>
          ) : null}
        </View>
      ) : null}

      {ok ? (
        <View style={[styles.result, { backgroundColor: theme.uncertainBg }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Icon name="check" size={18} color={theme.affirm} weight={2.4} />
            <Text style={[type.bodyStrong, { color: theme.text }]}>Key works</Text>
          </View>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs, lineHeight: 19 }]}>
            Verified as {shape === 'bearer' ? 'an OAuth / CLI token' : 'an API key'}. Using{' '}
            {customModel
              ? `${customModel} — cost is whatever your reseller charges for it`
              : `${model.label} at roughly $${model.approxScanCostUsd.toFixed(4)} per scan`}
            .
          </Text>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          disabled={busy || !plausible}
          onPress={verify}
          style={[
            styles.verify,
            { backgroundColor: theme.text },
            (busy || !plausible) && { opacity: 0.4 },
          ]}
        >
          <Text style={[type.bodyStrong, { color: theme.bg }]}>
            {busy ? 'Checking…' : 'Verify and save'}
          </Text>
        </Pressable>
      )}
    </View>
  )
}

/** Six named states. "Something went wrong" tells nobody what to do next. */
function explain(kind: string, fallback: string): string {
  switch (kind) {
    case 'key-invalid':
      return 'That credential was rejected. Check you copied the whole thing, and that the tab above matches its type — an API key and a CLI token use different headers.'
    case 'quota-exhausted':
      return 'The credential works, but the account is out of credit. Add billing with your provider and try again.'
    case 'model-unavailable':
      return 'The credential works, but that model is not enabled for this account. Some models need billing history before they unlock.'
    case 'offline':
      return 'No connection to the provider. Nothing was saved — try again when you are back online.'
    case 'timeout-ambiguous':
      return 'The check timed out. Nothing was saved.'
    default:
      return fallback
  }
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', borderRadius: radius.pill, padding: 4, marginBottom: space.lg },
  tab: { flex: 1, alignItems: 'center', paddingVertical: space.sm, borderRadius: radius.pill },
  how: { padding: space.lg, borderRadius: radius.lg },
  reseller: {
    marginTop: space.lg,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  resellerInput: {
    marginTop: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 14,
    minHeight: 48,
  },
  code: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  // Menlo is iOS-only; Android silently falls back to the default sans unless
  // told 'monospace' explicitly.
  mono: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 15 },
  input: {
    marginTop: space.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 16,
    minHeight: 54,
  },
  result: { marginTop: space.lg, padding: space.lg, borderRadius: radius.lg },
  verify: {
    marginTop: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
})
