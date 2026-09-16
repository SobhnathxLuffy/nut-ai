const SOI = [0xff, 0xd8]

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value.replace(/\s+/g, ''))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  // Chunking avoids exceeding the argument/string limits on full-size photos.
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function isStandalone(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)
}

/**
 * Remove EXIF/XMP and other application metadata from an already re-encoded
 * JPEG. APP0/JFIF is retained; APP1–APP15 and comment segments are removed.
 * The compressed scan is copied byte-for-byte, so this adds no image loss.
 */
export function stripJpegMetadataBase64(base64: string): string {
  const bytes = decodeBase64(base64)
  if (bytes[0] !== SOI[0] || bytes[1] !== SOI[1]) throw new Error('Sanitized photo is not a JPEG')
  const output: number[] = [...SOI]
  let offset = 2
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) throw new Error('Malformed JPEG marker stream')
    const markerStart = offset
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset]
    if (marker === undefined) throw new Error('Truncated JPEG marker')
    offset++
    if (marker === 0xda) {
      output.push(...bytes.subarray(markerStart))
      offset = bytes.length
      break
    }
    if (isStandalone(marker)) {
      output.push(...bytes.subarray(markerStart, offset))
      if (marker === 0xd9) break
      continue
    }
    if (offset + 1 >= bytes.length) throw new Error('Truncated JPEG segment length')
    const length = bytes[offset]! * 256 + bytes[offset + 1]!
    if (length < 2 || offset + length > bytes.length) throw new Error('Invalid JPEG segment length')
    const segmentEnd = offset + length
    const privateMetadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe
    if (!privateMetadata) output.push(...bytes.subarray(markerStart, segmentEnd))
    offset = segmentEnd
  }
  const sanitized = Uint8Array.from(output)
  assertNoJpegPrivateMetadata(sanitized)
  return encodeBase64(sanitized)
}

export function assertNoJpegPrivateMetadata(bytes: Uint8Array): void {
  if (bytes[0] !== SOI[0] || bytes[1] !== SOI[1]) throw new Error('Photo payload is not JPEG')
  let offset = 2
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) throw new Error('Malformed sanitized JPEG')
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset]
    if (marker === undefined) throw new Error('Truncated sanitized JPEG')
    offset++
    if ((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe) {
      throw new Error('JPEG still contains private metadata')
    }
    if (marker === 0xda || marker === 0xd9) return
    if (isStandalone(marker)) continue
    if (offset + 1 >= bytes.length) throw new Error('Truncated sanitized JPEG segment')
    const length = bytes[offset]! * 256 + bytes[offset + 1]!
    if (length < 2 || offset + length > bytes.length) throw new Error('Invalid sanitized JPEG segment')
    offset += length
  }
}
