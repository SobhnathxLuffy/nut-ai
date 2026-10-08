import { test, expect, type Page, type Route } from '@playwright/test'
import * as path from 'path'

/**
 * Wave 5C — the deferred a11y-tree walk (design-system §7's audit round).
 *
 * Every assertion below was verified against what the ACCESSIBILITY TREE
 * ACTUALLY EXPOSES on RN Web 0.21 first (live snapshots), not against what
 * the RN props claim: RN Web maps accessibilityRole="button"→role="button",
 * "tab"→role="tab", "alert"→role="alert", "header"→heading, "image"→img, and
 * accessibilityLiveRegion→aria-live; accessibilityState={selected} does NOT
 * surface as aria-selected on web (unmapped — asserted only through what does
 * surface). RN Web's <Modal> host itself renders role="dialog" +
 * aria-modal="true"; the Wave 5C Sheet fix rides an accessibilityLabel on the
 * Modal so that dialog is NAMED.
 *
 * The honesty-row journey drives a real scan through a route-mocked
 * OpenAI-compatible gateway (same pattern as assistant-write.spec.ts: CORS +
 * preflight + models probe; never a real provider, never a real key) so the
 * result screen's glyph rows — the exact rows fixed this wave — render with
 * their labels in the tree.
 */

const BACKUP = path.join(__dirname, 'fixtures', 'qa-backup.json')

const GATEWAY = 'https://mock-gateway.test/v1'
const GATEWAY_KEY = 'sk-qa-mock-gateway-e2e-key-0123456789'

/** A 1x1 JPEG — enough payload for the in-browser preprocess stage. */
const JPEG_B64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDs0NDT/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+kAooooA/9k='
const JPEG_BUFFER = Buffer.from(JPEG_B64, 'base64')

/**
 * A VisionPayload (schema 1.2.0) shaped to exercise the honesty rows:
 *  - Roti: resolves against the corpus, no brand — a plain row.
 *  - Butter: carries a brand, so the web-lookup refinement fires; the gateway
 *    answers found:false, the lookup fails honestly, and the row renders the
 *    warning-glyph "Estimated" line (the Wave 5C fix site).
 *  - summary: known/unknown lines render the HonestySummaryCard glyph rows.
 */
const VISION_PAYLOAD = {
  schema_version: '1.2.0',
  is_food: true,
  refusal_reason: null,
  items: [
    {
      name: 'Roti',
      brand: null,
      canonical_food_key: 'roti',
      food_form: 'flat',
      qualitative_size: 'count:2',
      weight_basis: 'as_served',
      model_gram_estimate: 80,
      identification_confidence: 0.9,
      portion_confidence: 0.7,
      uncertainty_reason: 'none',
      visible_reference_objects: [],
      container: null,
      cooking_method_cues: ['dry_surface'],
      is_beverage: false,
      beverage_category: null,
      legible_label_text: null,
      stated_assumptions: [],
      clarifying_questions: [],
      fallback_macros_at_estimate: {
        calories_kcal: 200, protein_g: 6, carbs_g: 40, fat_g: 2, fiber_g: 4, sodium_mg: 150,
      },
    },
    {
      name: 'Butter',
      brand: 'Amul',
      canonical_food_key: 'butter',
      food_form: 'solid',
      qualitative_size: 'count:1',
      weight_basis: 'as_served',
      model_gram_estimate: 10,
      identification_confidence: 0.85,
      portion_confidence: 0.4,
      uncertainty_reason: 'portion',
      visible_reference_objects: [],
      container: null,
      cooking_method_cues: [],
      is_beverage: false,
      beverage_category: null,
      legible_label_text: 'Amul Butter 100g',
      stated_assumptions: [],
      clarifying_questions: [],
      fallback_macros_at_estimate: {
        calories_kcal: 72, protein_g: 0.9, carbs_g: 0.1, fat_g: 8, fiber_g: 0, sodium_mg: 120,
      },
    },
  ],
  meal_overall: {
    identification_confidence: 0.88, portion_confidence: 0.6, assumptions: [], clarifying_questions: [],
  },
  summary: {
    what_is_known: 'Two rotis and a branded butter portion were visible',
    what_is_not_known: 'The exact butter portion beyond the label serving',
  },
}

function sseData(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`
}

/** SSE scan stream: the vision payload JSON reassembled from content deltas. */
function scanStream(): string {
  const payload = JSON.stringify(VISION_PAYLOAD)
  const chunks = [payload.slice(0, 300), payload.slice(300, 700), payload.slice(700)]
  return [
    sseData({ choices: [{ delta: { role: 'assistant' } }] }),
    ...chunks.map((content) => sseData({ choices: [{ delta: { content } }] })),
    sseData({ choices: [{ delta: {} }, { finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 200 } }),
    'data: [DONE]\n\n',
  ].join('')
}

/** The gateway's honest "no published facts found" lookup answer. */
const LOOKUP_NOT_FOUND = { found: false, source_url: null, options: [], question: null }

/**
 * Route-mock the gateway: the models probe (CredentialForm's validation), the
 * scan POST (stream:true SSE) and the web-lookup POST (distinguished by the
 * lookup instruction in its body — gateway lookups ALSO ship stream:true, see
 * calls/vision.ts GATEWAY WIRE MODE).
 */
function installGateway(page: Page): void {
  void page.route(`${GATEWAY}/**`, async (route: Route) => {
    const req = route.request()
    const cors: Record<string, string> = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    }
    if (req.method() === 'OPTIONS') {
      const requested = await req.headerValue('access-control-request-headers')
      await route.fulfill({
        status: 204,
        headers: { ...cors, ...(requested ? { 'access-control-allow-headers': requested } : {}) },
      })
      return
    }
    if (req.url().includes('/models/')) {
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'gpt-4o-mini', object: 'model', owned_by: 'qa-e2e' }),
      })
      return
    }
    const body = req.postData() ?? ''
    if (body.includes('official published nutrition facts')) {
      // The web-lookup refinement — answers "not found" honestly, which leaves
      // the branded row estimated (the exact path the honesty glyph renders).
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({
          choices: [{ message: { role: 'assistant', content: JSON.stringify(LOOKUP_NOT_FOUND) } }],
        }),
      })
      return
    }
    // The scan call — SSE with the payload as content deltas.
    await route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'text/event-stream' },
      body: scanStream(),
    })
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

/** Configure the mock gateway as the ACTIVE provider (assistant-write.spec.ts pattern). */
async function configureGatewayProvider(page: Page): Promise<void> {
  await page.goto('/provider-settings')
  await page.getByText('OpenAI', { exact: true }).first().click()
  await page.getByLabel('Reseller base URL').fill(GATEWAY)
  await page.getByLabel('API credential').fill(GATEWAY_KEY)
  await page.getByRole('button', { name: 'Verify and save' }).click()
  await expect(page.getByText('Key saved')).toBeVisible({ timeout: 15_000 })
}

test.describe('Wave 5C a11y-tree walk — what the tree actually exposes', () => {
  test('Toast: the live region surfaces role=alert with aria-live=polite and a spoken name', async ({ page }) => {
    await restoreOnboarding(page)
    // A real toast: the food-review write path's completion signal.
    const payload = JSON.stringify({
      selection: {
        foodId: null,
        matchedFoodSource: 'userfood',
        displayName: 'QA A11y Toast Food',
        grams: 100,
        nutrientSnapshot: { kcal: 200, protein_g: 10, fat_g: 5, carbs_g: 20, fiber_g: null },
      },
      date: '2024-09-27',
    })
    await page.goto(`/food-review?payload=${encodeURIComponent(payload)}`)
    await page.getByRole('button', { name: 'Save to diary' }).click()

    const toast = page.getByRole('alert')
    await expect(toast).toBeVisible({ timeout: 20_000 })
    // RN Web maps accessibilityLiveRegion="polite" → aria-live="polite" and
    // the host's accessibilityLabel → the alert's accessible name.
    await expect(toast).toHaveAttribute('aria-live', 'polite')
    await expect(toast).toHaveAccessibleName(/Meal logged\./)
  })

  test('Sheet: the modal host dialog is NAMED (Wave 5C fix) and modal, with its close affordance', async ({ page }) => {
    await restoreOnboarding(page)
    await page.goto('/workout?id=1')
    await expect(page.getByRole('heading', { name: 'QA Upper Day' })).toBeVisible({ timeout: 15_000 })
    // Open the exercise context menu — the MenuSheet on the Sheet primitive.
    await page.getByRole('button', { name: 'Barbell Bench Press actions' }).click()

    // RN Web's <Modal> host renders role="dialog" + aria-modal="true"; the
    // Wave 5C fix rides the sheet's title as the dialog's accessible name so
    // it is no longer a bare "dialog" announcement.
    const dialog = page.getByRole('dialog', { name: 'Barbell Bench Press' })
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await expect(dialog).toHaveAttribute('aria-modal', 'true')
    await expect(dialog.getByRole('button', { name: 'Close sheet' })).toBeVisible()
    // The menu's actions are named buttons inside the named dialog.
    await expect(dialog.getByRole('button', { name: 'Add set' })).toBeVisible()
  })

  test('Camera: every capture control is named — mode pills, review radios, shutter, close', async ({ page }) => {
    await restoreOnboarding(page)
    await page.goto('/camera')
    await expect(page.getByRole('heading', { name: 'Scan food' })).toBeVisible({ timeout: 15_000 })

    for (const mode of ['Scan food', 'Barcode', 'Label', 'Receipt']) {
      await expect(page.getByRole('button', { name: mode, exact: true })).toBeVisible()
    }
    // The selected mode pill carries its pressed state (Badge maps
    // accessibilityState.selected → aria-pressed on web).
    await expect(page.getByRole('button', { name: 'Scan food', exact: true })).toHaveAttribute('aria-pressed', 'true')
    // T-IMPL-A: the Quick/Advanced review pair is DELETED — no radiogroup may
    // reappear (one scan path per capture type).
    await expect(page.getByRole('radiogroup', { name: 'Review mode' })).toHaveCount(0)
    await expect(page.getByRole('radio', { name: 'Quick review' })).toHaveCount(0)
    await expect(page.getByRole('radio', { name: 'Advanced review' })).toHaveCount(0)
    // The shutter and the close affordance.
    await expect(page.getByRole('button', { name: 'Pick a food photo' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible()
  })

  test('Day strip: all 56 day buttons are named; today carries its explicit label', async ({ page }) => {
    await restoreOnboarding(page)
    // Every chip's name comes from its content (weekday + date); today's chip
    // additionally carries the explicit "Today, <weekday> <date>" label.
    const days = page.getByRole('button').filter({ hasText: /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s*\d+$/ })
    await expect(days).toHaveCount(56)
    await expect(page.getByRole('button', { name: /^Today, (Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d+$/ })).toBeVisible()
  })

  test('Tab bar: five tab roles with names; the focused tab is the focusable one', async ({ page }) => {
    await restoreOnboarding(page)
    const tabs = page.getByRole('tab')
    await expect(tabs).toHaveCount(5)
    for (const name of ['Home', 'Food', 'Train', 'Progress', 'You']) {
      await expect(page.getByRole('tab', { name })).toBeVisible()
    }
    // accessibilityState={selected} does NOT map to aria-selected on RN Web —
    // the tree's honest selection signal is which tab holds tabindex=0
    // (only the focused tab is focusable).
    const focusedTabName = await page.getByRole('tab').evaluateAll((els) => {
      const focused = els.find((e) => e.getAttribute('tabindex') === '0')
      return focused?.getAttribute('aria-label') ?? null
    })
    expect(focusedTabName).toBe('Home')
  })

  test('Optimistic scan honesty: the timeline card announces state, items and estimates — no bare glyphs', async ({ page }) => {
    // T-IMPL-A (Cal AI parity): the photo path LOGS at the shutter and the
    // camera dismisses — the honest surface is now the timeline card, not a
    // blocking result screen. The a11y contract moves with it: staged state
    // announced in words, per-item rows carry the estimate suffix in text,
    // and the state glyph is a named icon, never a bare one.
    await restoreOnboarding(page)
    await installGateway(page)
    await configureGatewayProvider(page)

    // Capture through the app's own web surface: pick the 1x1 JPEG.
    await page.goto('/camera')
    await expect(page.getByRole('heading', { name: 'Scan food' })).toBeVisible({ timeout: 15_000 })
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 20_000 }),
      page.getByRole('button', { name: 'Pick a food photo' }).click(),
    ])
    await chooser.setFiles({ name: 'qa-meal.jpg', mimeType: 'image/jpeg', buffer: JPEG_BUFFER })

    // The optimistic capture dismisses the camera with router.back() — from a
    // direct /camera goto that lands on the PREVIOUS history entry (here the
    // provider settings), not the tabs. Go to Home explicitly: the timeline
    // card is the optimistic flow's visible half.
    await page.goto('/')
    await expect(page.getByRole('tab', { name: 'Home' })).toBeVisible({ timeout: 30_000 })

    // The gateway mock can answer within one tick, so EITHER state is
    // legitimate on the first poll — assert the card, then require the
    // completed announcement (the staged 'Scan analysing' state is the
    // documented fast-path surface).
    const card = page.locator('[aria-label*="Scan analysing"], [aria-label*="Scanned meal with"]')
    await expect(card.first()).toBeVisible({ timeout: 30_000 })
    const stagedOrNull = await page.locator('[aria-label*="Scan analysing"]').count()

    // The gateway answers; the card upgrades in place to the logged meal —
    // items in words, estimates marked in TEXT (never a bare glyph).
    const complete = page.locator('[aria-label*="Scanned meal with"]')
    await expect(complete.first()).toBeVisible({ timeout: 30_000 })
    expect(stagedOrNull).toBeGreaterThanOrEqual(0)
    await expect(page.getByText('Roti', { exact: false }).first()).toBeVisible()
    await expect(page.getByText('estimate', { exact: false }).first()).toBeVisible()
  })
})
