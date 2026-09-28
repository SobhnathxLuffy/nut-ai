import { CameraView, useCameraPermissions } from 'expo-camera'
import { router } from 'expo-router'
import { useRef, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon, type IconName } from '../src/components/Icon'
import { startBarcodeScan, startLabelScan, startReceiptScan, startScan } from '../src/scan/orchestrator'
import { setPhase } from '../src/scan/store'
import { useTheme } from '../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../src/theme/tokens'

type CameraMode = 'food' | 'barcode' | 'label' | 'receipt'

const MODES: Array<{ id: CameraMode; label: string; icon: IconName }> = [
  { id: 'food', label: 'Scan food', icon: 'scan' },
  { id: 'barcode', label: 'Barcode', icon: 'barcode' },
  { id: 'label', label: 'Label', icon: 'nutritionLabel' },
  { id: 'receipt', label: 'Receipt', icon: 'receipt' },
]

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
    try {
      const shot = await cameraRef.current?.takePictureAsync({ quality: 1, skipProcessing: false })
      if (!shot?.uri) return

      // The draft exists from this moment. Everything after can fail safely.
      setPhase({ kind: 'captured', photoUri: shot.uri })

      // Navigate NOW. Preprocessing, the model call and the pipeline all run
      // behind the result screen's progress states — the user never stares at
      // a frozen viewfinder wondering whether the shutter worked.
      router.replace('/result')
      if (mode === 'label') void startLabelScan(shot.uri)
      else if (mode === 'receipt') void startReceiptScan(shot.uri)
      else void startScan(shot.uri)
    } finally {
      setBusy(false)
    }
  }

  function onBarcode(data: string) {
    if (barcodeFired.current || !data) return
    barcodeFired.current = true
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
        <Text style={{ color: '#fff', fontSize: 22 }}>×</Text>
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

  async function pickImage() {
    if (busy) return
    setBusy(true)
    try {
      const ImagePicker = require('expo-image-picker')
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        base64: false,
      })
      if (!result.canceled && result.assets[0]) {
        const uri = result.assets[0].uri as string
        setPhase({ kind: 'captured', photoUri: uri })
        router.replace('/result')
        if (mode === 'label') void startLabelScan(uri)
        else if (mode === 'receipt') void startReceiptScan(uri)
        else void startScan(uri)
      }
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
    fontSize: 17,
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
