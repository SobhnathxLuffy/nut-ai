import { test, expect, type Page } from '@playwright/test'
import * as path from 'path'

/**
 * P2 (Section D) regression specs.
 *
 * These lock the browser-visible behaviour that the P2 audit found broken:
 * - P2-5/P2-6: dish browser copy — plural counts and human categories.
 * - P2-7: free-form "a + b + c" queries never auto-build a confident
 *   composition; they surface as a passive suggestion until tapped.
 * - P2-9: the web camera exposes all capture modes plus a manual-GTIN path.
 * - P2-10: the Apple Health section is gone on web.
 * - P2-11: hidden tab screens no longer leak their text into the page.
 * - P2-14: the search header accounts for the dish knowledge base.
 * - P2-16: 2-character queries get helpful copy, not a decompose CTA.
 */

const BACKUP = path.join(__dirname, 'fixtures', 'qa-backup.json')

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

const GARBAGE_COMBO = 'butter chicken + Extra rice + Dal fry → hash browns + pineapple + dal fry'

test.describe('P2-7: combo suggestions require user intent', () => {
  test('a long nonsense multi-part query shows a passive suggestion, never a built composition', async ({ page }) => {
    await restoreOnboarding(page)
    await page.goto('/food-search')
    const search = page.getByLabel('Search foods')
    await expect(search).toBeVisible({ timeout: 20_000 })
    await search.fill(GARBAGE_COMBO)

    // The suggestion may appear (5 parts ≤ the 5-part ceiling), but it must be
    // passive: no totals, no pre-built "Review meal" composition card.
    await expect(page.getByText('nothing is assumed yet')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: 'Review this combo' })).toBeVisible()
    await expect(page.getByText(/^Total:/)).toHaveCount(0)
  })

  test('more than 5 parts is treated as noise — not even a suggestion', async ({ page }) => {
    await restoreOnboarding(page)
    await page.goto('/food-search')
    const search = page.getByLabel('Search foods')
    await expect(search).toBeVisible({ timeout: 20_000 })
    await search.fill(`${GARBAGE_COMBO} + papad`)
    await expect(page.getByText('nothing is assumed yet')).toHaveCount(0)
    await expect(page.getByText(/^Total:/)).toHaveCount(0)
  })
})

test.describe('P2-14 + P2-16: search header counts and short-query copy', () => {
  test('header mentions the dish KB and 2-char queries get keep-typing copy', async ({ page }) => {
    await restoreOnboarding(page)
    await page.goto('/food-search')
    const search = page.getByLabel('Search foods')
    await expect(search).toBeVisible({ timeout: 20_000 })
    // P2-14: the corpus line accounts for the bundled dish knowledge base.
    // The wasm SQLite import takes a while on first boot — allow for it.
    await expect(page.getByText(/\d+ IFCT foods · [\d,]+ USDA foods · \d+ dish KB · offline/)).toBeVisible({ timeout: 30_000 })

    await search.fill('pa')
    await expect(page.getByText('Keep typing — search and ingredient decomposition need at least 3 characters.')).toBeVisible()
    await expect(page.getByRole('button', { name: /Decompose/ })).toHaveCount(0)
  })
})

test.describe('P2-9: web camera exposes modes and manual GTIN', () => {
  test('mode pills render and barcode mode offers GTIN entry with validation', async ({ page }) => {
    // The camera route sits behind the onboarding gate — onboard first.
    await restoreOnboarding(page)
    await page.goto('/camera')
    await expect(page.getByRole('button', { name: 'Scan food' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: 'Barcode' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Label' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Receipt' })).toBeVisible()

    await page.getByRole('button', { name: 'Barcode' }).click()
    const gtin = page.getByLabel('Barcode number (GTIN)')
    await expect(gtin).toBeVisible()
    await gtin.fill('123')
    await page.getByRole('button', { name: 'Look up barcode' }).click()
    await expect(page.getByText('Enter the 8–14 digit number printed under the bars.')).toBeVisible()
  })
})

test.describe('P2-10: no Apple Health dead control on web', () => {
  test('profile has no Apple Health section on web', async ({ page }) => {
    await restoreOnboarding(page)
    await page.goto('/profile')
    await expect(page.getByText('Your data')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Apple Health')).toHaveCount(0)
  })
})

test.describe('P2-5 + P2-6: dish browser copy', () => {
  test('plural counts and pretty categories', async ({ page }) => {
    await restoreOnboarding(page)
    await page.goto('/indian-dishes')
    await expect(page.getByText(/Showing 3\d\d dishes/)).toBeVisible({ timeout: 20_000 })
    // P2-6: raw snake-case category codes must not reach the UI.
    await expect(page.getByText('street_food_snack')).toHaveCount(0)
    await expect(page.getByText('Street Food Snack').first()).toBeVisible()
  })
})

test.describe('P2-11: hidden tabs stop leaking into the page', () => {
  test('Home-only content is absent from the Food tab', async ({ page }) => {
    await restoreOnboarding(page)
    await page.goto('/food')
    // The Food tab is really loaded (its DayTimeline chrome is present)…
    await expect(page.getByRole('button', { name: 'Log food' })).toBeVisible({ timeout: 20_000 })
    // …but the Home tab's target block must not leak into the page.
    await expect(page.getByText('Your target')).toHaveCount(0)
  })
})
