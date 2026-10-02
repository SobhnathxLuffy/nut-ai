import { CameraView, useCameraPermissions } from 'expo-camera'
import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon, type IconName } from '../src/components/Icon'
import { startBarcodeScan, startLabelScan, startReceiptScan, startScan } from '../src/scan/orchestrator'
import { setPhase, setScanReviewMode, type ScanReviewMode } from '../src/scan/store'
import { setting, putSetting } from '../src/data/repo'
import { useTheme } from '../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../src/theme/tokens'

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
  return (
    <View style={styles.reviewRow} accessibilityRole="radiogroup" accessibilityLabel="Review mode">
      {(['quick', 'advanced'] as const).map((m) => {
        const active = value === m
        return (
          <Pressable
            key={m}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={m === 'quick' ? 'Quick review' : 'Advanced review'}
            onPress={() => onChange(m)}
            style={[
              styles.reviewPill,
              active && styles.reviewPillActive,
              !onDark && { backgroundColor: 'rgba(0,0,0,0.06)' },
            ]}
          >
            <Text style={[type.label, { color: active ? '#000' : onDark ? '#fff' : '#000' }]}>
              {m === 'quick' ? 'Quick' : 'Advanced'}
            </Text>
          </Pressable>
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
          {MODES.map((m) => {
            const active = mode === m.id
            return (
              <Pressable
                key={m.id}
                accessibilityRole="button"
                accessibilityLabel={m.label}
                onPress={() => {
                  barcodeFired.current = false
                  setMode(m.id)
                }}
                style={[styles.modePill, active && styles.modePillActive]}
              >
                <Icon name={m.icon} size={18} color={active ? '#000' : '#fff'} />
                <Text style={[type.label, { color: active ? '#000' : '#fff' }]}>{m.label}</Text>
              </Pressable>
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Take photo"
            onPress={capture}
            disabled={busy}
            style={[styles.shutter, busy && { opacity: 0.5 }]}
          />
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
        {MODES.map((m) => {
          const active = mode === m.id
          return (
            <Pressable
              key={m.id}
              accessibilityRole="button"
              accessibilityLabel={m.label}
              accessibilityState={{ selected: active }}
              onPress={() => { setGtinError(''); setMode(m.id) }}
              style={[styles.modePill, active && styles.modePillActive, { backgroundColor: active ? theme.text : theme.bgSunken, borderColor: theme.border }]}
            >
              <Icon name={m.icon} size={18} color={active ? theme.bg : theme.text} />
              <Text style={[type.label, { color: active ? theme.bg : theme.text }]}>{m.label}</Text>
            </Pressable>
          )
        })}
      </View>

      <ReviewModeToggle value={reviewPref} onChange={setReviewPref} onDark={false} />

      {mode === 'barcode' ? (
        <View style={{ width: '100%', maxWidth: 420, gap: space.sm }}>
          <TextInput
            accessibilityLabel="Barcode number (GTIN)"
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={mode === 'label' ? 'Pick a nutrition label photo' : mode === 'receipt' ? 'Pick a receipt photo' : 'Pick a food photo'}
          onPress={pickImage}
          disabled={busy}
          style={[styles.webButton, { backgroundColor: theme.text, opacity: busy ? 0.5 : 1 }]}
        >
          <Text style={[type.bodyStrong, { color: theme.bg }]}>
            {busy ? 'Opening picker…' : mode === 'label' ? 'Pick a label photo' : mode === 'receipt' ? 'Pick a receipt photo' : 'Pick a food photo'}
          </Text>
        </Pressable>
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
  modePill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    width: '47%',
    paddingVertical: space.sm,
    borderRadius: radius.md,
    backgroundColor: 'rgba(0,0,0,0.45)',
    minHeight: MIN_TAP_TARGET,
  },
  modePillActive: { backgroundColor: '#fff' },
  reviewRow: { flexDirection: 'row', gap: space.xs, justifyContent: 'center' },
  reviewPill: {
    paddingHorizontal: space.lg,
    paddingVertical: space.xs + 2,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.45)',
    minHeight: 44,
    justifyContent: 'center',
  },
  reviewPillActive: { backgroundColor: '#fff' },
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
