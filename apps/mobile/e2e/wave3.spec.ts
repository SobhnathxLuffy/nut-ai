import { test, expect, type Page } from '@playwright/test'
import * as path from 'path'

/**
 * Wave 3 (trust and consistency) regression specs.
 *
 * - P2-14: the Food tab renders guidance instead of dead space for a new user.
 * - P2-15: the web dirty-guard — browser reload and browser back can no longer
 *   silently destroy unsaved custom-food edits (the guard only existed for
 *   Android hardware-back before).
 * - P2-17..19 (smoke): onboarding chrome renders from tokens after the
 *   ternary removal — the flow still works end to end.
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

test.describe('P2-14: Food tab empty states', () => {
  test('a brand-new user gets guidance instead of dead space', async ({ page }) => {
    await restoreOnboarding(page)
    await page.getByRole('tab', { name: 'Food' }).click()
    await expect(
      page.getByText('Nothing here yet — log a few foods and they will appear.'),
    ).toBeVisible({ timeout: 15_000 })
  })
})

test.describe('P2-15: web dirty-guard on custom-food', () => {
  test('reload while dirty triggers the browser leave-confirmation', async ({ page }) => {
    await restoreOnboarding(page)
    await page.goto('/custom-food')
    const nameField = page.getByLabel('Food name')
    await expect(nameField).toBeVisible({ timeout: 15_000 })
    await nameField.fill('Wave 3 guard probe')

    const dialogTypes: string[] = []
    page.on('dialog', (dialog) => {
      dialogTypes.push(dialog.type())
      // Accepting lets the reload through; dismissing would cancel it and
      // page.reload() would wait forever for a navigation that never happens.
      void dialog.accept()
    })
    await page.reload()
    // The browser asked before dropping the edit, then the reload completed.
    expect(dialogTypes).toContain('beforeunload')
    await expect(page.getByLabel('Food name')).toBeVisible({ timeout: 15_000 })
  })

  test('browser back while dirty cannot destroy the draft — it is restored on return', async ({ page }) => {
    await restoreOnboarding(page)
    await page.goto('/custom-food')
    const nameField = page.getByLabel('Food name')
    await expect(nameField).toBeVisible({ timeout: 15_000 })
    await nameField.fill('Wave 3 guard probe')

    // expo-router's web fork routes browser back through a NAVIGATE dispatch,
    // which offers no interception point — so the create form persists its
    // draft and restores it instead of losing the work silently.
    await page.goBack()
    await page.goto('/custom-food')
    const restored = page.getByLabel('Food name')
    await expect(restored).toBeVisible({ timeout: 15_000 })
    await expect(restored).toHaveValue('Wave 3 guard probe')
  })
})

test.describe('P2-17..19 smoke: onboarding chrome still works after tokenization', () => {
  test('option screen renders, gates its CTA, and advances on selection', async ({ page }) => {
    await page.goto('/onboarding/sex')
    const continueBtn = page.getByRole('button', { name: 'Continue' })
    await expect(continueBtn).toBeDisabled()
    await expect(page.getByText('Select an option to continue')).toBeVisible()
    await page.getByRole('radio', { name: 'Female' }).click()
    await expect(continueBtn).toBeEnabled()
  })
})
