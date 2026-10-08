import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../theme/tokens'

/**
 * F7 / T6 — THE one inline month picker (no dependency; RN primitives only).
 *
 * Two screens edit calendar dates and both used to ask the user to type or
 * compose numeric parts (meal-detail's free-text "Date (YYYY-MM-DD)", the
 * program form's three numeric fields). One shared grid replaces both:
 * month arrows, a 6-week grid, the selected day highlighted, today outlined.
 * Values are LOCAL calendar dates as ISO strings ('YYYY-MM-DD') — the same
 * format every screen already stores; no timezone arithmetic happens here.
 *
 * The grid is rendered expanded by the caller (each host wraps it in its own
 * disclosure control so the layout stays theirs).
 */
const WEEKDAY_HEADERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Monday-first weekday index (0=Mon … 6=Sun) of an ISO local date. */
function mondayIndex(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return (new Date(y!, m! - 1, d!).getDay() + 6) % 7
}

function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate()
}

export function MonthPicker({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const theme = useTheme()
  const todayIso = (() => {
    const n = new Date()
    return `${n.getFullYear()}-${pad2(n.getMonth() + 1)}-${pad2(n.getDate())}`
  })()
  const [view, setView] = useState(() => {
    const [y, m] = value.split('-').map(Number)
    return { y: y ?? Number(todayIso.slice(0, 4)), m: m ?? Number(todayIso.slice(5, 7)) }
  })

  const moveMonth = (delta: number) => {
    setView((v) => {
      const next = new Date(v.y, v.m - 1 + delta, 1)
      return { y: next.getFullYear(), m: next.getMonth() + 1 }
    })
  }

  // Leading blanks push day 1 onto its Monday-first column; the grid always
  // shows whole weeks so any month fits the same fixed rows.
  const lead = mondayIndex(`${view.y}-${pad2(view.m)}-01`)
  const total = daysInMonth(view.y, view.m)
  const cells: Array<{ iso: string; day: number } | null> = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: total }, (_, i) => ({ day: i + 1, iso: `${view.y}-${pad2(view.m)}-${pad2(i + 1)}` })),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <View accessibilityLabel="Pick a date">
      <View style={styles.headerRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => moveMonth(-1)} hitSlop={space.sm} style={styles.arrow}>
          <Text style={[type.bodyStrong, { color: theme.text }]}>{'‹'}</Text>
        </Pressable>
        <Text style={[type.bodyStrong, { color: theme.text, flex: 1, textAlign: 'center' }]}>
          {MONTHS[view.m - 1]} {view.y}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => moveMonth(1)} hitSlop={space.sm} style={styles.arrow}>
          <Text style={[type.bodyStrong, { color: theme.text }]}>{'›'}</Text>
        </Pressable>
      </View>

      <View style={styles.grid}>
        {WEEKDAY_HEADERS.map((w, i) => (
          <Text key={`w${i}`} style={[type.caption, { color: theme.textFaint, textAlign: 'center' }]}>
            {w}
          </Text>
        ))}
        {cells.map((cell, i) =>
          cell === null ? (
            <View key={`b${i}`} style={styles.cell} />
          ) : (
            <Pressable
              key={cell.iso}
              accessibilityRole="button"
              accessibilityLabel={`Choose ${MONTHS[view.m - 1]} ${cell.day}, ${view.y}`}
              accessibilityState={{ selected: cell.iso === value }}
              onPress={() => onChange(cell.iso)}
              hitSlop={space.xs}
              style={[
                styles.cell,
                cell.iso === value && { backgroundColor: theme.text, borderRadius: radius.md },
                cell.iso === todayIso && cell.iso !== value && { borderWidth: 1, borderColor: theme.border, borderRadius: radius.md },
              ]}
            >
              <Text style={[type.body, { color: cell.iso === value ? theme.bg : theme.text }, cell.iso === todayIso || cell.iso === value ? { fontWeight: '700' } : null]}>
                {cell.day}
              </Text>
            </Pressable>
          ),
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', minHeight: MIN_TAP_TARGET, gap: space.sm },
  arrow: { minWidth: MIN_TAP_TARGET, minHeight: MIN_TAP_TARGET, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  cell: { width: '14.28%', minHeight: MIN_TAP_TARGET, alignItems: 'center', justifyContent: 'center' },
})
