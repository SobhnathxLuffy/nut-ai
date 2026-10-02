/**
 * P2-6 (QA report Cycle 2): best-effort local-file deletion for the scan path.
 *
 * expo-file-system v57 DEPRECATES the legacy top-level methods — the root
 * `deleteAsync` console-warns AND throws (the old `.catch(() => {})` at both
 * scan call sites silently deleted NOTHING on native while polluting the only
 * diagnostics surface developers have). The modern API is the `File` class:
 * `delete()` is synchronous and throws when the file is missing, so the old
 * `{ idempotent: true }` contract becomes an `exists` guard.
 *
 * The `file:` prefix is the platform gate: only native captures and the
 * ImageManipulator temp file are real filesystem paths — web photo URIs are
 * blob:/data: URLs the FS module cannot (and must not try to) delete, and the
 * module's web shim only warns. The dynamic import stays so the scan hot path
 * never loads the native FS module until a photo actually has to go.
 */
export async function deleteLocalFile(uri: string): Promise<void> {
  if (!uri.startsWith('file:')) return
  try {
    const { File } = await import('expo-file-system')
    const file = new File(uri)
    // The modern delete() throws on a missing file — exists() first is the
    // old idempotent contract.
    if (file.exists) file.delete()
  } catch {
    // Cleanup must never take the scan down with it — the same contract the
    // old `.catch(() => {})` carried.
  }
}
