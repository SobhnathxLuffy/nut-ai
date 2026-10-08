import { test, expect, type Page } from '@playwright/test'
import * as path from 'path'

/**
 * Wave 5C — the 130% font-scale LAYOUT audit, emulated in the browser.
 *
 * This closes design-system §7 deviation #2 ("130% device font audit — NOT
 * TESTED (device)") as far as the WEB build can close it: RN Web 0.21 drops
 * `allowFontScaling` (it is a web no-op), so the OS font scale is emulated by
 * rewriting every type-token font size to its 130% value through the two
 * carriers RN Web actually uses:
 *
 *   (1) INLINE STYLES — React writes each instance's dynamic style as an
 *       element style attribute; an attribute selector
 *       `[style*="font-size: 16px"]{font-size:20.8px !important}` overrides it.
 *       Chrome serialises the attribute WITH a space after the colon, so both
 *       spellings are covered.
 *   (2) STYLESHEET RULES — RN Web hoists static style declarations into atomic
 *       classes; every rule whose font-size is a token size is mutated in
 *       place with `r.style.setProperty('font-size', mapped, 'important')`.
 *
 * The token map (tokens.ts §11.1 ramp × 1.3): 12.5→16.25, 14→18.2, 16→20.8,
 * 20→26, 28→36.4, 56→67.2. The display numeral 56→67.2 EXACTLY emulates the
 * native 1.2 cap (maxFontSizeMultiplier) at a 130% OS scale plus the lineHeight
 * 68 headroom its call sites carry. monoData (16/22) is size-indistinguishable
 * from body 16 by font size alone, so this audit exercises it at the stricter
 * 1.3 (16→20.8) and accepts that as a conservative bound.
 *
 * CRITICAL: RN Web inserts atomic rules lazily as screens render, so the
 * injection is re-applied after every navigation (the helper returns the
 * re-apply function) and re-runs on a MutationObserver whenever a new
 * stylesheet node appears.
 *
 * NOT TESTED (device): native VoiceOver/TalkBack reading, real Android font
 * metric substitution (Roboto vs the web font stack), native line-breaking,
 * and the platform text autosizing rules — this emulation proves the LAYOUT
 * absorbs the token-scaled sizes; the native reading order and platform
 * differences remain device-side. An honest web finding, recorded rather than
 * failed: at 130% the title glyph ink (28→36.4px) exceeds its fixed 32px
 * line-height box by ~4px with overflow VISIBLE — nothing is cut, and native
 * RN behaves identically (fixed lineHeight + scaled font); that is the exact
 * trade the Wave 4b headroom policy accepted for everything except display.
 */

const BACKUP = path.join(__dirname, 'fixtures', 'qa-backup.json')

/**
 * The 130% emulation. Returns the re-apply function — call it after every
 * navigation: a fresh document loses both the injected <style> element and
 * the observer, and lazily-inserted rules on the new screen still carry the
 * ORIGINAL token sizes.
 */
async function applyFontScale130(page: Page): Promise<() => Promise<void>> {
  const reapply = (): Promise<void> =>
    page.evaluate(() => {
      const TOKENS: Record<string, string> = {
        '12.5px': '16.25px',
        '14px': '18.2px',
        '16px': '20.8px',
        '20px': '26px',
        '28px': '36.4px',
        '56px': '67.2px',
      }
      const apply = (): number => {
        // Prong 1 — the attribute-selector style element (inline carriers).
        let style = document.getElementById('fontScale130') as HTMLStyleElement | null
        if (!style) {
          style = document.createElement('style')
          style.id = 'fontScale130'
          document.head.appendChild(style)
        }
        const selectors: string[] = []
        for (const [px, scaled] of Object.entries(TOKENS)) {
          // Chrome serialises inline styles as `font-size: 16px` (space after
          // the colon); both spellings are covered.
          selectors.push(`[style*="font-size:${px}"]{font-size:${scaled} !important}`)
          selectors.push(`[style*="font-size: ${px}"]{font-size:${scaled} !important}`)
        }
        const next = selectors.join('\n')
        // Only write when the content actually differs: re-writing textContent
        // replaces the style element's text node, and the MutationObserver
        // below watches the head subtree — an unconditional write would feed
        // the observer its own mutation forever.
        if (style.textContent !== next) style.textContent = next
        // Prong 2 — mutate every stylesheet rule at a token size (RN Web's
        // hoisted atomic classes).
        let mutated = 0
        for (const sheet of Array.from(document.styleSheets)) {
          let list: CSSRuleList | null = null
          try {
            list = sheet.cssRules
          } catch {
            continue
          }
          if (!list) continue
          for (const rule of Array.from(list)) {
            const st = (rule as CSSStyleRule).style
            if (st && st.fontSize) {
              const target = TOKENS[st.fontSize]
              if (target) {
                st.setProperty('font-size', target, 'important')
                mutated++
              }
            }
          }
        }
        return mutated
      }
      const w = window as unknown as { __fontScale130?: () => number; __fontScale130Observer?: MutationObserver }
      w.__fontScale130 = apply
      apply()
      // RN Web appends <style> nodes lazily; re-apply whenever one lands.
      if (!w.__fontScale130Observer) {
        w.__fontScale130Observer = new MutationObserver(() => {
          w.__fontScale130?.()
        })
        w.__fontScale130Observer.observe(document.head, { childList: true, subtree: true })
      }
    })
  await reapply()
  return reapply
}

/**
 * The no-clip audit. A text-bearing element FAILS only when its ink is
 * actually CUT: scrollWidth/scrollHeight beyond the client box AND the
 * element's own overflow is hidden/clip. Elements inside scroll containers
 * (the horizontal day-strip ScrollView, the page's vertical ScrollView) are
 * excluded — they scroll, they do not clip. Overflow:visible elements whose
 * glyph ink exceeds the fixed line-height box are the documented native-parity
 * finding in the header, not failures.
 */
async function clippedTextElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = []
    const insideScroller = (el: HTMLElement): boolean => {
      let cur: HTMLElement | null = el.parentElement
      while (cur && cur !== document.body) {
        const cs = getComputedStyle(cur)
        if (/(auto|scroll)/.test(cs.overflowX) || /(auto|scroll)/.test(cs.overflowY)) return true
        cur = cur.parentElement
      }
      return false
    }
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('div,span,p,input'))) {
      const isInput = el.tagName === 'INPUT'
      const text = isInput ? (el as HTMLInputElement).value : (el.textContent ?? '')
      const hasText = isInput
        ? text.trim() !== ''
        : Array.from(el.childNodes).some(
            (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '',
          )
      if (!hasText) continue
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      const hOver = el.scrollWidth - el.clientWidth
      const vOver = el.scrollHeight - el.clientHeight
      if (hOver <= 2 && vOver <= 2) continue
      if (insideScroller(el)) continue
      const cs = getComputedStyle(el)
      const cut = (v: string) => v === 'hidden' || v === 'clip'
      if (cut(cs.overflow) || cut(cs.overflowX) || cut(cs.overflowY)) {
        problems.push(`${el.tagName} "${text.slice(0, 32)}" h+${hOver} v+${vOver}`)
      }
    }
    return problems
  })
}

/** The onboarding gate helper from wave4.spec.ts — a completed profile first. */
async function restoreOnboarding(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Restore from a backup' }).click()
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 20_000 }),
    page.getByText('Choose backup file').click(),
  ])
  await chooser.setFiles(BACKUP)
  await expect(page.getByText('Backup found')).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Restore', exact: true }).click()
  const dialog = page.locator('[role="alertdialog"]')
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await dialog.getByRole('button', { name: 'Restore' }).click()
  await expect(page.getByRole('tab', { name: 'Home' })).toBeVisible({ timeout: 30_000 })
}

test.describe('130% font-scale emulation (Wave 5C, design-system §7 #2)', () => {
  test('Home: hero numeral, target line and macro rows survive 130% with no cut text; day-strip and tabs stay tappable', async ({ page }) => {
    await restoreOnboarding(page)
    const rescale = await applyFontScale130(page)

    // The hero kcal numeral + the target line + a macro stat row.
    // (Fixture goal 2: 2050 kcal — the target line reads "of 2,050 kcal
    // target"; eaten today is 0, so the hero numeral is 2050.)
    const hero = page.getByText('2050', { exact: true })
    await expect(hero).toBeVisible()
    await expect(page.getByText('of 2,050 kcal target')).toBeVisible()
    await expect(page.getByText('Protein', { exact: true })).toBeVisible()

    // The emulation landed: the hero numeral computes at exactly 67.2px —
    // 56 × 1.2 (the native display cap) — inside its lineHeight-68 headroom.
    const heroFont = await hero.evaluate((el) => getComputedStyle(el).fontSize)
    expect(heroFont).toBe('67.2px')

    // No visible text is cut (see clippedTextElements for the exact rule).
    expect(await clippedTextElements(page), 'no cut text at 130% on Home').toEqual([])

    // The "Today" strip chip is still a live hit target: pressing it opens the
    // day-detail view for today (the shipped O4 behavior) — the 44pt target
    // survives the scale. (Day-detail is a stack screen — the tab bar is not
    // present there; Back returns to the tab shell.)
    await page.getByRole('button', { name: /^Today,/ }).click()
    await expect(page.getByRole('button', { name: 'Back to home' })).toBeVisible({ timeout: 15_000 })
    await rescale()
    await page.getByRole('button', { name: 'Back to home' }).click()
    await expect(page.getByText('of 2,050 kcal target')).toBeVisible({ timeout: 15_000 })
    await rescale()

    // One PAST day button is still tappable too (computed off the real clock,
    // same arithmetic the strip uses — weekday + date number is unique inside
    // the 56-day window).
    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const yesterday = new Date(Date.now() - 86_400_000)
    const yesterdayChip = `${dayLabels[yesterday.getDay()]} ${yesterday.getDate()}`
    await page.getByRole('button', { name: yesterdayChip, exact: true }).click()
    await expect(page.getByRole('button', { name: 'Back to home' })).toBeVisible({ timeout: 15_000 })
    await rescale()
    await page.getByRole('button', { name: 'Back to home' }).click()
    await expect(page.getByText('of 2,050 kcal target')).toBeVisible({ timeout: 15_000 })

    // And the tab bar still navigates at 130%: the Home tab keeps us here.
    await page.getByRole('tab', { name: 'Home' }).click()
    await expect(page.getByText('of 2,050 kcal target')).toBeVisible({ timeout: 15_000 })
    await rescale()
    expect(await clippedTextElements(page)).toEqual([])
  })

  test('Camera: heading, four mode buttons and review radios survive 130% with no cut text', async ({ page }) => {
    await restoreOnboarding(page)
    const rescale = await applyFontScale130(page)

    await page.goto('/camera')
    await expect(page.getByRole('heading', { name: 'Scan food' })).toBeVisible({ timeout: 15_000 })
    await rescale()

    // The web capture surface: the four mode pills (the review-mode toggle is
    // gone — T-IMPL-A deleted Quick/Advanced; one scan path per type).
    for (const mode of ['Scan food', 'Barcode', 'Label', 'Receipt']) {
      await expect(page.getByRole('button', { name: mode, exact: true })).toBeVisible()
    }
    await expect(page.getByRole('radio', { name: 'Quick review' })).toHaveCount(0)
    await expect(page.getByRole('radio', { name: 'Advanced review' })).toHaveCount(0)

    // The injection re-applied after navigation: the camera heading (the
    // 20px heading token) now computes at its scaled 26px — proving
    // late-inserted rules were caught after the navigation.
    const headingFont = await page
      .getByRole('heading', { name: 'Scan food' })
      .evaluate((el) => getComputedStyle(el).fontSize)
    expect(headingFont).toBe('26px')

    expect(await clippedTextElements(page), 'no cut text at 130% on the camera screen').toEqual([])
  })

  test('Workout: the 130% set-table audit deferred by Wave 4 — cells, labels and values survive with no cut text', async ({ page }) => {
    await restoreOnboarding(page)
    const rescale = await applyFontScale130(page)

    // The fixture's active workout (id 1) carries the set table.
    await page.goto('/workout?id=1')
    await expect(page.getByRole('heading', { name: 'QA Upper Day' })).toBeVisible({ timeout: 15_000 })
    await rescale()

    // Set-table structure: the column header labels and one row's cells.
    await expect(page.getByText('PREV', { exact: true })).toBeVisible()
    // The set inputs keep their accessible names and their loaded values.
    await expect(page.getByRole('textbox', { name: 'Load (lb) set 1' })).toHaveValue('132.28')
    await expect(page.getByRole('textbox', { name: 'Reps set 1' })).toHaveValue('8')
    // The set-number column and the exercise caption.
    await expect(page.getByText('Barbell Bench Press', { exact: true })).toBeVisible()

    // The set-cell text rides monoData (16/22): audited here at the stricter
    // 1.3 (16→20.8) — a conservative bound over the token's 1.2 cap.
    const loadFont = await page
      .getByRole('textbox', { name: 'Load (lb) set 1' })
      .evaluate((el) => getComputedStyle(el).fontSize)
    expect(parseFloat(loadFont)).toBeGreaterThan(16)

    expect(await clippedTextElements(page), 'no cut text at 130% in the workout set table').toEqual([])
  })
})
