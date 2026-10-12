import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AccessibilityInfo, useColorScheme } from 'react-native'
import { darkTheme, lightTheme, type Theme } from './tokens'
import {
  readThemePreference,
  resolveColorScheme,
  writeThemePreference,
  type ThemePreference,
} from './preference'

const ThemeContext = createContext<Theme>(lightTheme)
const MotionContext = createContext<number>(1)
const ThemePreferenceContext = createContext<{
  preference: ThemePreference
  setPreference: (p: ThemePreference) => void
}>({ preference: 'system', setPreference: () => {} })

/** Every duration in the app is multiplied by this. 0 disables motion entirely. */
export const useMotionScale = () => useContext(MotionContext)
export const useTheme = () => useContext(ThemeContext)
/** The appearance preference (system/light/dark) and its setter. */
export const useThemePreference = () => useContext(ThemePreferenceContext)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme()
  const [reduceMotion, setReduceMotion] = useState(false)
  // The in-app appearance override. Defaults to 'system' — byte-identical to
  // the pre-preference behaviour — and hydrates once on mount.
  const [preference, setPreferenceState] = useState<ThemePreference>('system')

  useEffect(() => {
    let alive = true
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (alive) setReduceMotion(v) })
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)
    void readThemePreference().then((p) => { if (alive) setPreferenceState(p) })
    return () => { alive = false; sub.remove() }
  }, [])

  const setPreference = (p: ThemePreference) => {
    // Optimistic so the sub-page's tap re-themes instantly; the write is a
    // single kv set that cannot meaningfully fail mid-render.
    setPreferenceState(p)
    void writeThemePreference(p)
  }

  // RN's ColorSchemeName carries a platform-specific 'unspecified' member;
  // normalize to the resolver's 'light' | 'dark' | null contract.
  const osScheme: 'light' | 'dark' | null = scheme === 'dark' ? 'dark' : scheme === 'light' ? 'light' : null

  const theme = useMemo(
    () => (resolveColorScheme(preference, osScheme) === 'dark' ? darkTheme : lightTheme),
    [preference, osScheme],
  )
  const preferenceValue = useMemo(() => ({ preference, setPreference }), [preference])

  return (
    <ThemeContext.Provider value={theme}>
      <MotionContext.Provider value={reduceMotion ? 0 : 1}>
        <ThemePreferenceContext.Provider value={preferenceValue}>{children}</ThemePreferenceContext.Provider>
      </MotionContext.Provider>
    </ThemeContext.Provider>
  )
}
