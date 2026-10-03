import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon, type IconName } from './Icon'
import { PressableFX, useReducedMotion } from './PressableFX'
import { useTheme } from '../theme/ThemeProvider'
import { MIN_TAP_TARGET, elevationStyle, motion, radius, space, type } from '../theme/tokens'

/**
 * The bottom Sheet primitive — UI/UX report Ch. 8.5 (Wave 3, training).
 *
 * The FAB sheet in app/(tabs)/_layout.tsx proved the pattern (Modal + spring
 * translateY + radius.sheet 20 + tap-outside + swipe-down dismiss + reduce
 * motion, NO haptic on open/close — Table 9.2: "motion carries it; avoid
 * noise"). This is that pattern extracted so every surface that needs a sheet
 * — the workout context menu, the plate calculator — rides ONE implementation
 * instead of each screen hand-rolling its own Modal.
 *
 * The drag-vs-tap suppression flag is carried over verbatim from the FAB sheet
 * (see its doc block): react-native-web silently DROPS onClickCapture, so a
 * mouse drag released over a row would click through to that row's action.
 * Any gesture that travelled past the slop swallows exactly the one click the
 * platform synthesises on release, then clears.
 */

/** Sheet fully off-screen start/exit offset (well past the tallest content). */
const SHEET_HIDDEN = 900
/** Drag travel that commits a swipe-down dismiss. */
const SHEET_DISMISS_DY = 96
/** Travel that makes a gesture a DRAG, not a tap (row press suppression). */
const SHEET_DRAG_SLOP = 8

export function Sheet({
  open,
  onClose,
  children,
  title,
  accessibleTitle,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  /** Large title rendered at the top of the sheet content. */
  title?: string
  /** A11y label for the sheet surface (defaults to the title). */
  accessibleTitle?: string
}) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const reduced = useReducedMotion()
  // `rendered` keeps the Modal mounted through the EXIT animation.
  const [rendered, setRendered] = useState(false)
  const wasOpen = useRef(false)
  const sheetY = useRef(new Animated.Value(SHEET_HIDDEN)).current
  const backdrop = useRef(new Animated.Value(0)).current
  // True while the just-finished gesture was a drag (see the doc block).
  const suppressRowPress = useRef(false)

  useEffect(() => {
    // Guarded on the open EDGE (not `rendered`) so mounting the sheet for the
    // exit animation does not restart the entrance.
    if (open === wasOpen.current) return
    wasOpen.current = open
    if (open) {
      setRendered(true)
      suppressRowPress.current = false
      if (reduced) {
        sheetY.setValue(0)
        backdrop.setValue(1)
        return
      }
      sheetY.setValue(SHEET_HIDDEN)
      Animated.parallel([
        // Table 9.1: the sheet RISES on a spring — the spatial origin of the
        // actions it carries. JS driver (web-safe; reanimated stays off the
        // bundle).
        Animated.spring(sheetY, { toValue: 0, friction: 8, tension: 60, useNativeDriver: false }),
        Animated.timing(backdrop, { toValue: 1, duration: motion.fast, useNativeDriver: false }),
      ]).start()
      return
    }
    if (!rendered) return
    if (reduced) {
      setRendered(false)
      return
    }
    Animated.parallel([
      Animated.timing(sheetY, { toValue: SHEET_HIDDEN, duration: motion.base, useNativeDriver: false }),
      Animated.timing(backdrop, { toValue: 0, duration: motion.fast, useNativeDriver: false }),
    ]).start(({ finished }) => {
      if (finished) setRendered(false)
    })
  }, [open, reduced, rendered, sheetY, backdrop])

  // Swallows the single click the browser synthesises right after a drag's
  // mouseup/touchend (see the doc block).
  const clearDragSuppress = () => {
    setTimeout(() => {
      suppressRowPress.current = false
    }, 0)
  }

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) => gesture.dy > 10,
      onPanResponderMove: (_event, gesture) => {
        if (Math.abs(gesture.dy) > SHEET_DRAG_SLOP) suppressRowPress.current = true
        sheetY.setValue(Math.max(0, gesture.dy))
      },
      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dy > SHEET_DISMISS_DY || gesture.vy > 0.8) {
          onClose()
        } else if (!reduced) {
          Animated.spring(sheetY, { toValue: 0, friction: 8, tension: 60, useNativeDriver: false }).start()
        } else {
          sheetY.setValue(0)
        }
        clearDragSuppress()
      },
      onPanResponderTerminate: () => {
        if (!reduced) {
          Animated.spring(sheetY, { toValue: 0, friction: 8, tension: 60, useNativeDriver: false }).start()
        } else {
          sheetY.setValue(0)
        }
        clearDragSuppress()
      },
    }),
  ).current

  if (!rendered) return null

  return (
    // A11y (Wave 5C audit): RN Web's Modal host already renders role="dialog"
    // + aria-modal — but UNNAMED, so assistive tech announced a bare "dialog".
    // The label rides the same host: RN Web forwards Modal's rest props onto
    // the dialog element (aria-label lands next to its hardcoded role), while
    // native's RCTModalHostView destructures only its own props and ignores
    // this one — the inner surface label below stays the native name.
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={onClose}
      accessibilityLabel={accessibleTitle ?? title}
    >
      <View style={styles.root}>
        <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: backdrop }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close sheet"
            onPress={onClose}
            style={[StyleSheet.absoluteFill, styles.backdrop]}
          />
        </Animated.View>
        <Animated.View
          accessibilityLabel={accessibleTitle ?? title}
          {...panResponder.panHandlers}
          style={[
            styles.sheet,
            {
              backgroundColor: theme.bgElevated,
              paddingBottom: Math.max(insets.bottom, space.lg),
              transform: [{ translateY: sheetY }],
              opacity: reduced ? backdrop : 1,
            },
            elevationStyle('high', theme.isDark),
          ]}
        >
          {/* The grab handle — the swipe-down affordance. */}
          <View style={[styles.grab, { backgroundColor: theme.border }]} />
          {title ? <Text style={[type.heading, { color: theme.text }]}>{title}</Text> : null}
          {children}
        </Animated.View>
      </View>
    </Modal>
  )
}

/** One icon+label action row inside a MenuSheet. */
export interface MenuItem {
  /** Stable React key + a11y identity. */
  key: string
  label: string
  icon?: IconName
  onPress: () => void
  disabled?: boolean
  /** Safety-coloured label — reserved for genuinely destructive rows. */
  destructive?: boolean
  /** Quiet caption under the label. */
  hint?: string
}

/** A labelled group of rows — the "icon-labeled groups" of report Ch. 8.5. */
export interface MenuSection {
  caption?: string
  items: MenuItem[]
}

/**
 * A grouped context menu on the Sheet primitive (report Ch. 8.5: the twelve
 * equal-weight training buttons collapse into "icon-labeled groups"). The
 * sheet closes BEFORE the action runs so the menu never outlives the screen
 * it acts on (e.g. a row that navigates away).
 */
export function MenuSheet({
  open,
  onClose,
  title,
  sections,
}: {
  open: boolean
  onClose: () => void
  title?: string
  sections: MenuSection[]
}) {
  const theme = useTheme()

  return (
    <Sheet open={open} onClose={onClose} title={title} accessibleTitle={title}>
      {sections.map((section, sectionIndex) => (
        <View key={section.caption ?? `actions-${sectionIndex}`} style={styles.section}>
          {section.caption ? (
            <Text style={[type.caption, { color: theme.textFaint, textTransform: 'uppercase' as const }]}>
              {section.caption}
            </Text>
          ) : null}
          {section.items.map((item) => (
            <MenuRow
              key={item.key}
              item={item}
              theme={theme}
              onPress={() => {
                // Close first: the action may navigate or remount this screen.
                onClose()
                item.onPress()
              }}
            />
          ))}
        </View>
      ))}
    </Sheet>
  )
}

function MenuRow({ item, theme, onPress }: { item: MenuItem; theme: ReturnType<typeof useTheme>; onPress: () => void }) {
  const labelColor = item.destructive ? theme.safety : theme.text
  return (
    <PressableFX
      accessibilityRole="button"
      accessibilityLabel={item.label}
      accessibilityState={{ disabled: item.disabled }}
      disabled={item.disabled}
      onPress={onPress}
      style={[styles.row, { borderColor: theme.border }]}
    >
      {item.icon ? <Icon name={item.icon} size={20} color={labelColor} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.body, { color: labelColor }]}>{item.label}</Text>
        {item.hint ? <Text style={[type.caption, { color: theme.textMuted }]}>{item.hint}</Text> : null}
      </View>
    </PressableFX>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingTop: space.xs,
    paddingHorizontal: space.lg,
    gap: space.sm,
  },
  grab: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    marginVertical: space.sm,
  },
  section: { gap: space.xs },
  row: {
    minHeight: MIN_TAP_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    // Hairline outline keeps the rows scannable on the elevated sheet.
    borderWidth: StyleSheet.hairlineWidth,
  },
})
