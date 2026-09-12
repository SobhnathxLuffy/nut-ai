/**
 * RFC 9562 UUIDv7 generator.
 * Time-ordered 128-bit UUID with 1ms resolution and random bits.
 * Node-pure, browser-compatible, React-Native compatible.
 */
export function generateUuidV7(timeMs: number = Date.now()): string {
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }

  // 48-bit timestamp
  bytes[0] = Math.floor(timeMs / 0x10000000000) & 0xff
  bytes[1] = Math.floor(timeMs / 0x100000000) & 0xff
  bytes[2] = Math.floor(timeMs / 0x1000000) & 0xff
  bytes[3] = Math.floor(timeMs / 0x10000) & 0xff
  bytes[4] = Math.floor(timeMs / 0x100) & 0xff
  bytes[5] = Math.floor(timeMs) & 0xff

  // 4-bit version (0111 = 7)
  bytes[6] = 0x70 | (bytes[6]! & 0x0f)

  // 2-bit variant (10xx = RFC 4122/9562)
  bytes[8] = 0x80 | (bytes[8]! & 0x3f)

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * Stable UUIDv7-shaped identity for migration/import backfills.
 *
 * The timestamp preserves UUIDv7 ordering while the namespace supplies stable
 * entropy. This is intentionally not used for new entities, which must receive
 * a randomly generated UUIDv7.
 */
export function deterministicUuidV7(timeMs: number, namespace: string): string {
  const bytes = new Uint8Array(16)
  let state = 0x811c9dc5
  const input = new TextEncoder().encode(namespace)

  for (let block = 0; block < 4; block++) {
    let hash = (state ^ block) >>> 0
    for (const byte of input) {
      hash ^= byte
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    for (let i = 0; i < 4; i++) {
      bytes[block * 4 + i] = (hash >>> (i * 8)) & 0xff
    }
    state = hash
  }

  bytes[0] = Math.floor(timeMs / 0x10000000000) & 0xff
  bytes[1] = Math.floor(timeMs / 0x100000000) & 0xff
  bytes[2] = Math.floor(timeMs / 0x1000000) & 0xff
  bytes[3] = Math.floor(timeMs / 0x10000) & 0xff
  bytes[4] = Math.floor(timeMs / 0x100) & 0xff
  bytes[5] = Math.floor(timeMs) & 0xff
  bytes[6] = 0x70 | (bytes[6]! & 0x0f)
  bytes[8] = 0x80 | (bytes[8]! & 0x3f)

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export function createSyncMetadata(timeMs: number = Date.now()): SyncMetadata {
  return {
    uuid: generateUuidV7(timeMs),
    created_at: timeMs,
    updated_at: timeMs,
    revision: 1,
    deleted_at: null,
    sync_state: 'local',
  }
}

export function isValidUuid(uuid: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)
}
import type { SyncMetadata } from './types.js'
