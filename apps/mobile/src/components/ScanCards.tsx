import { useState } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import type { SelectedQuestion } from '@nutai/repair'
import { wholeDishSizeMultiplier } from '@nutai/repair'
import { countAnswerValue, rowIdForNamedQuestion } from '../scan/review'
import { Badge } from './Badge'
import { MenuSheet } from './Sheet'
import { PressableFX } from './PressableFX'
import { Icon } from './Icon'
import { showToast } from './toast-store'
import { router } from 'expo-router'
import {
  pendingStageCopy,
  scanItemLine,
  type ScanCard,
} from '../data/pending-scans'
import { applyLoggedMealCorrections } from '../data/log-corrections'
import { db, deleteMeal, localDate } from '../data/repo'
import { retryPendingScan } from '../scan/orchestrator'
import { forgetScanOutcome, getScanOutcome } from '../scan/store'
import { showUndoableLoggedToast } from '../data/undo-toast'
import { useTheme } from '../theme/ThemeProvider'
import { radius, space, type } from '../theme/tokens'

/**
 * The scan-born meal cards (Cal AI overhaul, T-IMPL-A §A/C): the optimistic
 * scan's visible half, rendered on the Home timeline and the Food tab.
 *
 * One card per scan meal, its state read from the PERSISTED analysis_status —
 * 'captured'/'queued'/'analyzing' render the staged "Analysing…" copy,
 * 'failed' renders "Couldn't analyse — tap to fix", 'complete' renders the
 * per-item result (Indian mixed plates included) and opens the normal editor.
 * Every action is a DB write through the operation log, so undo and the
 * food-mutation refresh events work exactly like every other meal edit; the
 * parent's own refresh rides those events, no per-card wiring.
 *
 * The completed card also surfaces the pipeline's highlighted follow-up
 * questions IN PLACE (pattern #2 — low confidence is a question, not a mode)
 * when the analysis finished in this session: answering rescales the logged
 * grams through the same multipliers the review screen used, applied as an
 * undoable correction write. After a restart the card simply opens the editor
 * like every other meal — no claim of question recovery is ever made.
 */

/** Question types the card can apply against the LOGGED row. Others never render here. */
function cardAppliesQuestion(q: SelectedQuestion): boolean {
  return q.question.id === 'whole_dish_size' || q.question.id === 'count_question'
}

export function ScanCardList({ cards }: { cards: ScanCard[] }) {
  // The action sheet's meal: pending rows offer Cancel / Log manually instead;
  // failed rows offer Retry / Log manually instead / Delete.
  const [actionFor, setActionFor] = useState<ScanCard | null>(null)

  const cancelPending = async (card: ScanCard) => {
    await deleteMeal(card.mealId)
    forgetScanOutcome(card.mealId)
    showUndoableLoggedToast('Scan cancelled — the photo and row were removed.')
  }

  const logManually = (card: ScanCard) => {
    // The pending row is deleted first: a manual log must not double with the
    // late model answer. Undo still restores the cancelled scan for a moment.
    if (card.status !== 'complete') void cancelPending(card)
    router.push({ pathname: '/food-search', params: { date: localDate(Date.now()) } } as never)
  }

  const retry = (card: ScanCard) => {
    void retryPendingScan(card.mealId).catch((e) =>
      showToast({ message: e instanceof Error ? e.message : 'Could not retry the analysis', tone: 'error' }),
    )
  }

  const sections = (card: ScanCard) =>
    card.status === 'failed'
      ? [
          {
            items: [
              { key: 'retry', label: 'Retry analysis', icon: 'scan' as const, onPress: () => retry(card) },
              { key: 'manual', label: 'Log manually instead', icon: 'search' as const, onPress: () => logManually(card) },
              {
                key: 'delete',
                label: 'Delete',
                icon: 'close' as const,
                destructive: true,
                onPress: () => void cancelPending(card),
              },
            ],
          },
        ]
      : [
          {
            items: [
              { key: 'cancel', label: 'Cancel this scan', icon: 'close' as const, destructive: true, onPress: () => void cancelPending(card) },
              { key: 'manual', label: 'Log manually instead', icon: 'search' as const, onPress: () => logManually(card) },
            ],
          },
        ]

  if (cards.length === 0) return null

  return (
    <View style={{ gap: space.md }}>
      {cards.map((card) => (
        <ScanCardRow
          key={card.mealId}
          card={card}
          onPress={() => {
            if (card.status === 'complete') {
              router.push({ pathname: '/meal-detail', params: { id: card.mealId } } as never)
            } else {
              setActionFor(card)
            }
          }}
          onLongPress={() => void cancelPending(card)}
        />
      ))}
      <MenuSheet
        open={actionFor != null}
        onClose={() => setActionFor(null)}
        title={actionFor?.status === 'failed' ? "Couldn't analyse" : 'Analysing…'}
        sections={actionFor ? sections(actionFor) : []}
      />
    </View>
  )
}

function ScanCardRow({
  card,
  onPress,
  onLongPress,
}: {
  card: ScanCard
  onPress: () => void
  onLongPress?: () => void
}) {
  const theme = useTheme()
  const outcome = card.status === 'complete' ? getScanOutcome(card.mealId) : undefined
  const questions = (outcome?.questions ?? []).filter(cardAppliesQuestion)

  const answerQuestion = (q: SelectedQuestion, optionValue: string) => {
    if (!outcome) return
    // The SAME named-row matching and multiplier math the review screen's
    // chips use (src/scan/review.ts) — the only difference is the baseline
    // (the grams the scan LANDED at, kept in the session outcome) and that
    // the result is applied to the logged row as an undoable correction.
    void (async () => {
      const items = card.items
      const named = rowIdForNamedQuestion(
        q.text,
        items.map((it) => ({ id: String(it.itemId), displayName: it.name })),
      )
      const item = named != null ? items.find((it) => String(it.itemId) === named) : null
      if (!item) {
        showToast({ message: 'Open the meal to adjust that item directly.' })
        return
      }
      let grams: number | null = null
      if (q.question.id === 'whole_dish_size') {
        const multiplier = wholeDishSizeMultiplier(optionValue)
        const baseline = outcome.baselineGrams[item.name] ?? item.grams
        if (multiplier != null && multiplier !== 1) grams = Math.round(baseline * multiplier)
      } else {
        // count_question on a LOGGED row: the scan's landed grams presumed the
        // estimate's own unit count (unknown here), so the answer REPLACES the
        // count from the one-unit baseline — the same documented best-effort
        // reading countMultiplierFor gives when the model stated no count.
        const answerCount = countAnswerValue(optionValue)
        const baseline = outcome.baselineGrams[item.name] ?? item.grams
        if (answerCount != null) grams = Math.round(baseline * answerCount)
      }
      if (grams == null) return
      try {
        await applyLoggedMealCorrections(await db(), [
          { kind: 'update', key: `m${card.mealId}i${item.itemId}`, grams },
        ])
        // Answered — the chip's question leaves the card; the refresh event
        // re-renders the row at its new grams.
        outcome.questions = outcome.questions.filter((x) => x.question.id !== q.question.id)
        showToast({ message: `${item.name}: ${Math.round(grams)} g.`, tone: 'success' })
      } catch (e) {
        showToast({ message: e instanceof Error ? e.message : 'Could not apply that answer', tone: 'error' })
      }
    })()
  }

  const pending = card.status === 'captured' || card.status === 'queued' || card.status === 'analyzing'
  const failed = card.status === 'failed'
  const title = failed
    ? "Couldn't analyse — tap to fix"
    : pending
      ? 'Analysing…'
      : `${slotLabel(card.slot)} · ${timeLabel(card.loggedAt)}`

  return (
    <PressableFX
      accessibilityRole="button"
      accessibilityLabel={
        failed
          ? "Scan failed. Tap for retry, manual logging or delete."
          : pending
            ? `Scan analysing. ${pendingStageCopy(card.status)} Tap to cancel or log manually instead.`
            : `Scanned meal with ${card.items.length} ${card.items.length === 1 ? 'item' : 'items'}. Tap to edit.`
      }
      accessibilityHint={pending ? undefined : 'Long-press to delete with undo.'}
      onPress={onPress}
      onLongPress={onLongPress}
      style={[
        styles.card,
        {
          borderColor: failed ? theme.uncertain : theme.border,
          backgroundColor: theme.bgElevated,
        },
      ]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
          {!failed && !pending ? null : (
            <Icon name={failed ? 'warning' : 'scan'} size={14} color={failed ? theme.uncertainText : theme.textMuted} />
          )}
          <Text style={[type.bodyStrong, { color: theme.text }]} numberOfLines={1}>
            {title}
          </Text>
        </View>

        {pending ? (
          <>
            {/* Pattern #4 — the wait is designed: staged copy from the row's
                own stored state, the worst case named, never a bare spinner. */}
            <Text style={[type.caption, { color: theme.textMuted }]}>{pendingStageCopy(card.status)}</Text>
            <Text style={[type.caption, { color: theme.textFaint }]}>
              Usually under a minute. You can keep using the app — it lands here when done.
            </Text>
          </>
        ) : null}

        {failed ? (
          <Text style={[type.caption, { color: theme.uncertainText }]}>
            Your photo is saved. Retry the analysis, log it manually, or delete.
          </Text>
        ) : null}

        {card.status === 'complete' ? (
          <>
            {card.items.length === 0 ? (
              <Text style={[type.caption, { color: theme.textMuted }]}>No items were detected for this meal.</Text>
            ) : (
              card.items.map((item) => (
                <Text
                  key={item.itemId}
                  style={[type.caption, { color: item.isEstimate ? theme.uncertainText : theme.textMuted }]}
                  numberOfLines={2}
                >
                  {scanItemLine(item)}
                  {item.isEstimate ? ' · estimate' : ''}
                </Text>
              ))
            )}
            {questions.length > 0 ? (
              <View style={{ marginTop: space.xs, gap: space.xs }}>
                {questions.map((q) => (
                  <View key={q.question.id} style={{ gap: space.xs }}>
                    <Text style={[type.label, { color: theme.text }]}>{q.text}</Text>
                    <View style={styles.chipRow}>
                      {q.question.options.map((opt) => (
                        <Badge
                          key={opt.value}
                          label={opt.label}
                          size="sm"
                          onPress={() => answerQuestion(q, opt.value)}
                          accessibilityLabel={`${opt.label} — applies to the logged meal`}
                        />
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        ) : null}
      </View>

      {card.photoUri ? (
        <Image source={{ uri: card.photoUri }} style={styles.thumb} />
      ) : (
        <Pressable onPress={onPress} hitSlop={space.sm} style={styles.chevron}>
          <Icon name="chevron" size={16} color={theme.textFaint} />
        </Pressable>
      )}
    </PressableFX>
  )
}

function slotLabel(slot: string | null): string {
  const label = slot ?? 'Meal'
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function timeLabel(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  thumb: { width: 44, height: 44, borderRadius: radius.sm },
  chevron: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '90deg' }],
  },
})
