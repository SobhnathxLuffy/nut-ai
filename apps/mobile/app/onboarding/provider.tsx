import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { cheapestModel, PROVIDER_MODELS, providersByPrice, type ProviderId } from '@nutai/prompt'
import { OnboardingScreen } from '../../src/components/onboarding/Chrome'
import { OptionCard } from '../../src/components/onboarding/Controls'
import { CredentialForm, PROVIDER_NAME } from '../../src/components/CredentialForm'
import type { IconName } from '../../src/components/Icon'
import { putSetting } from '../../src/data/repo'
import { nextRoute, stepIndex, TOTAL_STEPS } from '../../src/onboarding/flow'
import { setAnswer, useAnswers } from '../../src/onboarding/store'
import { useTheme } from '../../src/theme/ThemeProvider'
import { radius, space, type } from '../../src/theme/tokens'

/**
 * How should Nut AI recognize your food? — provider AND key on one screen
 * (UI/UX report Ch. 8.1: "provider and key on one screen").
 *
 * The old flow asked which provider, then made the key a separate screen (or
 * skipped it entirely). They are one decision: pick a provider and the shared
 * CredentialForm appears directly beneath the cards — the SAME component that
 * runs in Settings, so "works in onboarding, broken in settings" cannot happen
 * by drift. The form owns the two Anthropic credential shapes, the six named
 * failure states, and the persistence of provider/provider_model; on success
 * it reports the model id up and unlocks Continue.
 *
 * THE PICKER IS NEUTRAL. Price-sorted, no "recommended" badge, no pre-selected
 * provider. Within a chosen provider the cheapest vision model is pre-selected,
 * which is honest rather than a compromise: the literature says frontier models
 * are NOT better at portion estimation, and portion is the dominant error
 * source. Paying 5-30x buys identification quality we already have.
 *
 * Neutrality is also the cheapest available mitigation against being treated as
 * a joint controller of the data the user sends to a provider we recommended.
 */

const LABELS: Record<ProviderId, { name: string; icon: IconName; note: string }> = {
  openai: { name: 'OpenAI', icon: 'scan', note: 'GPT-4o and 4o-mini' },
  google: { name: 'Google', icon: 'scan', note: 'Gemini — paid tier only' },
  anthropic: { name: 'Anthropic', icon: 'scan', note: 'Claude Haiku and Sonnet' },
}

export default function ProviderScreen() {
  const theme = useTheme()
  const a = useAnswers()
  const order = providersByPrice()
  const [saved, setSaved] = useState(false)

  const realProvider: ProviderId | null =
    a.provider && a.provider !== 'none' ? a.provider : null

  // Switching providers after a saved key invalidates the save for the NEW
  // choice — the key verified was the previous provider's.
  useEffect(() => {
    setSaved(false)
  }, [a.provider])

  const canContinue = a.provider === 'none' || (realProvider != null && saved)

  return (
    <OnboardingScreen
      step={stepIndex('provider')}
      total={TOTAL_STEPS}
      title="How should Nut AI recognize your food?"
      subtitle="Bring your own API key. Your photo goes to the provider you name and nowhere else — we run no server."
      ctaDisabled={!canContinue}
      disabledHint={a.provider === undefined ? 'Choose a provider to continue' : 'Verify your key, or skip for now'}
      onCta={() => {
        if (a.provider === 'none') void putSetting('provider', 'none')
        router.push(nextRoute('provider') as never)
      }}
      // The skip path mirrors the old key screen: no key means the 'none'
      // provider — barcode, label OCR, search and manual still work. Only
      // offered once a REAL provider is picked (the "No key for now" card
      // already covers the never-mind case).
      secondaryLabel={realProvider != null && !saved ? 'Skip for now' : undefined}
      onSecondary={() => {
        setAnswer('provider', 'none')
        void putSetting('provider', 'none')
        router.push(nextRoute('provider') as never)
      }}
      scroll
    >
      <ScrollView scrollEnabled={false}>
        {order.map((p) => {
          const cheap = cheapestModel(p)
          return (
            <OptionCard
              key={p}
              label={LABELS[p].name}
              sublabel={`${LABELS[p].note} · ~$${cheap.approxScanCostUsd.toFixed(4)}/scan`}
              glyph={LABELS[p].icon}
              selected={a.provider === p}
              onPress={() => setAnswer('provider', p)}
            />
          )
        })}

        <OptionCard
          label="No key for now"
          sublabel="Barcode, label scan, text search and manual entry all still work"
          glyph="minus"
          selected={a.provider === 'none'}
          onPress={() => setAnswer('provider', 'none')}
        />
      </ScrollView>

      <View style={[styles.note, { backgroundColor: theme.bgSunken }]}>
        <Text style={[type.caption, { color: theme.textMuted, lineHeight: 19 }]}>
          Sorted by price, with no recommendation. Frontier models are not measurably better at
          judging portion size — which is where nearly all the error is — so the cheapest vision
          model is pre-selected on purpose, not as a compromise.
        </Text>
      </View>

      {a.provider === 'google' ? (
        <View style={[styles.warn, { backgroundColor: theme.uncertainBg }]}>
          <Text style={[type.caption, { color: theme.text, lineHeight: 19 }]}>
            Gemini's free tier is blocked for photo scans. Google's own API terms say "do not submit
            sensitive, confidential, or personal information to the Unpaid Services", and a meal
            photo is health data. A paid Google key works normally.
          </Text>
        </View>
      ) : null}

      {a.provider && a.provider !== 'none' ? (
        <Text style={[type.caption, { color: theme.textFaint, marginTop: space.lg, lineHeight: 19 }]}>
          {PROVIDER_MODELS[a.provider].length} models available. You can change model and set a
          monthly spend cap after entering your key.
        </Text>
      ) : null}

      {realProvider ? (
        <View style={styles.keySection}>
          <Text style={[type.heading, { color: theme.text }]}>Connect {PROVIDER_NAME[realProvider]}</Text>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: 2, marginBottom: space.md }]}>
            We'll check the key works before saving it. It is stored in the iOS Keychain and sent
            only to {PROVIDER_NAME[realProvider]}.
          </Text>
          {/* key= remounts the form when the provider changes, so drafts and
              verify state can never leak across providers. */}
          <CredentialForm
            key={realProvider}
            provider={realProvider}
            onSaved={(modelId) => {
              setAnswer('providerModel', modelId)
              setSaved(true)
            }}
          />
        </View>
      ) : null}
    </OnboardingScreen>
  )
}

const styles = StyleSheet.create({
  note: { marginTop: space.lg, padding: space.lg, borderRadius: radius.lg },
  warn: { marginTop: space.md, padding: space.lg, borderRadius: radius.lg },
  keySection: { marginTop: space.xxl },
})
