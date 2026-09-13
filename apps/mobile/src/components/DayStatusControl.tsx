import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { DayCompletion, OperationRecord } from '@nutai/db-adapter'
import { useTheme } from '../theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../theme/tokens'
import { Icon, type IconName } from './Icon'

export interface DayStatusControlProps {
  date: string
  isToday?: boolean
  status: DayCompletion
  history?: OperationRecord[]
  disabled?: boolean
  onStatusChange: (status: DayCompletion) => Promise<void>
  onUndoStatus?: () => Promise<void>
}

interface StatusOption {
  key: DayCompletion
  label: string
  icon: IconName
  accessibilityLabel: string
}

const STATUS_OPTIONS: readonly StatusOption[] = [
  {
    key: 'complete',
    label: 'Complete',
    icon: 'check',
    accessibilityLabel: 'Mark day complete: all meals logged, counts in weekly averages',
  },
  {
    key: 'partial',
    label: 'Partial',
    icon: 'minus',
    accessibilityLabel: 'Mark day partial: some meals unlogged, excluded from weekly averages',
  },
  {
    key: 'fasting',
    label: 'Fasting',
    icon: 'sun',
    accessibilityLabel: 'Mark day fasting: intentional fast, counts in weekly averages as 0 kcal',
  },
  {
    key: 'unknown',
    label: 'Unconfirmed',
    icon: 'clock',
    accessibilityLabel: 'Mark day unconfirmed: default state, excluded from weekly averages',
  },
]

export function DayStatusControl({
  date,
  isToday = false,
  status,
  history = [],
  disabled = false,
  onStatusChange,
  onUndoStatus,
}: DayStatusControlProps) {
  const theme = useTheme()
  const [loadingStatus, setLoadingStatus] = useState<DayCompletion | null>(null)
  const [undoing, setUndoing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleSelect = useCallback(
    async (next: DayCompletion) => {
      if (disabled || loadingStatus !== null || next === status) return
      setLoadingStatus(next)
      setErrorMessage(null)
      try {
        await onStatusChange(next)
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Could not update day status')
      } finally {
        setLoadingStatus(null)
      }
    },
    [disabled, loadingStatus, status, onStatusChange],
  )

  const handleUndo = useCallback(async () => {
    if (!onUndoStatus || undoing || disabled) return
    setUndoing(true)
    setErrorMessage(null)
    try {
      await onUndoStatus()
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not undo status change')
    } finally {
      setUndoing(false)
    }
  }, [onUndoStatus, undoing, disabled])

  const statusExplanation = {
    complete: 'All meals logged. This day counts in your calorie and macro weekly trends.',
    fasting: 'Intentional fast. Counts in weekly averages as 0 kcal intake.',
    partial: 'Some meals were eaten but not logged. Excluded from weekly averages so partial logging will not distort your targets.',
    unknown: 'Unconfirmed day. Excluded from weekly averages until finalized as complete or fasting.',
  }[status]

  const statusBadgeColor = {
    complete: theme.affirm,
    fasting: theme.carbs,
    partial: theme.uncertain,
    unknown: theme.textMuted,
  }[status]

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.bgElevated,
          borderColor: theme.border,
        },
      ]}
    >
      {/* Header with status badge */}
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <View style={[styles.badgeDot, { backgroundColor: statusBadgeColor }]} />
            <Text style={[type.bodyStrong, { color: theme.text }]}>
              Day status: {status.charAt(0).toUpperCase() + status.slice(1)}
            </Text>
          </View>
          {!isToday && (
            <Text style={[type.micro, { color: theme.textFaint, marginTop: 2 }]}>
              Editing past day ({date}) · Recalculates affected trends
            </Text>
          )}
        </View>
        {onUndoStatus && history.length > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Undo last day status change"
            disabled={undoing || disabled}
            onPress={handleUndo}
            hitSlop={space.sm}
            style={[styles.undoButton, { borderColor: theme.border }]}
          >
            <Text style={[type.caption, { color: undoing ? theme.textFaint : theme.protein }]}>
              {undoing ? 'Undoing…' : 'Undo'}
            </Text>
          </Pressable>
        )}
      </View>

      {/* Objective, non-judgmental explanation */}
      <Text style={[type.caption, { color: theme.textMuted, lineHeight: 18 }]}>
        {statusExplanation}
      </Text>

      {/* Status options button row */}
      <View style={styles.optionsRow}>
        {STATUS_OPTIONS.map((opt) => {
          const isSelected = opt.key === status
          const isLoading = loadingStatus === opt.key
          return (
            <Pressable
              key={opt.key}
              accessibilityRole="button"
              accessibilityLabel={opt.accessibilityLabel}
              accessibilityState={{ selected: isSelected, disabled: disabled || loadingStatus !== null }}
              disabled={disabled || loadingStatus !== null}
              onPress={() => handleSelect(opt.key)}
              style={[
                styles.optionButton,
                {
                  backgroundColor: isSelected ? theme.text : theme.bgSunken,
                  borderColor: isSelected ? theme.text : theme.border,
                },
              ]}
            >
              <Icon
                name={opt.icon}
                size={16}
                color={isSelected ? theme.bg : theme.text}
              />
              <Text
                style={[
                  type.caption,
                  {
                    color: isSelected ? theme.bg : theme.text,
                    fontWeight: isSelected ? '700' : '500',
                  },
                ]}
              >
                {isLoading ? '…' : opt.label}
              </Text>
            </Pressable>
          )
        })}
      </View>

      {/* History notes if modified */}
      {history.length > 0 && (
        <Text style={[type.micro, { color: theme.textFaint }]}>
          Recent changes: {history
            .map((o) => {
              const details = JSON.parse(o.new_json ?? '{}') as { completion?: string }
              return `${details.completion ?? 'status'}${o.undone_at ? ' (undone)' : ''}`
            })
            .join(' → ')}
        </Text>
      )}

      {/* Error alert if operation fails */}
      {errorMessage && (
        <Text accessibilityRole="alert" style={[type.caption, { color: theme.safety }]}>
          {errorMessage}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: space.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  undoButton: {
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.sm,
    borderWidth: 1,
    minHeight: 28,
    justifyContent: 'center',
  },
  optionsRow: {
    flexDirection: 'row',
    gap: space.xs,
    marginTop: space.xs,
  },
  optionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: MIN_TAP_TARGET,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: space.sm,
  },
})
