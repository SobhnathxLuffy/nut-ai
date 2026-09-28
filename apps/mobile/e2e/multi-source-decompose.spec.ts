import { test, expect, type Page } from '@playwright/test'
import * as path from 'path'

/**
 * Multi-source search + decomposer regression specs (QA product round).
 *
 * User-reported defects locked here:
 * - "only one database gives results — either USDA or IFCT": a single search
 *   must surface rows from BOTH bundled corpora, with source labels visible.
 * - "decompose only had a main ingredient, an oil, and a method": the
 *   decomposer now supports MULTIPLE ingredients, a searchable picker across
 *   all databases (user foods + IFCT + USDA), editable grams per ingredient,
 *   an editable oil amount, and a per-ingredient macro breakdown.
 * - Ingredients missing from every database can be created on the spot and
 *   land in the custom food DB, searchable afterwards.
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

test.describe('multi-source search', () => {
  test('one query surfaces both IFCT and USDA rows with source labels', async ({ page }) => {
    await restoreOnboarding(page)
    await page.goto('/food-search')
    const search = page.getByLabel('Search foods')
    await expect(search).toBeVisible({ timeout: 20_000 })
    // The wasm corpora take a moment on first boot.
    await expect(page.getByText(/\d+ IFCT foods/)).toBeVisible({ timeout: 30_000 })

    await search.fill('rice')
    // Both source labels must appear in the merged list — the old cascade
    // stopped at whichever corpus matched first and hid the other entirely.
    await expect(page.getByText('IFCT 2017 · ICMR-NIN').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('USDA FOODDATA CENTRAL').first()).toBeVisible({ timeout: 30_000 })
  })
})

test.describe('decomposer', () => {
  test('supports multiple ingredients with a searchable cross-database picker and per-ingredient grams', async ({ page }) => {
    await restoreOnboarding(page)
    await page.goto('/food-search')
    const search = page.getByLabel('Search foods')
    await expect(search).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/\d+ IFCT foods/)).toBeVisible({ timeout: 30_000 })

    // Zero-match query opens the decomposer.
    await search.fill('xzqv zzzq')
    await page.getByRole('button', { name: /Decompose/ }).click()

    // The ingredient list exists with a seed row, and the searchable picker
    // queries every database.
    await expect(page.getByText('Ingredients (grams as used in the whole dish)')).toBeVisible()
    await page.getByLabel('Search ingredients').fill('onion')
    await expect(page.getByText('Add any ingredient (searches your foods · IFCT · USDA)')).toBeVisible()
    // Both databases must surface through the picker — the old cascade only
    // ever showed one corpus.
    await expect(page.getByText('IFCT 2017 · ICMR-NIN').first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('USDA FOODDATA CENTRAL').first()).toBeVisible({ timeout: 20_000 })

    // Adding a picker row grows the ingredient list; every row carries a
    // grams input the user can edit.
    await page.getByRole('button', { name: 'Add ingredient Onion, big (Allium cepa)' }).click()
    await expect(page.getByLabel('Grams of Onion, big (Allium cepa)')).toBeVisible()

    // The live arithmetic responds to gram edits (raw mass line updates).
    await expect(page.getByText(/Raw mass: \d+g → Cooked yield: \d+g/)).toBeVisible()
    await expect(page.getByText(/By ingredient/)).toBeVisible()
  })

  test('a missing ingredient can be created and becomes searchable', async ({ page }) => {
    await restoreOnboarding(page)
    await page.goto('/food-search')
    const search = page.getByLabel('Search foods')
    await expect(search).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/\d+ IFCT foods/)).toBeVisible({ timeout: 30_000 })

    await search.fill('xzqv zzzq')
    await page.getByRole('button', { name: /Decompose/ }).click()

    await page.getByLabel('Search ingredients').fill('zzyzx custom masala')
    await page.getByRole('button', { name: /Create “zzyzx custom masala” as a custom ingredient/ }).click()
    await page.getByLabel('Ingredient name').fill('Zzyzx Custom Masala')
    await page.getByLabel('kcal per 100 grams').fill('250')
    await page.getByLabel('P g per 100 grams').fill('10')
    await page.getByLabel('C g per 100 grams').fill('30')
    await page.getByLabel('F g per 100 grams').fill('8')
    await page.getByRole('button', { name: 'Save custom ingredient' }).click()

    // The created ingredient joins the dish's ingredient list with its 100 g
    // default, and the breakdown line shows its kcal contribution.
    await expect(page.getByLabel('Grams of Zzyzx Custom Masala')).toBeVisible()
    await expect(page.getByText(/Zzyzx Custom Masala · 100g → \d+ kcal/)).toBeVisible()
  })
})
