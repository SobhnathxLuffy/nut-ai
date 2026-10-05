import { router } from 'expo-router'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Button, Card, Label, Screen } from '../components/Screen'
import { Icon } from '../components/Icon'
import { selectionAsync } from '../utils/haptics'
import { useTheme } from '../theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../theme/tokens'
import { TUTORIAL_CARDS } from './content'
import { markTutorialSeen } from './key'

/**
 * The optional post-onboarding walkthrough (owner item #3): five cards, one
 * concept area each, built ONLY from the design-system primitives (Screen,
 * Card, Label, Button, Icon) — the content lives in content.ts as data so the
 * tests can lock the claims (real feature names, offline honesty) without RN.
 *
 * It is a card walkthrough BY DELIBERATE CHOICE, not a spotlight overlay: a
 * spotlight must coordinate with live screens' geometry, so every redesign
 * breaks it. These cards teach what to tap by name instead.
 *
 * Never traps (AGENTS §8.2):
 *   - Skip is visible on EVERY card and exits via the one dismiss helper;
 *   - the screen is always PUSHED above the tabs (replace-then-push at
 *     onboarding completion, router.push from the Profile replay row), so
 *     hardware Back and Skip both pop to a defined place;
 *   - Finish = Skip + the final card.
 *
 * Shown-once lives in key.ts: both exit paths mark the seen marker, and the
 * marker is never un-armed (resetEverything clears it with the rest).
 */
export function Tutorial() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [index, setIndex] = useState(0)
  const card = TUTORIAL_CARDS[index]!
  const last = index === TUTORIAL_CARDS.length - 1

  // The ONE exit for Skip and Finish: mark seen, then pop. Fire-and-forget on
  // the kv write — a tiny set that must not delay the dismissal.
  const dismiss = () => {
    void markTutorialSeen()
    router.back()
  }

  const go = (next: number) => {
    void selectionAsync()
    setIndex(next)
  }

  return (
    <Screen title="Quick tour" largeTitle={false}>
      {/* Screen's own content padding (180 bottom) already clears the dock. */}
      <View style={{ gap: space.md }}>
        {/* key={card.id} remounts the card body per step so screen readers
            announce the new content instead of a silent text swap. */}
        <Card key={card.id}>
          <View style={[styles.iconSq, { backgroundColor: theme.bgSunken }]}>
            <Icon name={card.icon} size={28} />
          </View>
          <Text accessibilityRole="header" style={[type.title, { color: theme.text }]}>
            {card.title}
          </Text>
          <Label muted>{card.body}</Label>
          <View style={{ gap: space.md, marginTop: space.xs }}>
            {card.points.map((point) => (
              <View key={point} style={styles.point}>
                <View style={[styles.bullet, { backgroundColor: theme.accent }]} />
                <Label>{point}</Label>
              </View>
            ))}
          </View>
        </Card>
      </View>

      {/* The fixed dock (plan.tsx's dock pattern): progress + Skip, then the
          actions. Skip is outside every per-card conditional — visible on
          every card, always one tap from leaving. */}
      <View
        style={[
          styles.dock,
          {
            backgroundColor: theme.bg,
            borderTopColor: theme.border,
            paddingBottom: Math.max(insets.bottom, space.lg),
          },
        ]}
      >
        <View style={styles.progressRow}>
          <Text
            accessibilityLabel={`Card ${index + 1} of ${TUTORIAL_CARDS.length}`}
            style={[type.caption, { color: theme.textMuted }]}
          >
            {`Card ${index + 1} of ${TUTORIAL_CARDS.length}`}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Skip the tour"
            onPress={dismiss}
            hitSlop={space.sm}
            style={styles.skip}
          >
            <Text style={[type.bodyStrong, { color: theme.textMuted }]}>Skip</Text>
          </Pressable>
        </View>
        {/* Decorative — the "Card N of M" caption above carries the same
            information to screen readers. */}
        <View
          style={styles.dots}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {TUTORIAL_CARDS.map((c, i) => (
            <View
              key={c.id}
              style={[styles.dot, { backgroundColor: i === index ? theme.text : theme.border }]}
            />
          ))}
        </View>
        <View style={styles.actions}>
          {index > 0 ? (
            <Button label="Back" onPress={() => go(index - 1)} style={{ flex: 1 }} />
          ) : null}
          <Button
            label={last ? 'Finish' : 'Next'}
            selected
            onPress={() => (last ? dismiss() : go(index + 1))}
            style={{ flex: 1 }}
          />
        </View>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  iconSq: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  point: { flexDirection: 'row', gap: space.sm },
  bullet: { width: 7, height: 7, borderRadius: 4, marginTop: 7 },
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: space.md,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: MIN_TAP_TARGET,
  },
  skip: { minHeight: MIN_TAP_TARGET, justifyContent: 'center', paddingLeft: space.md },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: space.sm },
  dot: { width: 7, height: 7, borderRadius: 4 },
  actions: { flexDirection: 'row', gap: space.sm },
})
