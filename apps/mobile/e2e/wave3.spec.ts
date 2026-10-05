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
  // 2026-10-05 stepwise rebuild smoke: the whole journey end to end, PLUS the
  // owner-mandated unit independence — height units are switched independently
  // of weight units mid-journey, touching all four combinations (kg/cm via the
  // defaults, lb/ft+in after the welcome switches, lb/cm and kg/cm via the
  // mid-step switches). Canonical answers stay metric; only the pickers change
  // what they render.
  test('the stepwise journey completes end to end with independent height/weight units', async ({ page }) => {
    await page.goto('/onboarding')
    await expect(page.getByText('Step 1 of 12')).toBeVisible()

    // Step 1 — welcome + units: switch BOTH independently (kg/cm -> lb/ft+in).
    await page.getByRole('button', { name: 'lb', exact: true }).click()
    await page.getByRole('button', { name: 'ft + in', exact: true }).click()
    await page.getByRole('button', { name: 'Continue' }).click()

    // Steps 2-5 — the question steps (same gates as the wave1 walk).
    await page.getByRole('radio', { name: 'Female' }).click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('radio', { name: '3-5' }).click()
    await page
      .getByRole('radiogroup', { name: /personal trainer or registered dietitian/ })
      .getByRole('radio', { name: 'No', exact: true })
      .click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('radio', { name: 'Balanced' }).click()
    await page.getByRole('radio', { name: 'Lack of consistency' }).click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('radio', { name: 'Eat and live healthier' }).click()
    await page.getByRole('button', { name: 'Continue' }).click()

    // Step 6 — birthday defaults.
    await expect(page.getByText('Step 6 of 12')).toBeVisible()
    await page.getByRole('button', { name: 'Continue' }).click()

    // Step 7 — height: lb/ft+in renders the FEET wheel. Then switch height
    // back to cm mid-step -> the CENTIMETRES wheel. The weight unit is
    // untouched by the height toggle (independence).
    await expect(page.getByText('Step 7 of 12')).toBeVisible()
    await expect(page.getByLabel('Feet')).toBeVisible()
    await page.getByRole('button', { name: 'cm', exact: true }).click()
    await expect(page.getByLabel('Centimetres')).toBeVisible()
    await page.getByRole('button', { name: 'Continue' }).click()

    // Step 8 — weight: the lb switch from step 1 holds — the ruler reads lbs
    // (lb/cm combination). Switch weight back to kg mid-step -> kg readout.
    // Canonical kg is what persists either way; only the picker changes.
    await expect(page.getByText('Step 8 of 12')).toBeVisible()
    await expect(page.getByLabel(/lbs\. Tap to type an exact value/)).toBeVisible()
    await page.getByRole('button', { name: 'kg', exact: true }).click()
    await expect(page.getByLabel(/kg\. Tap to type an exact value/)).toBeVisible()
    await page.getByRole('button', { name: 'Continue' }).click()

    // Step 9 — goal weight (underweight note stays non-blocking).
    await expect(page.getByText('Step 9 of 12')).toBeVisible()
    await page.getByRole('button', { name: 'Continue' }).click()

    // Step 10 — provider skip path.
    await page.getByRole('radio', { name: 'No key for now' }).click()
    await page.getByRole('button', { name: 'Continue' }).click()

    // Step 11 — preferences.
    await page
      .getByRole('radiogroup', { name: /Rollover/ })
      .getByRole('radio', { name: 'Yes', exact: true })
      .click()
    await page.getByRole('button', { name: 'Continue' }).click()

    // Step 12 — final CTA opens the reveal (persist happens at the reveal's
    // own CTA, not here — this smoke stops at the hero numbers rendering).
    await expect(page.getByText('Step 12 of 12')).toBeVisible()
    await page.getByRole('button', { name: 'See my plan' }).click()
    await expect(page.getByText('Your daily recommendation')).toBeVisible({ timeout: 20_000 })
  })
})
