import { router } from 'expo-router'
import { useState } from 'react'
import { Text, View } from 'react-native'
import { exportAndShareBackup, finishRestore, importBackup, pickBackupFile } from '../src/data/backup'
import { resetEverything } from '../src/data/repo'
import { ItemRow } from '../src/components/ItemRow'
import { Screen } from '../src/components/Screen'
import { showToast } from '../src/components/toast-store'
import { confirmDialog } from '../src/ui/alert-web'
import { useTheme } from '../src/theme/ThemeProvider'
import { space, type } from '../src/theme/tokens'

/**
 * Your data — UI/UX report Ch 8.8 (Wave 3) sub-page.
 *
 * Export, import and erase, MOVED from the Profile tab's old "Your data" and
 * "Start over" sections with their behaviour verbatim: the destructive
 * confirmDialog pattern stays (a restore REPLACES everything; an erase
 * cannot be undone), the failure paths still say what actually happened,
 * and the API key never travels in a backup.
 */
export default function DataSettings() {
  const theme = useTheme()
  const [dataBusy, setDataBusy] = useState(false)

  function exportData() {
    if (dataBusy) return
    setDataBusy(true)
    void (async () => {
      try {
        const res = await exportAndShareBackup()
        if (!res.shared) showToast({ message: `Exported — saved to ${res.name}.`, tone: 'success' })
      } catch {
        showToast({ message: 'Could not write the backup file. Try again.', tone: 'error' })
      } finally {
        setDataBusy(false)
      }
    })()
  }

  function importData() {
    if (dataBusy) return
    void (async () => {
      const picked = await pickBackupFile()
      if (!picked.ok) {
        if (picked.reason !== 'cancelled') {
          showToast({ message: "That doesn't look like a Nut AI backup file.", tone: 'error' })
        }
        return
      }
      // UI/UX report §10.1 rule two: a restore REPLACES all device data and
      // cannot be undone — this stays a destructive confirmation.
      confirmDialog({
        title: 'Restore this backup?',
        message: 'This replaces ALL data currently on this device and cannot be undone.',
        confirmLabel: 'Restore',
        destructive: true,
        onConfirm: () => {
          setDataBusy(true)
          void (async () => {
            try {
              const outcome = await importBackup(picked.payload)
              if (!outcome.ok) {
                showToast({
                  message: 'Cannot restore — this backup is from a newer version of Nut AI. Update the app first.',
                  tone: 'error',
                })
                return
              }
              await finishRestore()
              router.replace('/(tabs)' as never)
            } catch (e) {
              // A restore that fails must SAY SO — the transaction rolled
              // back, nothing was lost, and silence here cost us a real
              // debugging session once already.
              showToast({ message: `Nothing was changed. ${String((e as Error)?.message ?? e)}`, tone: 'error' })
            } finally {
              setDataBusy(false)
            }
          })()
        },
      })
    })()
  }

  function eraseEverything() {
    if (dataBusy) return
    // UI/UX report §10.1 rule two: erasing everything is THE destructive
    // confirmation — it stays a dialog.
    confirmDialog({
      title: 'Erase everything and start over?',
      message:
        'Deletes your profile, goals, weight history, logged meals and saved API keys from this device. It cannot be undone, and there is no backup on a server because there is no server.',
      confirmLabel: 'Erase and restart',
      destructive: true,
      onConfirm: () => {
        void resetEverything()
          .then(() => router.replace('/onboarding' as never))
          .catch((error: unknown) => {
            // A half-completed wipe must not strand the user on a
            // broken profile screen; surface it and keep them here.
            console.error('[settings-data] resetEverything failed', error)
            showToast({ message: 'Could not erase everything — nothing was changed.', tone: 'error' })
          })
      },
    })
  }

  return (
    <Screen title="Your data" back backLabel="Back to profile">
      <Text style={[type.label, { color: theme.textMuted }]}>Backup</Text>
      <View style={{ gap: space.sm }}>
        <ItemRow
          icon="arrowUp"
          label={dataBusy ? 'Working…' : 'Export data'}
          value="One JSON file with everything: meals, weights, goals, settings"
          onPress={exportData}
        />
        <ItemRow
          icon="arrowDown"
          label="Import data"
          value="Replaces everything currently on this device"
          onPress={importData}
        />
      </View>
      <Text style={[type.caption, { color: theme.textFaint, lineHeight: 18 }]}>
        Your API key never travels in a backup — re-enter that once after restoring on a new phone.
      </Text>

      <Text style={[type.label, { color: theme.textMuted, marginTop: space.md }]}>Start over</Text>
      <ItemRow
        icon="close"
        label="Erase everything and start over"
        value="Deletes every meal, weight, goal and key on this device"
        destructive
        onPress={eraseEverything}
      />
      <Text style={[type.caption, { color: theme.textFaint, lineHeight: 18 }]}>
        There is no account and no server to recover from — export first if you want a copy.
      </Text>
    </Screen>
  )
}
