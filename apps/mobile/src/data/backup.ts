import { Platform } from 'react-native';
import Constants from 'expo-constants'
import * as DocumentPicker from 'expo-document-picker'
import * as Sharing from 'expo-sharing'
import Storage from 'expo-sqlite/kv-store'
import { currentVersion } from '@nutai/db-adapter'
import { ONBOARDING_DONE_KEY } from '../onboarding/done-key'
import { db } from './repo'
import {
  buildBackupPayload,
  importBackupPayload,
  parseBackup,
  serializeBackup,
  type BackupPayload,
  type ImportOutcome,
  type ParseFailure,
} from './backup-core'

// We require expo-file-system only if not on web, as it crashes the web bundler
const { Directory, File, Paths } = Platform.OS === 'web' 
  ? { Directory: null, File: null, Paths: null } 
  : require('expo-file-system');

function stamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
}

export interface ExportResult {
  uri: string
  name: string
  shared: boolean
}

export async function exportAndShareBackup(): Promise<ExportResult> {
  const h = await db()
  const payload = await buildBackupPayload(h, {
    schemaVersion: await currentVersion(h),
    appVersion: Constants.expoConfig?.version ?? 'unknown',
    now: Date.now(),
  })
  const json = serializeBackup(payload)
  const name = `nutai-backup-${stamp(new Date())}.json`

  if (Platform.OS === 'web') {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    return { uri: '', name, shared: true }
  }

  const dir = new Directory(Paths.cache, 'backups')
  dir.create({ intermediates: true, idempotent: true })
  const file = new File(dir, name)
  file.create({ overwrite: true })
  file.write(json)

  let shared = false
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      UTI: 'public.json',
      dialogTitle: 'Export Nut AI data',
    })
    shared = true
  }
  return { uri: file.uri, name, shared }
}

export type PickOutcome =
  | { ok: true; payload: BackupPayload }
  | { ok: false; reason: ParseFailure | 'cancelled' }

export async function pickBackupFile(): Promise<PickOutcome> {
  const res = await DocumentPicker.getDocumentAsync({
    type: 'application/json',
    copyToCacheDirectory: true,
    multiple: false,
  })
  if (res.canceled || !res.assets?.[0]) return { ok: false, reason: 'cancelled' }

  let raw = '';
  if (Platform.OS === 'web') {
    // on web res.assets[0].uri is a Blob URI or we use fetch
    const response = await fetch(res.assets[0].uri);
    raw = await response.text();
  } else {
    raw = await new File(res.assets[0].uri).text()
  }
  const parsed = parseBackup(raw)
  if (!parsed.ok) return { ok: false, reason: parsed.reason }
  return { ok: true, payload: parsed.payload }
}

export async function importBackup(payload: BackupPayload): Promise<ImportOutcome> {
  const h = await db()
  return importBackupPayload(h, payload, await currentVersion(h))
}

export async function finishRestore(): Promise<void> {
  await Storage.setItem(ONBOARDING_DONE_KEY, 'true')
}
