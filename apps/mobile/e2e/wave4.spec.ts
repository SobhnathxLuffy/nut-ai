import { test, expect, type Page } from '@playwright/test'
import * as path from 'path'

/**
 * Wave 4c — nutai:// deep links (UI/UX report §7.2 / Table 7.1).
 *
 * On device the scheme (declared in app.config.ts) is registered by
 * expo-router itself; on web the SAME alias paths are plain URLs (the serve
 * stack provides the SPA fallback), so these specs exercise exactly the
 * DeepLinkRedirect components and the +not-found fallback the scheme taps
 * land on.
 *
 * Runs via `npm run check:e2e` from the repo root (expo export → serve-3000.py
 * with COOP/COEP + SPA fallback → Playwright). NOT run as part of this task's
 * verification — the web export belongs to the wave wrap-up step; deferred
 * until then.
 */

const BACKUP = path.join(__dirname, 'fixtures', 'qa-backup.json')

/** The onboarding gate helper from wave3.spec.ts — a completed profile first. */
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

test.describe('deep-link aliases land on the real screens', () => {
  test('/scan (nutai://scan) redirects to the camera screen', async ({ page }) => {
    await restoreOnboarding(page)
    await page.goto('/scan')
    // The web camera fallback renders the same destination the scan widget
    // tap lands on — its four capture modes + manual GTIN path.
    await expect(page.getByRole('heading', { name: 'Scan food' })).toBeVisible({ timeout: 15_000 })
    await expect(
      page.getByText('The live camera is not available here. Pick a photo, or type a barcode number.'),
    ).toBeVisible()
  })

  test('/log (nutai://log) redirects to the Food tab', async ({ page }) => {
    await restoreOnboarding(page)
    await page.goto('/log')
    await expect(page.getByRole('heading', { name: 'Food' })).toBeVisible({ timeout: 15_000 })
    // The write surface's primary action — proof this is the Food tab, not
    // just a screen titled "Food".
    await expect(page.getByRole('button', { name: 'Log food' })).toBeVisible()
  })
})

test.describe('unknown deep links get a friendly fallback', () => {
  test('/nope (nutai://nope) renders the not-found Empty and Go home returns to the Home tab', async ({ page }) => {
    await restoreOnboarding(page)
    await page.goto('/nope')
    await expect(page.getByText("This link doesn't go anywhere")).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Go home' }).click()
    await expect(page.getByRole('tab', { name: 'Home' })).toBeVisible({ timeout: 15_000 })
  })
})
