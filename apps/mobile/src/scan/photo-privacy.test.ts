import { describe, expect, it, vi, beforeEach } from 'vitest'
import { preprocess, startScan } from './orchestrator'
import { reset } from './store'
import { stripJpegMetadataBase64 } from './jpeg-privacy'
import * as ImageManipulator from 'expo-image-manipulator'
import * as FileSystem from 'expo-file-system'

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

vi.mock('expo-file-system', () => ({
  deleteAsync: vi.fn(() => Promise.resolve()),
}))

// Mock API call to prevent real network requests
vi.mock('../data/repo', () => ({
  setting: vi.fn().mockResolvedValue('test-provider'),
}))

vi.mock('../inference/credentials', () => ({
  loadCredential: vi.fn().mockResolvedValue('test-key'),
}))

vi.mock('../inference/pathA/client', () => ({
  runScanWithFallback: vi.fn().mockResolvedValue({ ok: false, error: { message: 'Mock failed' } }),
}))

describe('AIP-002: Photo Privacy & Preprocessing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
  })

  it('resizes image to 1024 width and re-encodes to JPEG without EXIF', async () => {
    // Calling startScan to trigger preprocess()
    await startScan('file:///tmp/raw-camera-photo.jpg')
    
    // 1. Verify manipulate was called on the raw photo
    expect(ImageManipulator.ImageManipulator.manipulate).toHaveBeenCalledWith('file:///tmp/raw-camera-photo.jpg')
    
    const ctx = vi.mocked(ImageManipulator.ImageManipulator.manipulate).mock.results[0]!.value
    
    // 2. Verify deterministic resize bounds
    expect(ctx.resize).toHaveBeenCalledWith({ width: 1024 })
    
    // 3. Verify re-encoding to JPEG. Explicit byte-level stripping after this
    // call is tested separately below; ImageManipulator behavior is not assumed.
    const image = await ctx.renderAsync()
    expect(image.saveAsync).toHaveBeenCalledWith({
      compress: 0.8,
      format: 'jpeg',
      base64: true
    })
  })

  it('removes EXIF/GPS, XMP/application, and comment segments explicitly', () => {
    const metadata = new TextEncoder().encode('Exif\0\0GPSLatitude=12.9;GPSLongitude=77.6')
    const segmentLength = metadata.length + 2
    const input = Uint8Array.from([
      0xff, 0xd8,
      0xff, 0xe0, 0x00, 0x04, 0x00, 0x01,
      0xff, 0xe1, segmentLength >> 8, segmentLength & 0xff, ...metadata,
      0xff, 0xfe, 0x00, 0x05, 0x47, 0x50, 0x53,
      0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9,
    ])
    const encoded = Buffer.from(input).toString('base64')
    const output = Buffer.from(stripJpegMetadataBase64(encoded), 'base64')
    expect(output.includes(Buffer.from('Exif'))).toBe(false)
    expect(output.includes(Buffer.from('GPSLatitude'))).toBe(false)
    expect([...output]).toEqual([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x01,
      0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9,
    ])
  })

  it('returns only the explicitly sanitized payload from preprocessing', async () => {
    await expect(preprocess('file:///tmp/raw-camera-photo.jpg')).resolves.toBe('/9j/2Q==')
  })

  it('cleans up temporary processed file immediately after extracting base64 payload', async () => {
    await startScan('file:///tmp/raw-camera-photo.jpg')
    
    // The orchestrator creates a temporary resized file, we must delete it
    // since we only needed the base64 string
    await new Promise(r => setTimeout(r, 0)) // wait for async FileSystem.deleteAsync
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file:///tmp/cache/fake.jpg', { idempotent: true })
  })
})
