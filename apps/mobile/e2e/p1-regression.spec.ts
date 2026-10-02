import { test, expect, type Page } from '@playwright/test'
import * as path from 'path'

/**
 * P1 (Section C) regression specs.
 *
 * These lock the browser-visible behaviour that the P1 audit found broken:
 * - P1-1/P1-3: the restore journey — DocumentPicker opens a real file chooser
 *   on web, and the confirm dialog is a real (shimmed) dialog, not a no-op.
 * - P1-6: a review payload with a missing/invalid date renders the review UI
 *   with live validation instead of the hostile "Data corrupted" card.
 * - P1-8: the Indian dishes browser shows the whole 362-dish KB, not a
 *   LIMIT-100 slice.
 * - P1-9: dish composer components resolve to human-readable food names
 *   instead of raw source ids like "ifct:A019".
 *
 * Every journey starts from the restore flow, which both onboards the app
 * (the onboarding gate redirects fresh browsers) and doubles as the P1-3
 * regression: on web the file chooser must actually open and the restore
 * must actually land in the tabs.
 */

const BACKUP = path.join(__dirname, 'fixtures', 'qa-backup.json')

const REVIEW_SELECTION = {
  foodId: null,
  matchedFoodSource: 'userfood',
  displayName: 'QA P1 Food',
  grams: 100,
  nutrientSnapshot: { kcal: 200, protein_g: 10, fat_g: 5, carbs_g: 20, fiber_g: null },
}

function reviewUrl(date: string): string {
  const payload = JSON.stringify({ selection: REVIEW_SELECTION, date })
  return `/food-review?payload=${encodeURIComponent(payload)}`
}

async function restoreOnboarding(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Restore from a backup' }).click()
  // P1-3: the picker must wire a real file chooser on web.
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 20_000 }),
    page.getByText('Choose backup file').click(),
  ])
  await chooser.setFiles(BACKUP)
  await expect(page.getByText('Backup found')).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Restore', exact: true }).click()
  // P1-1: the confirmation dialog is the shimmed Alert — a real dialog.
  const dialog = page.locator('[role="alertdialog"]')
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await dialog.getByRole('button', { name: 'Restore' }).click()
  // Landed in the tab shell — restore replaced onboarding.
  await expect(page.getByRole('tab', { name: 'Home' })).toBeVisible({ timeout: 30_000 })
}

test.describe('P1-3 + P1-1: restore journey works on web', () => {
  test('file chooser opens, confirm dialog works, restore lands in the app', async ({ page }) => {
    await restoreOnboarding(page)
  })
})

test.describe('P1-6: review date is recoverable, never hostile', () => {
  test('missing date renders the review UI (not Data corrupted)', async ({ page }) => {
    await restoreOnboarding(page)
    await page.goto(reviewUrl(''))
    await expect(page.getByText('Review food')).toBeVisible()
    await expect(page.getByText('Data corrupted')).toHaveCount(0)
  })

  test('impossible date shows live feedback and blocks Save', async ({ page }) => {
    await restoreOnboarding(page)
    await page.goto(reviewUrl(''))
    const dateField = page.getByLabel('Date (YYYY-MM-DD)')
    await expect(dateField).toBeVisible()
    await dateField.fill('2026-02-30')
    await expect(page.getByText('Enter a real calendar date')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save to diary' })).toBeDisabled()
    await dateField.fill('2026-02-27')
    await expect(page.getByRole('button', { name: 'Save to diary' })).toBeEnabled()
    await expect(page.getByText('Enter a real calendar date')).toHaveCount(0)
  })
})

test.describe('P1-2: custom-food failures and duplicates are visible', () => {
  // Wave 1b (UI/UX report §10.1): reversible save failures no longer open a
  // blocking alert dialog — they surface as an error TOAST rendered by the
  // root-mounted toast host (accessibilityRole="alert", visible for 8s).
  // The tests below were minimally adapted from [role="alertdialog"] to the
  // toast element; the behaviour contract ("the failure is visible, not
  // silent") is unchanged.
  test('duplicate name save shows a real toast instead of failing silently', async ({ page }) => {
    await restoreOnboarding(page)
    const fillForm = async () => {
      await page.getByLabel('Food name').fill('QA Duplicate Ladoo')
      await page.getByLabel('Serving amount').fill('50')
      await page.getByLabel('Calories').fill('180')
      await page.getByLabel('Protein (g)').fill('10')
      await page.getByLabel('Carbs (g)').fill('20')
      await page.getByLabel('Fat (g)').fill('5')
    }
    await page.goto('/custom-food')
    await fillForm()
    await page.getByRole('button', { name: 'Save custom food' }).click()
    // First save must succeed (no error toast appears; the screen calls
    // router.back(), which is a no-op on a deep link with no history).
    await page.waitForTimeout(1_500)
    await expect(page.getByRole('alert')).toHaveCount(0)

    // Second save with the same name must SAY the name already exists.
    await page.goto('/custom-food')
    await fillForm()
    await page.getByRole('button', { name: 'Save custom food' }).click()
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('alert')).toContainText(/already exists/i)
  })

  test('missing calories shows a validation toast instead of nothing', async ({ page }) => {
    await restoreOnboarding(page)
    await page.goto('/custom-food')
    await page.getByLabel('Food name').fill('QA No Calories')
    await page.getByLabel('Serving amount').fill('50')
    await page.getByLabel('Protein (g)').fill('10')
    await page.getByRole('button', { name: 'Save custom food' }).click()
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 10_000 })
  })
})

test.describe('P1-8 + P1-9: the dish KB is fully browsable and readable', () => {
  test('whole corpus is listed; composer shows food names, not source ids', async ({ page }) => {
    await restoreOnboarding(page)

    // P1-8: no LIMIT-100 slice — all 362 identities are reachable.
    await page.goto('/indian-dishes')
    await expect(page.getByText(/Showing 3\d\d dishes/)).toBeVisible({ timeout: 30_000 })

    // P1-9: open a curated dish; components must resolve to names.
    const search = page.getByPlaceholder(/Search 362 identities/)
    await search.fill('idli')
    await page.getByText('Idli', { exact: true }).first().click({ timeout: 15_000 })
    await expect(page.getByText(/Resolved: /).first()).toBeVisible({ timeout: 30_000 })
    // No component may present a bare source id to the user.
    await expect(page.getByText(/Resolved: (ifct|usda):/)).toHaveCount(0)
  })
})
