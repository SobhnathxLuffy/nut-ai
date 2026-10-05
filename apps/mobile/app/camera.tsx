import { CameraView, useCameraPermissions } from 'expo-camera'
import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import Svg, { Circle as SvgCircle } from 'react-native-svg'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon, type IconName } from '../src/components/Icon'
import { Badge } from '../src/components/Badge'
import { startBarcodeScan, startLabelScan, startReceiptScan, startScan } from '../src/scan/orchestrator'
import { setPhase, setScanReviewMode, type ScanReviewMode } from '../src/scan/store'
import { setting, putSetting } from '../src/data/repo'
// UI/UX report Table 9.2 (Wave 1c): "Scan captured → Light impact" — the
// shutter metaphor; fires the moment the photo is secured. §8.4 (Wave 3) adds
// the "Selection" pattern for the mode/review pills — value changes.
import { lightImpact as hapticLightImpact, selectionAsync as hapticSelection } from '../src/utils/haptics'
import { useMotionScale, useTheme } from '../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, motion, radius, space, type } from '../src/theme/tokens'

type CameraMode = 'food' | 'barcode' | 'label' | 'receipt'

const MODES: Array<{ id: CameraMode; label: string; icon: IconName }> = [
  { id: 'food', label: 'Scan food', icon: 'scan' },
  { id: 'barcode', label: 'Barcode', icon: 'barcode' },
  { id: 'label', label: 'Label', icon: 'nutritionLabel' },
  { id: 'receipt', label: 'Receipt', icon: 'receipt' },
]

const SCAN_MODE_SETTING = 'scan_review_mode'

/**
 * Quick vs Advanced review preference. Quick shows a one-tap log for
 * high-confidence scans and falls back to full review automatically when
 * anything needs a check; Advanced always opens the full review. Persisted so
 * the choice survives app restarts.
 */
function useScanReviewPref(): [ScanReviewMode, (m: ScanReviewMode) => void] {
  const [pref, setPref] = useState<ScanReviewMode>('quick')
  useEffect(() => {
    let live = true
    void setting(SCAN_MODE_SETTING).then((v) => {
      if (live && (v === 'quick' || v === 'advanced')) setPref(v)
    })
    return () => {
      live = false
    }
  }, [])
  const update = (m: ScanReviewMode) => {
    setPref(m)
    void putSetting(SCAN_MODE_SETTING, m)
  }
  return [pref, update]
}

/**
 * UI/UX report §8.4 (Wave 3): the capture-guide arc.
 *
 * A faint full ring (the guide — where the plate goes) plus one bright
 * quarter-arc. The SAME arc doubles as the shutter animation: pressing the
 * shutter sweeps it a full turn while the photo is secured. Reduce motion
 * (motionScale 0): the sweep is never constructed — the arc rests as the
 * static guide, exactly the report's collapse-to-instant rule.
 *
 * Drawn with react-native-svg (the icon set's own renderer) but animated with
 * a plain RN transform on the wrapping View — one code path that behaves the
 * same on native and web, no native-driven SVG props.
 */
function CaptureGuideArc({
  active,
  color,
  trackColor,
}: {
  /** True while the shutter is securing a photo — sweeps the arc once around. */
  active: boolean
  color: string
  trackColor: string
}) {
  const motionScale = useMotionScale()
  const sweep = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (!active) {
      sweep.setValue(0)
      return
    }
    // Reduce motion: no sweep is ever started — the guide stays static.
    if (motionScale === 0) return
    Animated.timing(sweep, {
      toValue: 1,
      duration: motion.slow * 2,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start()
  }, [active, motionScale, sweep])
  const rotate = sweep.interpolate({
    inputRange: [0, 1],
    // SVG arcs start at 3 o'clock; -90deg parks the quarter at 12, and the
    // sweep carries it a full turn back to 12.
    outputRange: ['-90deg', '270deg'],
  })
  const r = 46
  const circumference = 2 * Math.PI * r
  return (
    <Animated.View pointerEvents="none" style={{ width: ARC_SIZE, height: ARC_SIZE, transform: [{ rotate }] }}>
      <Svg width={ARC_SIZE} height={ARC_SIZE} viewBox="0 0 100 100">
        <SvgCircle cx={50} cy={50} r={r} stroke={trackColor} strokeWidth={4} fill="none" />
        <SvgCircle
          cx={50}
          cy={50}
          r={r}
          stroke={color}
          strokeWidth={4}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference / 4} ${circumference}`}
        />
      </Svg>
    </Animated.View>
  )
}

/** Outer diameter of the capture-guide ring; the shutter sits inside it. */
const ARC_SIZE = 104

/**
 * UI/UX report §8.4 (Wave 3): the Quick/Advanced review pair joins the ONE
 * Badge as a segmented control — the audit's 32pt review pills die here, an
 * interactive Badge IS the 44pt target (Table 11.1) with PressableFX press
 * state layers, radio semantics inside the radiogroup, and the Table 9.2
 * selection haptic on every change.
 */
function ReviewModeToggle({
  value,
  onChange,
  onDark,
}: {
  value: ScanReviewMode
  onChange: (m: ScanReviewMode) => void
  /** Camera overlay sits on the dark viewfinder; web fallback uses theme colors. */
  onDark: boolean
}) {
  const theme = useTheme()
  return (
    <View style={styles.reviewRow} accessibilityRole="radiogroup" accessibilityLabel="Review mode">
      {(['quick', 'advanced'] as const).map((m) => {
        const active = value === m
        // Camera chrome stays theme-independent for live-feed contrast (the
        // eslint camera exemption documents why); the web pair rides the
        // theme's sunken/ink dialects untouched.
        const fg = onDark ? (active ? '#000' : '#fff') : active ? theme.bg : theme.text
        return (
          <Badge
            key={m}
            role="radio"
            accessibilityLabel={m === 'quick' ? 'Quick review' : 'Advanced review'}
            selected={active}
            onPress={() => {
              onChange(m)
              void hapticSelection()
            }}
            style={onDark ? { backgroundColor: active ? '#fff' : 'rgba(0,0,0,0.45)' } : undefined}
          >
            <Text style={[type.label, { color: fg }]}>{m === 'quick' ? 'Quick' : 'Advanced'}</Text>
          </Badge>
        )
      })}
    </View>
  )
}

/**
 * Capture.
 *
 * SPEC-accuracy-engine.md §1.1 stages 0 and 1.
 *
 * THE SHUTTER ALWAYS SUCCEEDS. It writes a draft row before anything else can
 * fail — no key, no network, no model, no permission to analyze. A capture that
 * fails because the network is down loses the user's meal, and losing a meal is
 * unrecoverable in a way that a wrong number never is.
 *
 * Everything after the shutter — preprocessing, the model call, the pipeline —
 * lives in src/scan/orchestrator.ts and runs behind the result screen's
 * progress states. This screen's whole job is to hand off and get out of the
 * way fast.
 */
export default function Camera() {
  // P2-9: the web fallback previously exposed none of the capture modes and
  // offered no manual-GTIN path for barcodes. WebCameraFallback now mirrors
  // the native mode pills and routes each mode to its real pipeline.
  if (Platform.OS === 'web') return <WebCameraFallback />

  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [permission, requestPermission] = useCameraPermissions()
  const cameraRef = useRef<CameraView>(null)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<CameraMode>('food')
  const [reviewPref, setReviewPref] = useScanReviewPref()
  // P2-28: a takePictureAsync rejection (permission revoked mid-session, native
  // crash) used to be an unhandled rejection — the shutter just looked dead.
  // Surface it on the dark overlay so the user can retry with a diagnosis.
  const [captureError, setCaptureError] = useState<string | null>(null)
  // Barcode frames arrive continuously; only the FIRST detection may fire.
  const barcodeFired = useRef(false)

  if (!permission) return <View style={{ flex: 1, backgroundColor: '#000' }} />

  if (!permission.granted) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
        <Text style={[type.heading, { color: theme.text, textAlign: 'center' }]}>
          Nut AI needs your camera
        </Text>
        <Text style={[type.caption, { color: theme.textMuted, textAlign: 'center', marginTop: space.sm }]}>
          Photos stay on your device unless you chose a cloud provider during setup.
        </Text>
        <Pressable
          onPress={requestPermission}
          style={[styles.primary, { backgroundColor: theme.text, marginTop: space.xl }]}
        >
          <Text style={[type.bodyStrong, { color: theme.bg }]}>Allow camera</Text>
        </Pressable>
        <Pressable onPress={() => router.back()} hitSlop={space.md} style={{ marginTop: space.lg }}>
          <Text style={[type.body, { color: theme.textMuted }]}>Not now</Text>
        </Pressable>
      </View>
    )
  }

  async function capture() {
    if (busy) return
    setBusy(true)
    setCaptureError(null)
    try {
      const shot = await cameraRef.current?.takePictureAsync({ quality: 1, skipProcessing: false })
      if (!shot?.uri) return
      // Table 9.2: the capture landed — shutter haptic, then navigate.
      void hapticLightImpact()

      // The draft exists from this moment. Everything after can fail safely.
      setPhase({ kind: 'captured', photoUri: shot.uri })
      setScanReviewMode(reviewPref)

      // Navigate NOW. Preprocessing, the model call and the pipeline all run
      // behind the result screen's progress states — the user never stares at
      // a frozen viewfinder wondering whether the shutter worked.
      router.replace('/result')
      if (mode === 'label') void startLabelScan(shot.uri)
      else if (mode === 'receipt') void startReceiptScan(shot.uri)
      else void startScan(shot.uri)
    } catch (err) {
      // P2-28: never a silent dead shutter.
      console.error('[camera] capture failed', err)
      setCaptureError('Could not take the photo — try again.')
    } finally {
      setBusy(false)
    }
  }

  function onBarcode(data: string) {
    if (barcodeFired.current || !data) return
    barcodeFired.current = true
    setScanReviewMode(reviewPref)
    router.replace('/result')
    void startBarcodeScan(data)
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
        onBarcodeScanned={mode === 'barcode' ? ({ data }) => onBarcode(data) : undefined}
      />

      <View style={[styles.controls, { paddingBottom: Math.max(insets.bottom, space.xl) }]}>
        <ReviewModeToggle value={reviewPref} onChange={setReviewPref} onDark />
        <View style={styles.modeRow}>
          {/* UI/UX report §8.4 (Wave 3): the four native mode pills join the ONE
              Badge — 44pt interactive target + PressableFX state layers + the
              selection haptic. Content is passed as children so the camera's
              theme-independent chrome (white/ink on the live feed, per the
              eslint camera exemption) survives on the shared primitive. */}
          {MODES.map((m) => {
            const active = mode === m.id
            const fg = active ? '#000' : '#fff'
            return (
              <Badge
                key={m.id}
                accessibilityLabel={m.label}
                selected={active}
                onPress={() => {
                  barcodeFired.current = false
                  setMode(m.id)
                  void hapticSelection()
                }}
                style={{ width: '47%', backgroundColor: active ? '#fff' : 'rgba(0,0,0,0.45)' }}
              >
                <Icon name={m.icon} size={16} color={fg} />
                <Text style={[type.label, { color: fg }]}>{m.label}</Text>
              </Badge>
            )
          })}
        </View>

        {captureError ? (
          <Text accessibilityLiveRegion="polite" style={[type.caption, { color: '#fff', textAlign: 'center', marginTop: space.sm }]}>
            {captureError}
          </Text>
        ) : null}

        {mode === 'barcode' ? (
          <Text style={[type.caption, styles.hint]}>Point at the barcode — it scans on its own</Text>
        ) : (
          // §8.4: the capture-guide arc wraps the shutter — the guide in
          // resting state, the sweep the moment the photo is secured.
          <View style={styles.shutterWrap}>
            <View style={StyleSheet.absoluteFill}>
              <CaptureGuideArc active={busy} color="#fff" trackColor="rgba(255,255,255,0.35)" />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Take photo"
              onPress={capture}
              disabled={busy}
              style={[styles.shutter, busy && { opacity: 0.5 }]}
            />
          </View>
        )}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={() => router.back()}
        hitSlop={space.md}
        style={[styles.close, { top: insets.top + space.md }]}
      >
        {/* UI/UX report Table 12.1 (Wave 1b): the unicode × close glyph joins
            the icon set's close glyph — one close affordance across the app.
            Camera chrome stays theme-independent white for live-feed contrast
            (the eslint camera exemption documents this). */}
        <Icon name="close" size={22} color="#fff" weight={2.2} />
      </Pressable>
    </View>
  )
}

/**
 * P2-9: web capture surface. No live camera exists in the browser flow, but
 * every mode still works — food/label/receipt go through the same pick-image
 * hand-off and pipeline as before, and barcode gains the manual-GTIN path the
 * native view never needed. Same invariant as native: the pipeline lives
 * behind /result (WEB-002), and the draft exists from the hand-off moment.
 */
function WebCameraFallback() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [mode, setMode] = useState<CameraMode>('food')
  const [gtin, setGtin] = useState('')
  const [busy, setBusy] = useState(false)
  const [gtinError, setGtinError] = useState('')
  const [reviewPref, setReviewPref] = useScanReviewPref()
  const [pickError, setPickError] = useState<string | null>(null)
  // The circular shutter's label — the a11y name and the caption agree.
  const pickLabel =
    mode === 'label' ? 'Pick a label photo' : mode === 'receipt' ? 'Pick a receipt photo' : 'Pick a food photo'

  async function pickImage() {
    if (busy) return
    setBusy(true)
    setPickError(null)
    try {
      const ImagePicker = require('expo-image-picker')
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        base64: false,
      })
      if (!result.canceled && result.assets[0]) {
        const uri = result.assets[0].uri as string
        setPhase({ kind: 'captured', photoUri: uri })
        setScanReviewMode(reviewPref)
        router.replace('/result')
        if (mode === 'label') void startLabelScan(uri)
        else if (mode === 'receipt') void startReceiptScan(uri)
        else void startScan(uri)
      }
    } catch (err) {
      // P2-28 web companion: a picker crash must not strand the button.
      console.error('[camera] photo pick failed', err)
      setPickError('Could not pick that photo — try again.')
    } finally {
      setBusy(false)
    }
  }

  function submitGtin() {
    const value = gtin.replace(/\D/g, '')
    if (value.length < 8 || value.length > 14) {
      setGtinError('Enter the 8–14 digit number printed under the bars.')
      return
    }
    setGtinError('')
    setScanReviewMode(reviewPref)
    router.replace('/result')
    void startBarcodeScan(value)
  }

  return (
    <View style={[styles.webWrap, { backgroundColor: theme.bg, paddingTop: insets.top + space.xl, paddingBottom: Math.max(insets.bottom, space.xl) }]}>
      <Text accessibilityRole="header" style={[type.heading, { color: theme.text }]}>Scan food</Text>
      <Text style={[type.caption, { color: theme.textMuted, textAlign: 'center', marginTop: space.sm }]}>
        The live camera is not available here. Pick a photo, or type a barcode number.
      </Text>

      <View style={styles.modeRow}>
        {/* UI/UX report Table 12.2 (Wave 2): the theme-driven WEB mode pills
            join the ONE Badge (ink-when-selected + icon slot + 44pt target).
            §8.4 (Wave 3) adds the selection haptic. The native camera's pills
            ride the same Badge with camera-chrome children (see above). */}
        {MODES.map((m) => (
          <Badge
            key={m.id}
            label={m.label}
            icon={m.icon}
            selected={mode === m.id}
            onPress={() => { setGtinError(''); setMode(m.id); void hapticSelection() }}
            style={{ width: '47%' }}
          />
        ))}
      </View>

      <ReviewModeToggle value={reviewPref} onChange={setReviewPref} onDark={false} />

      {mode === 'barcode' ? (
        <View style={{ width: '100%', maxWidth: 420, gap: space.sm }}>
          <TextInput
            accessibilityLabel="Barcode number (GTIN)"
            allowFontScaling
            placeholder="e.g. 8901058000224"
            placeholderTextColor={theme.textFaint}
            value={gtin}
            onChangeText={(text) => { setGtinError(''); setGtin(text) }}
            keyboardType="number-pad"
            inputMode="numeric"
            style={[styles.gtinInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSunken }]}
          />
          {gtinError ? <Text accessibilityRole="alert" style={[type.caption, { color: theme.safety }]}>{gtinError}</Text> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Look up barcode"
            onPress={submitGtin}
            disabled={busy}
            style={[styles.webButton, { backgroundColor: theme.text }]}
          >
            <Text style={[type.bodyStrong, { color: theme.bg }]}>Look up barcode</Text>
          </Pressable>
        </View>
      ) : (
        // §8.4 (Wave 3): the web fallback gains the same capture-guide arc
        // wrapped around a circular shutter — the metaphor survives even
        // without a live feed, and the arc sweeps while the picker is open.
        <View style={{ alignItems: 'center', gap: space.sm }}>
          <View style={styles.shutterWrap}>
            <View style={StyleSheet.absoluteFill}>
              <CaptureGuideArc active={busy} color={theme.text} trackColor={theme.border} />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={pickLabel}
              onPress={pickImage}
              disabled={busy}
              style={[styles.webShutter, { backgroundColor: theme.bgElevated, borderColor: theme.border }, busy && { opacity: 0.6 }]}
            >
              <Icon name={mode === 'label' ? 'nutritionLabel' : mode === 'receipt' ? 'receipt' : 'scan'} size={24} color={theme.text} />
            </Pressable>
          </View>
          <Text style={[type.caption, { color: theme.textMuted }]}>
            {busy ? 'Opening picker…' : pickLabel}
          </Text>
        </View>
      )}

      {pickError ? <Text accessibilityRole="alert" style={[type.caption, { color: theme.safety }]}>{pickError}</Text> : null}

      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => router.back()} hitSlop={space.md} style={{ marginTop: space.lg }}>
        <Text style={[type.body, { color: theme.textMuted }]}>Go back</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  webWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.lg },
  webButton: {
    minHeight: MIN_TAP_TARGET,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    justifyContent: 'center',
  },
  gtinInput: {
    minHeight: MIN_TAP_TARGET,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    // Wave 1a: 17px ad-hoc input joins type.body (Table 3.1).
    fontSize: type.body.fontSize,
  },
  primary: {
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    minHeight: MIN_TAP_TARGET,
    justifyContent: 'center',
  },
  controls: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', gap: space.lg },
  // 2x2 — four pills in one row overflow both screen edges on every iPhone.
  modeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    paddingHorizontal: space.lg,
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  // §8.4: the capture-guide arc's frame — the shutter centers inside it.
  shutterWrap: { width: ARC_SIZE, height: ARC_SIZE, alignItems: 'center', justifyContent: 'center' },
  // §8.4: the web fallback's circular shutter (60pt visual inside the 104pt
  // arc frame; the whole arc frame is the press target).
  webShutter: {
    width: 60,
    height: 60,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewRow: { flexDirection: 'row', gap: space.xs, justifyContent: 'center' },
  hint: { color: 'rgba(255,255,255,0.85)', paddingVertical: space.lg },
  shutter: {
    width: 74,
    height: 74,
    borderRadius: radius.pill,
    backgroundColor: '#fff',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  close: {
    position: 'absolute',
    left: space.lg,
    width: MIN_TAP_TARGET,
    height: MIN_TAP_TARGET,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
})
