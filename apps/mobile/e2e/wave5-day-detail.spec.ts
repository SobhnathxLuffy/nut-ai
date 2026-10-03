import { test, expect, type Page } from '@playwright/test'
import * as path from 'path'

/**
 * Wave 5 — the day-detail view (AGENTS.md §0.2 item O4: "the 56-day strip
 * navigates but there is no dedicated day-detail view").
 *
 * Route: /day-detail?date=YYYY-MM-DD. The screen composes the reads Home
 * already runs (dayTotals / currentGoal / the timeline), so these specs pin
 * the browser-visible contract: friendly date title, the target line, the
 * meal row, and the row press opening meal-detail.
 *
 * The shipped qa-backup.json carries its fixture rows in goals/workouts but
 * an EMPTY meals table, so the "day with meals" is created through the app's
 * own food-review write path first (the same payload shape the p1 specs
 * exercise) on the fixture's workout day — 2024-09-27 — and the day view is
 * then opened for that date.
 *
 * Runs via `npm run check:e2e` from the repo root (expo export → serve-3000.py
 * with COOP/COEP + SPA fallback → Playwright). NOT run as part of this task's
 * verification — the central e2e run owns Playwright; deferred until then.
 */

const BACKUP = path.join(__dirname, 'fixtures', 'qa-backup.json')

/** The fixture's workout day — the day these specs populate and open. */
const MEAL_DATE = '2024-09-27'

/** The current goal the fixture restores (goals row 2: effective 2050 kcal). */
const TARGET_KCAL = '2,050'

const REVIEW_SELECTION = {
  foodId: null,
  matchedFoodSource: 'userfood',
  displayName: 'QA Day Detail Food',
  grams: 100,
  nutrientSnapshot: { kcal: 200, protein_g: 10, fat_g: 5, carbs_g: 20, fiber_g: null },
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

test.describe('day-detail: the dedicated day view', () => {
  test('a day with a logged meal shows the date title, totals and the meal row; a row press opens meal-detail', async ({ page }) => {
    await restoreOnboarding(page)

    // Log one meal on MEAL_DATE through the review write path (200 kcal:
    // 100 g × 200 kcal/100 g). The toast is the write's completion signal.
    const payload = JSON.stringify({ selection: REVIEW_SELECTION, date: MEAL_DATE })
    await page.goto(`/food-review?payload=${encodeURIComponent(payload)}`)
    await page.getByRole('button', { name: 'Save to diary' }).click()
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 20_000 })

    // Open the day view for that date.
    await page.goto(`/day-detail?date=${MEAL_DATE}`)
    // The friendly, deterministic date title (Screen's large header).
    await expect(page.getByRole('heading', { name: 'Friday, September 27, 2024' })).toBeVisible({ timeout: 15_000 })
    // The target line — the same goal read Home renders (fixture goal 2).
    await expect(page.getByText(`of ${TARGET_KCAL} kcal target`)).toBeVisible()
    // The meal row: the slot label plus the timeline's item-name detail.
    await expect(page.getByText('QA Day Detail Food')).toBeVisible()
    // The totals block rendered against the goal (200 logged < 2050 target).
    await expect(page.getByText('Calories left')).toBeVisible()

    // A row press opens meal-detail, the same route DayTimeline's rows use.
    await page.getByRole('button', { name: /QA Day Detail Food/ }).click()
    await expect(page.getByText('Logged meal')).toBeVisible({ timeout: 15_000 })
  })

  test('a day with no meals renders the Empty state with the create-first action', async ({ page }) => {
    await restoreOnboarding(page)
    // The fixture's workout day restored above has no meals until logged;
    // use a different fixture-covered past date so the first spec's write
    // cannot leak (fresh browser context per test — but the date is also
    // simply not the one that spec logs to).
    await page.goto('/day-detail?date=2024-09-26')
    await expect(page.getByRole('heading', { name: 'Thursday, September 26, 2024' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('No meals logged')).toBeVisible()
    // The next step rides the Empty primitive's selected action.
    await expect(page.getByRole('button', { name: 'Log food' })).toBeVisible()
  })

  test('a bad date renders the honest fallback, not a different day', async ({ page }) => {
    await restoreOnboarding(page)
    await page.goto('/day-detail?date=2026-02-30')
    await expect(page.getByText('That date isn\'t a real day')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Go back' })).toBeVisible()
  })
})
