/**
 * The toast store — UI/UX Transformation Report §10.1 (Wave 1b).
 *
 * "One toast system, two rules: toasts confirm success and offer the next
 * action; they never ask questions. Alerts are reserved for destructive or
 * irreversible confirmations."
 *
 * This module is the state half of the sonner-native pattern the report
 * prescribes: a queued, top-anchored, swipe-dismissable toast with ONE visible
 * at a time and ~4s auto-dismiss. It is deliberately free of React and
 * react-native imports (same discipline as src/data/food-mutations.ts) so the
 * queue semantics, timers and action dispatch are unit-testable under the
 * plain-Node vitest environment — the visual half lives in Toast.tsx.
 *
 * The store owns the auto-dismiss timer (not the host component) for exactly
 * that reason: fake-timer tests can prove the 4s firing without rendering.
 */

export interface ToastAction {
  /** Short verb, e.g. "Undo", "Retry", "Open Train". Never a question. */
  label: string
  onPress: () => void
}

export type ToastTone = 'default' | 'success' | 'error'

export interface ToastOptions {
  message: string
  /** Optional next step (report §10.1: "meal logged with an Undo action"). */
  action?: ToastAction
  tone?: ToastTone
  /** Override the tone default. Call sites should rarely need this. */
  durationMs?: number
}

/** Normalised entry — every field resolved at enqueue time. */
export interface ToastEntry {
  message: string
  action?: ToastAction
  tone: ToastTone
  durationMs: number
}

/** What the host component subscribes to. `seq` changes on every transition. */
export interface ToastSnapshot {
  current: ToastEntry | null
  seq: number
}

/** ~4s per the report; error toasts get double the reading window. */
export const TOAST_DURATION_MS = 4_000
export const TOAST_ERROR_DURATION_MS = 8_000

type Listener = (snapshot: ToastSnapshot) => void

const listeners = new Set<Listener>()
const queue: ToastEntry[] = []
let current: ToastEntry | null = null
let seq = 0
let timer: ReturnType<typeof setTimeout> | null = null

function snapshot(): ToastSnapshot {
  return { current, seq }
}

function notify(): void {
  for (const listener of listeners) listener(snapshot())
}

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
}

/** Show the next queued toast. Only ever called with `current === null`. */
function advance(): void {
  if (current) return
  const next = queue.shift()
  if (!next) {
    seq++
    notify()
    return
  }
  current = next
  seq++
  timer = setTimeout(() => {
    timer = null
    dismissToast()
  }, current.durationMs)
  notify()
}

/**
 * Enqueue a toast. If none is visible it shows immediately; otherwise it waits
 * — one visible at a time, in arrival order.
 */
export function showToast(options: ToastOptions): void {
  const tone = options.tone ?? 'default'
  queue.push({
    message: options.message,
    action: options.action,
    tone,
    durationMs: options.durationMs ?? (tone === 'error' ? TOAST_ERROR_DURATION_MS : TOAST_DURATION_MS),
  })
  if (!current) advance()
}

/** Dismiss the visible toast (swipe, action, timeout — all funnel here). */
export function dismissToast(): void {
  if (!current && queue.length === 0) {
    seq++
    notify()
    return
  }
  clearTimer()
  current = null
  // Advances to the next queued toast, or notifies the empty state.
  advance()
}

/**
 * Fire the visible toast's action, then dismiss. The action runs AFTER the
 * dismissal so an onPress that enqueues its own confirmation toast ("Meal
 * restored") queues behind whatever was already waiting, never replaces it.
 */
export function pressToastAction(): void {
  const action = current?.action
  if (!action) return
  dismissToast()
  action.onPress()
}

export function subscribeToast(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getToastSnapshot(): ToastSnapshot {
  return snapshot()
}

/** Test-only: isolated state per case (module state survives across tests). */
export function __resetToastStoreForTests(): void {
  clearTimer()
  queue.length = 0
  current = null
  seq++
  notify()
}
