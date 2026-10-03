import { test, expect, type Page } from '@playwright/test'
import * as path from 'path'

/**
 * Wave 5C — the deep-link route matrix (design-system §7 deviation #4's web
 * half: every direct route + the semantic aliases, one parameterized walk).
 *
 * Wave 4c proved /scan, /log and the not-found fallback individually; this
 * walks the FULL matrix in one test so a route that stops rendering its real
 * screen fails the walk by name. Each entry pins the screen's sentinel — a
 * heading where the screen renders one, otherwise the strongest stable
 * element the tree actually exposes (verified live: /assistant and
 * /log-weight render their titles as plain text, not role=heading — asserted
 * as text, not as headings the tree does not carry).
 *
 * The 8 direct routes (/train, /workout, /assistant, /progress, /log-weight,
 * /day-detail, the not-found path and the camera screen behind /scan) plus
 * the 3 semantic aliases (/scan → /camera, /log → /food, /home → /).
 */

const BACKUP = path.join(__dirname, 'fixtures', 'qa-backup.json')

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

/** One route entry: the URL to walk and the sentinel that proves the real screen rendered. */
const ROUTES: ReadonlyArray<{ url: string; what: string; sentinel: (page: Page) => Promise<void> }> = [
  {
    url: '/scan',
    what: 'alias → the camera screen',
    sentinel: async (page) => {
      await expect(page.getByRole('heading', { name: 'Scan food' })).toBeVisible({ timeout: 15_000 })
    },
  },
  {
    url: '/log',
    what: 'alias → the Food tab (write surface)',
    sentinel: async (page) => {
      await expect(page.getByRole('heading', { name: 'Food' })).toBeVisible({ timeout: 15_000 })
      await expect(page.getByRole('button', { name: 'Log food' })).toBeVisible()
    },
  },
  {
    url: '/home',
    what: 'alias → the Home tab',
    sentinel: async (page) => {
      await expect(page.getByRole('tab', { name: 'Home' })).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText('kcal target')).toBeVisible()
    },
  },
  {
    url: '/train',
    what: 'direct — the Train tab',
    sentinel: async (page) => {
      await expect(page.getByRole('heading', { name: 'Train' })).toBeVisible({ timeout: 15_000 })
    },
  },
  {
    url: '/workout?id=1',
    what: 'direct — the active workout (fixture id)',
    sentinel: async (page) => {
      await expect(page.getByRole('heading', { name: 'QA Upper Day' })).toBeVisible({ timeout: 15_000 })
      // The screen is the set table, not just a title.
      await expect(page.getByRole('textbox', { name: 'Reps set 1' })).toHaveValue('8')
    },
  },
  {
    url: '/assistant',
    what: 'direct — the assistant modal',
    sentinel: async (page) => {
      // The modal's header renders as text (no role=heading on web) — the
      // tree's honest sentinel is the title text plus the input placeholder.
      await expect(page.getByText('AI Assistant', { exact: true })).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText('Ask anything')).toBeVisible()
    },
  },
  {
    url: '/progress',
    what: 'direct — the Progress tab',
    sentinel: async (page) => {
      await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible({ timeout: 15_000 })
    },
  },
  {
    url: '/log-weight',
    what: 'direct — the log-weight modal',
    sentinel: async (page) => {
      // Plain-text title (verified: no heading role) + the modal's save action.
      await expect(page.getByText("Today's weight")).toBeVisible({ timeout: 15_000 })
      await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible()
    },
  },
  {
    url: '/day-detail?date=2024-09-27',
    what: 'direct — the dedicated day view (fixture workout day)',
    sentinel: async (page) => {
      await expect(page.getByRole('heading', { name: 'Friday, September 27, 2024' })).toBeVisible({ timeout: 15_000 })
    },
  },
  {
    url: '/nope',
    what: 'unknown — the friendly not-found fallback',
    sentinel: async (page) => {
      await expect(page.getByText("This link doesn't go anywhere")).toBeVisible({ timeout: 15_000 })
      await expect(page.getByRole('button', { name: 'Go home' })).toBeVisible()
    },
  },
]

test.describe('Wave 5C: deep-link route matrix — every route renders its real screen', () => {
  test('walking all 8 direct routes + the 3 aliases on web', async ({ page }) => {
    await restoreOnboarding(page)
    for (const route of ROUTES) {
      await page.goto(route.url)
      await route.sentinel(page)
      // The sentinel held for this route; the walk names the offender on failure.
    }
  })
})
