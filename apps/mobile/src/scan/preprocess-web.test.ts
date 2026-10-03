import { describe, expect, it, vi, beforeEach } from 'vitest'
import { preprocess } from './orchestrator'
import * as ImageManipulator from 'expo-image-manipulator'

/**
 * O11 (QA report Cycle 2): a web-shaped `blob:` photo URI flows through the
 * preprocess stage exactly like a file URI.
 *
 * Reachability first (verified, not assumed): on web the camera screen's pick
 * path hands the picker asset's `uri` STRAIGHT to startScan/startLabelScan/
 * startReceiptScan (app/camera.tsx WebCameraFallback.pickImage →
 * result.assets[0].uri), and expo-image-picker's web implementation produces
 * that uri with `URL.createObjectURL(targetFile)` — a `blob:` URL. Nothing
 * guards the scheme between the picker and preprocess(); the only
 * scheme-sensitive step in the chain is deleteLocalFile (file-cleanup.ts),
 * which correctly SKIPS non-file URIs. So a blob: URI genuinely reaches
 * ImageManipulator.manipulate(photoUri) on the web build, and this pins that
 * it is handled like any other URI: no throw, verbatim pass-through, and the
 * same sanitized-base64 + temp-file-cleanup output shape the file:// path
 * produces (photo-privacy.test.ts's contract).
 */

vi.mock('expo-image-manipulator', () => {
  const saveAsync = vi.fn().mockResolvedValue({ base64: '/9j/2Q==', uri: 'file:///tmp/cache/fake.jpg' })
  const renderAsync = vi.fn().mockResolvedValue({ saveAsync })
  const resize = vi.fn()
  const manipulate = vi.fn().mockReturnValue({ resize, renderAsync })
  return {
    ImageManipulator: { manipulate },
    SaveFormat: { JPEG: 'jpeg' }
  }
})

vi.mock("../db/expo-adapter", () => ({
  openIfctDb: vi.fn().mockResolvedValue({}),
  openNutritionDb: vi.fn().mockResolvedValue({})
}))

vi.mock("../db/portions", () => ({
  loadFoodDb: vi.fn().mockResolvedValue({})
}))

// P2-6: preprocess() cleans up its temp file through the modern File class
// (photo-privacy.test.ts's mock, verbatim).
const fsState = vi.hoisted(() => ({ deleted: [] as string[] }))
vi.mock('expo-file-system', () => ({
  File: class {
    uri: string
    exists = true
    constructor(uri: string) {
      this.uri = uri
    }
    delete() {
      fsState.deleted.push(this.uri)
    }
  },
}))

vi.mock('../data/repo', () => ({
  setting: vi.fn().mockResolvedValue('test-provider'),
  customProviderBaseUrl: vi.fn().mockResolvedValue(null),
}))

vi.mock('../inference/credentials', () => ({
  loadCredential: vi.fn().mockResolvedValue('test-key'),
}))

vi.mock('../inference/pathA/client', () => ({
  runScanWithFallback: vi.fn().mockResolvedValue({ ok: false, error: { message: 'Mock failed' } }),
}))

/** A web picker URI exactly as expo-image-picker mints it on web. */
const BLOB_URI = 'blob:http://127.0.0.1:3000/6a11b2c3-9f8e-4d7c-b5a4-3210fedcba98'

describe('O11: web blob: photo URIs through preprocess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsState.deleted.length = 0
  })

  it('a blob: URI resolves to the sanitized payload — no throw, same output as a file URI', async () => {
    const viaBlob = await preprocess(BLOB_URI)
    const viaFile = await preprocess('file:///tmp/raw-camera-photo.jpg')
    // Identical output shape: both are the explicitly sanitized base64 payload
    // (the mocked ImageManipulator re-encode is deterministic by construction,
    // so equality here pins the pipeline shape, not the encoder).
    expect(viaBlob).toBe('/9j/2Q==')
    expect(viaFile).toBe(viaBlob)
  })

  it('passes the blob: URI to ImageManipulator VERBATIM — no scheme rewrite, no rejection', async () => {
    await preprocess(BLOB_URI)
    expect(ImageManipulator.ImageManipulator.manipulate).toHaveBeenCalledWith(BLOB_URI)
  })

  it('runs the identical resize + JPEG re-encode + metadata-strip chain for blob: input', async () => {
    await preprocess(BLOB_URI)

    const ctx = vi.mocked(ImageManipulator.ImageManipulator.manipulate).mock.results[0]!.value
    expect(ctx.resize).toHaveBeenCalledWith({ width: 1024 })
    const image = await ctx.renderAsync()
    expect(image.saveAsync).toHaveBeenCalledWith({
      compress: 0.8,
      format: 'jpeg',
      base64: true
    })
  })

  it('cleans up the resized temp file (the file: OUTPUT of ImageManipulator), never the blob: input', async () => {
    await preprocess(BLOB_URI)
    // The deleteLocalFile file:-prefix gate: the blob: INPUT is skipped (it is
    // the browser's object URL, not an FS path); the resize OUTPUT is deleted.
    await new Promise(r => setTimeout(r, 0)) // wait for the async dynamic FS import
    expect(fsState.deleted).toEqual(['file:///tmp/cache/fake.jpg'])
    expect(fsState.deleted).not.toContain(BLOB_URI)
  })
})
