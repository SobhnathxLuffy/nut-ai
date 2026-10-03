/**
 * Assistant chat message id scheme + duplicate-append guard (O7).
 *
 * The four `setMessages` append sites in app/assistant.tsx used to mint ids
 * with bare `Date.now()` — and `Date.now() + 1` for the streaming placeholder.
 * Two appends inside the same millisecond (the no-provider error right behind
 * the user message is the realistic case: both run synchronously after send)
 * produced TWO messages with the SAME id — one React key collision, two
 * proposal cards sharing one status, and a transcript that could dedupe the
 * wrong bubble. Ids are opaque strings everywhere (nothing parses them — the
 * history-restore lane mints `h_${i}` ids), so the fix is one shared scheme:
 *
 *   1. `createMessageIdFactory` — ids are plain decimal strings (same visual
 *      format as before) minted from a monotonic clock: every id is at least
 *      `last + 1`, so no two calls ever collide even when the real clock is
 *      frozen, and a clock that jumps backwards keeps increasing. Deterministic
 *      for a given clock sequence (injectable for tests).
 *   2. `appendDeduped` — the one append path. If a message with that id is
 *      already in the list, the append is a no-op that returns the ORIGINAL
 *      array reference (React skips the re-render); otherwise the message is
 *      appended at the end, order preserved. Pure: same inputs, same output.
 *
 * Pure module on purpose — no React Native, no Date.now() at import time — so
 * the node vitest suite locks the behavior directly, and a source-inspection
 * test locks that every append site in the screen routes through here.
 */

/** Anything the assistant transcript stores — ids are the only contract. */
export interface MessageLike {
  id: string
}

/**
 * Append `msg` to `prev` unless a message with the same id is already present.
 * The existing message always wins — a duplicate append is a bug in the caller
 * (a double-fired handler, a re-run effect), and dropping the NEW copy keeps
 * the first-rendered bubble's state (streaming position, proposal status).
 */
export function appendDeduped<T extends MessageLike>(prev: T[], msg: T): T[] {
  for (const m of prev) {
    if (m.id === msg.id) return prev
  }
  return [...prev, msg]
}

/** Time source for the id factory; injectable so tests are deterministic. */
export type Clock = () => number

/**
 * Monotonic message-id mint. Ids stay plain decimal strings (the format the
 * screen has always used): `Math.max(now, last + 1)` guarantees uniqueness
 * under a frozen clock and strict increase under a backwards-jumping clock.
 */
export function createMessageIdFactory(clock: Clock = Date.now): () => string {
  let last = 0
  return () => {
    const now = clock()
    last = now > last ? now : last + 1
    return String(last)
  }
}
