import { router } from 'expo-router'
import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { BackupPayload } from '../../src/data/backup-core'
import { describeBackup } from '../../src/data/backup-core'
import { finishRestore, importBackup, pickBackupFile } from '../../src/data/backup'
import { Icon } from '../../src/components/Icon'
import { useTheme } from '../../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../../src/theme/tokens'
import { confirmDialog } from '../../src/ui/alert-web'

/**
 * Restore from a backup — the escape hatch from re-doing onboarding on a new
 * phone. Deliberately NOT built on the onboarding step chrome: this is not a
 * step in the flow, and a near-empty progress bar here would be a lie.
 *
 * The one thing a restore cannot bring back is the API key: keys live in the
 * Keychain and never travel inside export files, on purpose. The screen says
 * so before the user commits.
 */
export default function RestoreScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [payload, setPayload] = useState<BackupPayload | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function pick() {
    setError(null)
    const res = await pickBackupFile()
    if (!res.ok) {
      if (res.reason === 'cancelled') return
      setError(
        res.reason === 'bad-json'
          ? 'That file could not be read as JSON.'
          : "That doesn't look like a Nut AI backup file.",
      )
      return
    }
    setPayload(res.payload)
  }

  function confirmRestore() {
    if (!payload || busy) return
    // UI/UX report §10.1 rule two (Wave 1b): a restore REPLACES device data
    // and cannot be undone — this stays a destructive confirmation, now via
    // the ONE shared helper (native OS dialog / styled web dialog).
    confirmDialog({
      title: 'Restore this backup?',
      message: 'This replaces any data currently on this device and cannot be undone.',
      confirmLabel: 'Restore',
      destructive: true,
      onConfirm: () => {
        void (async () => {
          setBusy(true)
          try {
            const outcome = await importBackup(payload)
            if (!outcome.ok) {
              setError('This backup was made with a newer version of Nut AI — update the app first.')
              return
            }
            await finishRestore()
            router.replace('/(tabs)' as never)
          } catch (e) {
            // Rolled back; nothing was changed. Say so, never fail silently.
            setError(`Restore failed and nothing was changed: ${String((e as Error)?.message ?? e)}`)
          } finally {
            setBusy(false)
          }
        })()
      },
    })
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.bg, paddingTop: insets.top + space.xl }]}>
      {/* Wave 1a: header-scale 30px override removed — type.title (28/32)
          is the one header voice (UI/UX report Table 3.1). */}
      <Text style={[type.title, { color: theme.text }]}>Restore from a backup</Text>
      <Text style={[type.body, { color: theme.textMuted, marginTop: space.sm, lineHeight: 22 }]}>
        Pick a Nut AI export file — everything comes back exactly as it was: meals, weights,
        goals, settings.
      </Text>

      {payload ? (
        <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Icon name="check" size={18} color={theme.affirm} weight={2.4} />
            <Text style={[type.bodyStrong, { color: theme.text }]}>Backup found</Text>
          </View>
          <Text style={[type.body, { color: theme.textMuted, marginTop: space.sm }]}>
            {describeBackup(payload)}
          </Text>
          <Text style={[type.caption, { color: theme.textFaint, marginTop: space.xs }]}>
            Exported {new Date(payload.exported_at).toLocaleDateString()}
          </Text>
        </View>
      ) : (
        <Pressable onPress={pick} style={[styles.pickCard, { borderColor: theme.border }]}>
          <Icon name="plus" size={22} color={theme.textMuted} />
          <Text style={[type.bodyStrong, { color: theme.text }]}>Choose backup file</Text>
          <Text style={[type.caption, { color: theme.textFaint }]}>nutai-backup-….json</Text>
        </Pressable>
      )}

      {error ? (
        <View style={[styles.card, { backgroundColor: theme.safetyBg }]}>
          <Text style={[type.caption, { color: theme.safety, lineHeight: 19 }]}>{error}</Text>
        </View>
      ) : null}

      <View style={[styles.card, { backgroundColor: theme.uncertainBg }]}>
        <Text style={[type.caption, { color: theme.text, lineHeight: 19 }]}>
          One thing never travels in a backup: your API key. Keys stay in the device Keychain, so
          after restoring you will re-enter it once in Profile.
        </Text>
      </View>

      <View style={{ flex: 1 }} />

      {busy ? <ActivityIndicator color={theme.textMuted} style={{ marginBottom: space.lg }} /> : null}

      <Pressable
        accessibilityRole="button"
        disabled={!payload || busy}
        onPress={confirmRestore}
        style={[
          styles.cta,
          { backgroundColor: theme.text, marginBottom: space.md },
          (!payload || busy) && { opacity: 0.4 },
        ]}
      >
        <Text style={[type.bodyStrong, { color: theme.bg }]}>
          {busy ? 'Restoring…' : 'Restore'}
        </Text>
      </Pressable>
      <Pressable
        onPress={() => (payload ? setPayload(null) : router.back())}
        hitSlop={space.md}
        style={{ alignSelf: 'center', marginBottom: Math.max(insets.bottom, space.lg) }}
      >
        <Text style={[type.body, { color: theme.textMuted }]}>
          {payload ? 'Choose a different file' : 'Back'}
        </Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: space.lg },
  card: { marginTop: space.lg, padding: space.lg, borderRadius: radius.lg },
  pickCard: {
    marginTop: space.xl,
    alignItems: 'center',
    gap: space.sm,
    padding: space.xl,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  cta: {
    height: 60,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
  },
})
