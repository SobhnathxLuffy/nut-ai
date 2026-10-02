/**
 * WEB-001 fix: Alert.alert is a silent no-op on react-native-web.
 *
 * Every confirm-style dialog in the app (redo onboarding, delete meal, save
 * routine, restore backup, ...) goes through Alert.alert. On native that is a
 * real OS dialog; on web it used to resolve nothing, so the primary action
 * behind the dialog never fired — the reported "Redo onboarding does nothing"
 * bug and 28 sibling dead dialogs.
 *
 * This module patches Alert.alert on web with a real DOM dialog that matches
 * the app's design tokens (src/theme/tokens.ts palette) and honours the same
 * button contract — text / style ('default' | 'cancel' | 'destructive') /
 * onPress — including triggering the `cancel` button on Escape and backdrop
 * press. Alerts fired while one is visible are queued, matching the serial
 * behaviour users expect from native dialogs.
 *
 * No-op on native: native keeps the platform dialog untouched.
 *
 * UI/UX report §10.1 / Table 12.2 (Wave 1b): the alert/confirm family merges
 * onto TWO primitives — toasts (src/components/toast-store.ts + Toast.tsx) for
 * reversible outcomes, and ONE confirm helper for destructive/irreversible
 * actions. That helper is `confirmDialog` below: it is the only sanctioned way
 * to ask for a confirmation. It routes through Alert.alert, so native keeps
 * the OS dialog and web gets this styled shim — one code path, two platform
 * renderers. Screens import it from this module, which the app root already
 * loads before any screen (see app/_layout.tsx).
 */

import { Alert, Platform } from 'react-native'
import { type as typeScale } from '../theme/tokens'

interface ShimButton {
  text: string
  style?: 'default' | 'cancel' | 'destructive'
  onPress?: () => void
}

// Palette mirrors src/theme/tokens.ts — same hexes, duplicated here because
// this patch must run at module-eval time before the theme's React machinery
// mounts, and the tokens file is not meant to be imported outside the app.
// Wave 1a: the TYPE values, however, are pure data with no React machinery —
// the dialog now sizes itself from the canonical scale (UI/UX report Table 3.1)
// instead of 17px/13.5px/16px ad-hoc strings, so web dialogs cannot drift from
// the native type system.
const PALETTE = {
  light: {
    backdrop: 'rgba(11, 11, 15, 0.45)',
    card: '#FFFFFF',
    title: '#0B0B0F',
    message: '#3A3A46',
    separator: '#EFEFF3',
    defaultText: '#3E7BFA',
    cancelText: '#5C5C6B',
    destructiveText: '#D5453B',
    shadow: '0 24px 48px rgba(11, 11, 15, 0.28)',
  },
  dark: {
    backdrop: 'rgba(0, 0, 0, 0.6)',
    card: '#22222B',
    title: '#F7F7FA',
    message: '#B8B8C4',
    separator: '#3A3A46',
    defaultText: '#7FA5FF',
    cancelText: '#8A8A99',
    destructiveText: '#FF7A70',
    shadow: '0 24px 48px rgba(0, 0, 0, 0.6)',
  },
} as const

type Scheme = keyof typeof PALETTE

function currentScheme(): Scheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const queue: Array<{ title?: string; message?: string; buttons?: ShimButton[] }> = []
let dialogOpen = false

function presentNext(): void {
  const next = queue.shift()
  if (!next) return
  present(next.title, next.message, next.buttons ?? [])
}

function present(title?: string, message?: string, buttons: ShimButton[] = []): void {
  if (typeof document === 'undefined') return
  dialogOpen = true

  const scheme = PALETTE[currentScheme()]
  const reduced = prefersReducedMotion()

  const backdrop = document.createElement('div')
  backdrop.setAttribute('role', 'presentation')
  Object.assign(backdrop.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483000',
    background: scheme.backdrop,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    opacity: reduced ? '1' : '0',
    transition: reduced ? 'none' : 'opacity 140ms ease-out',
  } as Partial<CSSStyleDeclaration>)

  const card = document.createElement('div')
  card.setAttribute('role', 'alertdialog')
  card.setAttribute('aria-modal', 'true')
  if (title) card.setAttribute('aria-label', title)
  Object.assign(card.style, {
    background: scheme.card,
    color: scheme.title,
    borderRadius: '18px',
    maxWidth: '340px',
    width: '100%',
    overflow: 'hidden',
    boxShadow: scheme.shadow,
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    transform: reduced ? 'scale(1)' : 'scale(0.94)',
    transition: reduced ? 'none' : 'transform 140ms ease-out',
  } as Partial<CSSStyleDeclaration>)

  const body = document.createElement('div')
  Object.assign(body.style, {
    padding: '22px 20px 18px',
    textAlign: 'center',
  } as Partial<CSSStyleDeclaration>)

  if (title) {
    const titleEl = document.createElement('div')
    titleEl.textContent = title
    Object.assign(titleEl.style, {
      fontSize: `${typeScale.bodyStrong.fontSize}px`,
      fontWeight: '600',
      lineHeight: '1.3',
      marginBottom: message ? '8px' : '0',
    } as Partial<CSSStyleDeclaration>)
    body.appendChild(titleEl)
  }

  if (message) {
    const msgEl = document.createElement('div')
    msgEl.textContent = message
    Object.assign(msgEl.style, {
      fontSize: `${typeScale.caption.fontSize}px`,
      lineHeight: '1.45',
      color: scheme.message,
      whiteSpace: 'pre-line',
    } as Partial<CSSStyleDeclaration>)
    body.appendChild(msgEl)
  }

  card.appendChild(body)

  const separator = document.createElement('div')
  Object.assign(separator.style, {
    height: '1px',
    background: scheme.separator,
  } as Partial<CSSStyleDeclaration>)
  card.appendChild(separator)

  function close(after?: () => void): void {
    document.removeEventListener('keydown', onKey, true)
    if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop)
    dialogOpen = false
    // Fire after unmount so a dialog can be opened from inside onPress.
    if (after) after()
    presentNext()
  }

  function cancelButton(): ShimButton | undefined {
    return buttons.find((b) => b.style === 'cancel') ?? buttons[0]
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation()
      close(cancelButton()?.onPress)
    }
  }
  document.addEventListener('keydown', onKey, true)

  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) close(cancelButton()?.onPress)
  })

  const row = document.createElement('div')
  Object.assign(row.style, {
    display: 'flex',
    flexDirection: buttons.length > 2 ? 'column' : 'row',
  } as Partial<CSSStyleDeclaration>)

  const shown: ShimButton[] = buttons.length > 0 ? buttons : [{ text: 'OK', style: 'default' }]

  shown.forEach((button, index) => {
    if (index > 0) {
      const divider = document.createElement('div')
      Object.assign(divider.style, {
        background: scheme.separator,
        flexShrink: '0',
        ...(buttons.length > 2 ? { height: '1px', width: '100%' } : { width: '1px' }),
      } as Partial<CSSStyleDeclaration>)
      row.appendChild(divider)
    }

    const isDestructive = button.style === 'destructive'
    const el = document.createElement('button')
    el.type = 'button'
    el.textContent = button.text
    Object.assign(el.style, {
      appearance: 'none',
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      padding: '15px 12px',
      fontSize: `${typeScale.body.fontSize}px`,
      fontWeight: button.style === 'cancel' ? '600' : '400',
      color: isDestructive
        ? scheme.destructiveText
        : button.style === 'cancel'
          ? scheme.cancelText
          : scheme.defaultText,
      fontFamily: 'inherit',
      textAlign: 'center',
    } as Partial<CSSStyleDeclaration>)

    el.addEventListener('click', () => close(button.onPress))
    row.appendChild(el)
  })

  card.appendChild(row)
  backdrop.appendChild(card)
  document.body.appendChild(backdrop)

  if (!reduced) {
    // Double rAF so the initial styles are committed before transitioning.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        backdrop.style.opacity = '1'
        card.style.transform = 'scale(1)'
      })
    })
  }
}

function patchedAlert(title?: string, message?: string, buttons?: ShimButton[]): void {
  queue.push({ title, message, buttons })
  if (!dialogOpen) presentNext()
}

if (Platform.OS === 'web') {
  const alertHost = Alert as unknown as {
    alert: (title?: string, message?: string, buttons?: ShimButton[]) => void
  }
  alertHost.alert = patchedAlert
}

// ---------------------------------------------------------------------------
// confirmDialog — the ONE confirm helper (UI/UX report §10.1, Wave 1b)
// ---------------------------------------------------------------------------

export interface ConfirmDialogOptions {
  title: string
  message: string
  /** Verb for the primary action, e.g. "Delete", "Restore", "Discard". */
  confirmLabel: string
  cancelLabel?: string
  /** Renders the confirm action destructive (red + OS destructive style). */
  destructive?: boolean
  onConfirm?: () => void
  onCancel?: () => void
}

/**
 * Report §10.1 rule two: "alerts are reserved for destructive or irreversible
 * confirmations". If the action is reversible, prefer showToast — this helper
 * is for the ~10 destructive sites only. Both buttons are always offered so
 * the dialog can never trap the user; Escape/backdrop press maps to cancel,
 * exactly like the shim contract above.
 */
export function confirmDialog(options: ConfirmDialogOptions): void {
  Alert.alert(options.title, options.message, [
    { text: options.cancelLabel ?? 'Cancel', style: 'cancel', onPress: options.onCancel },
    {
      text: options.confirmLabel,
      style: options.destructive ? 'destructive' : 'default',
      onPress: options.onConfirm,
    },
  ])
}
