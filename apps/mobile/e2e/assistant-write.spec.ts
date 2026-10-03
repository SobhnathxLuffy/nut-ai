import { test, expect, type Page, type Route } from '@playwright/test'
import * as path from 'path'

/**
 * Wave 5B (O10) — the assistant WRITE path, end to end in a real browser.
 *
 * AGENTS §9.3 warned these flows were never e2e-tested: "assistant chat/write
 * flows remain NOT TESTED end-to-end". These specs close that by driving the
 * app's own surfaces with a route-mocked gateway:
 *
 *   - The gateway is a fake OpenAI-compatible reseller
 *     (https://mock-gateway.test/v1) intercepted with page.route — never a
 *     real provider, never a real key. CORS + the OPTIONS preflight are
 *     fulfilled exactly as a real gateway would.
 *   - Provider state is seeded through the app's OWN provider-settings screen
 *     (Verify and save), because the `provider` setting lives in the SQLite
 *     settings table — unreachable from localStorage seeding — and the key +
 *     base URL write is the CredentialForm path real users take. The
 *     validation probe (GET {base}/models/{id}) is mocked to 200.
 *   - The chat reply is an SSE stream whose content deltas reassemble into a
 *     propose_meal tool call. The arguments match ProposeMealArgsZ
 *     (@nutai/core-schema assistant.ts) byte-for-byte: {name, ingredients:
 *     [{name, grams, unit_count?}]}. kcal/macros are deliberately NOT in the
 *     payload — the app never trusts model-claimed numbers; resolveMealProposal
 *     computes them from the shipped corpora (toor dal → dish KB Toor Dal
 *     104.07 kcal/100 g; roti → Tandoori Roti 253.27 kcal/100 g).
 *
 * Journeys: confirm (the meal REALLY persists + undo), cancel (nothing
 * logged), honest failure (500 on every chat call → the real error in the
 * bubble, no fake success). Plus the C2-P2-6 hit-test at 390×844.
 */

const BACKUP = path.join(__dirname, 'fixtures', 'qa-backup.json')

const GATEWAY = 'https://mock-gateway.test/v1'
const GATEWAY_KEY = 'sk-qa-mock-gateway-e2e-key-0123456789'

/** The exact propose_meal tool call, matching AssistantToolCallZ. */
const TOOL_JSON = JSON.stringify({
  tool_name: 'propose_meal',
  arguments: {
    name: 'Post-workout dal chawal',
    ingredients: [
      { name: 'toor dal', grams: 150 },
      { name: 'roti', grams: 40, unit_count: 2 },
    ],
  },
})

/**
 * Deterministic kcal the corpus resolution produces (node-verified against the
 * shipped assets): toor dal 150 g × 104.066 = 156.1; roti 2 × 40 g × 253.267
 * = 202.6; total 358.7 → dayTotals rounds to 359, the review footer to 359.
 */
const EXPECTED_KCAL = 359

function sseData(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`
}

/** SSE stream: role opener, the tool JSON split across content deltas (the parser must reassemble), finish + usage, [DONE]. */
function proposeMealStream(): string {
  const chunks = [TOOL_JSON.slice(0, 40), TOOL_JSON.slice(40, 96), TOOL_JSON.slice(96)]
  return [
    sseData({ choices: [{ delta: { role: 'assistant' } }] }),
    ...chunks.map((content) => sseData({ choices: [{ delta: { content } }] })),
    sseData({ choices: [{ delta: {} }, { finish_reason: 'stop' }], usage: { prompt_tokens: 25, completion_tokens: 40 } }),
    'data: [DONE]\n\n',
  ].join('')
}

type GatewayMode = 'propose' | 'fail'

interface ChatPost {
  auth: string | null
  stream: boolean
}

/**
 * Route-mock the whole gateway. Mode is read per-request through the getter so
 * a test can flip it; chat POSTs are recorded for wire-level assertions.
 */
function installGateway(page: Page, mode: () => GatewayMode, chatPosts: ChatPost[]): void {
  void page.route(`${GATEWAY}/**`, async (route: Route) => {
    const req = route.request()
    // CORS: the app origin (127.0.0.1:3000) differs from the gateway host, so
    // every fulfilled response carries the allow-origin header and the
    // preflight (Authorization + content-type are non-simple) is answered.
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
      // CredentialForm's validation probe (validateThroughGateway).
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'gpt-4o-mini', object: 'model', owned_by: 'qa-e2e' }),
      })
      return
    }
    // POST /v1/chat/completions — the assistant's chat call.
    const body = req.postData() ?? ''
    chatPosts.push({ auth: await req.headerValue('authorization'), stream: body.includes('"stream":true') })
    if (mode() === 'fail') {
      // Honest failure: the gateway's own message must survive into the UI.
      await route.fulfill({
        status: 500,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({ error: { message: 'QA gateway exploded' } }),
      })
      return
    }
    if (body.includes('"stream":true')) {
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'text/event-stream' },
        body: proposeMealStream(),
      })
      return
    }
    // Legacy non-streaming fallback (only reached if the stream failed): the
    // same tool call in a chat-completions envelope.
    await route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: TOOL_JSON } }] }),
    })
  })
}

/** The onboarding gate helper (wave3.spec.ts conventions) — a completed profile first. */
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

/**
 * Configure the mock gateway as the ACTIVE provider through the app's own
 * settings screen. Seeding rule: the `provider`/`provider_model`/
 * `provider_base_url` settings live in the SQLite settings table (not
 * localStorage), so the CredentialForm "Verify and save" write IS the seeding
 * mechanism; only the key would have been seedable via localStorage, and
 * taking the real UI path exercises the same code users run.
 */
async function configureGatewayProvider(page: Page, mode: () => GatewayMode, chatPosts: ChatPost[]): Promise<void> {
  installGateway(page, mode, chatPosts)
  await page.goto('/provider-settings')
  await page.getByText('OpenAI', { exact: true }).first().click()
  await page.getByLabel('Reseller base URL').fill(GATEWAY)
  await page.getByLabel('API credential').fill(GATEWAY_KEY)
  await page.getByRole('button', { name: 'Verify and save' }).click()
  await expect(page.getByText('Key saved')).toBeVisible({ timeout: 15_000 })
}

/** Open the assistant on a fresh transcript and send one message. */
async function sendAssistantMessage(page: Page, text: string): Promise<void> {
  await page.goto('/assistant')
  await expect(page.getByText('Ask anything')).toBeVisible({ timeout: 20_000 })
  await page.getByPlaceholder(/Ask about your food/).fill(text)
  await page.getByRole('button', { name: 'Send' }).click()
}

test.describe('O10: assistant write path — propose_meal confirmed', () => {
  test('streamed tool call renders the proposal card; Confirm persists a real meal; undo removes it', async ({ page }) => {
    const mode: GatewayMode[] = ['propose']
    const chatPosts: ChatPost[] = []
    await restoreOnboarding(page)
    await configureGatewayProvider(page, () => mode[0]!, chatPosts)

    await sendAssistantMessage(page, 'Plan my post-workout meal')

    // The proposal card, parsed out of the STREAMED tool-call JSON.
    await expect(page.getByText('Meal Proposal: Post-workout dal chawal')).toBeVisible({ timeout: 20_000 })
    // Unit-count aware ingredient lines (expandProposalIngredients).
    await expect(page.getByText('toor dal — 150 g')).toBeVisible()
    await expect(page.getByText('roti — 2 × 40 g')).toBeVisible()

    // Wire-level proof: the chat POST carried the configured key and was a
    // real streaming request to the configured gateway.
    expect(chatPosts.length).toBeGreaterThanOrEqual(1)
    expect(chatPosts[0]!.stream).toBe(true)
    expect(chatPosts[0]!.auth).toBe(`Bearer ${GATEWAY_KEY}`)

    // Confirm — resolveMealProposal resolves both ingredients against the
    // shipped corpora and routes to the food review screen. (exact: the cancel
    // button's aria-label contains 'review & save' too.)
    await page.getByRole('button', { name: 'Review & Save', exact: true }).click()
    await expect(page.getByText('Review food')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByLabel('Food name')).toHaveValue('Post-workout dal chawal')
    // kcal/macros are COMPUTED from the corpus (the tool payload carried
    // none — the app never logs model-claimed numbers): 359 kcal for the
    // 230 g meal, with the P/C/F line beside it.
    await expect(page.getByText(`${EXPECTED_KCAL} kcal`)).toBeVisible()
    await expect(page.getByText(/P: \d+(\.\d+)?g · C: \d+(\.\d+)?g · F: \d+(\.\d+)?g/)).toBeVisible()

    // THE WRITE: Save to diary persists the meal (logManualMealWithItems —
    // 3 rows, an operation record, undoable).
    await page.getByRole('button', { name: 'Save to diary' }).click()
    await expect(page.getByText('Meal logged.')).toBeVisible({ timeout: 20_000 })

    // Back on the assistant, the card's badge is the honest terminal state:
    // food-review wrote assistantGlobalStatus[msgId] = 'SAVED' only AFTER the
    // write completed — a failed save leaves it at FAILED, never a fake
    // "Saved" (WEB-008 class).
    await expect(page.getByText('AI Assistant')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 15_000 })

    // Persistence proof on Home: the timeline meal row + the eaten kcal ring
    // read the meal back OUT of the database.
    await page.getByRole('button', { name: 'Close assistant' }).click()
    await expect(page.getByRole('tab', { name: 'Home' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('toor dal, roti, roti')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(`${EXPECTED_KCAL}`, { exact: true }).first()).toBeVisible({ timeout: 15_000 })

    // Undo — the write is reversible (§10.1): the timeline's labeled undo
    // removes the meal and the day is empty again.
    await page.getByRole('button', { name: /^Undo: add meals/ }).click()
    await expect(page.getByText('No entries for this day yet.')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('toor dal, roti, roti')).toHaveCount(0)
  })
})

test.describe('O10: assistant write path — propose_meal cancelled', () => {
  test('Cancel leaves the card cancelled and the day empty — nothing is logged', async ({ page }) => {
    const mode: GatewayMode[] = ['propose']
    const chatPosts: ChatPost[] = []
    await restoreOnboarding(page)
    await configureGatewayProvider(page, () => mode[0]!, chatPosts)

    await sendAssistantMessage(page, 'Plan my post-workout meal')
    await expect(page.getByText('Meal Proposal: Post-workout dal chawal')).toBeVisible({ timeout: 20_000 })

    // Cancel: proposal ≠ persistence (§9.3). No food-review, no write.
    await page.getByRole('button', { name: 'Cancel this review & save proposal' }).click()
    await expect(page.getByText('Cancelled', { exact: true })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: 'Review & Save', exact: true })).toHaveCount(0)

    // The day stays empty: Home's timeline has no meal and no meal logged.
    await page.getByRole('button', { name: 'Close assistant' }).click()
    await expect(page.getByRole('tab', { name: 'Home' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('No entries for this day yet.')).toBeVisible({ timeout: 15_000 })
  })
})

test.describe('O10: assistant write path — honest failure', () => {
  test('a 500 gateway shows the real error in the bubble — no proposal card, no fake success', async ({ page }) => {
    const mode: GatewayMode[] = ['fail']
    const chatPosts: ChatPost[] = []
    await restoreOnboarding(page)
    await configureGatewayProvider(page, () => mode[0]!, chatPosts)

    await sendAssistantMessage(page, 'Plan my post-workout meal')

    // The stream fails AND the legacy non-streaming fallback chain fails —
    // every chat POST returns 500. The placeholder bubble becomes the error
    // bubble carrying the gateway's own message (P3-A2: one bubble, not two).
    await expect(page.getByText('QA gateway exploded (HTTP 500)')).toBeVisible({ timeout: 30_000 })
    // The fallback chain really engaged (stream + at least the primary
    // non-streaming retry).
    expect(chatPosts.length).toBeGreaterThanOrEqual(2)
    expect(chatPosts.some((p) => !p.stream)).toBe(true)

    // No fake success of any kind: no proposal card, no save, no toast.
    await expect(page.getByText('Meal Proposal:')).toHaveCount(0)
    await expect(page.getByText('Saved', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Meal logged.')).toHaveCount(0)
    // The assistant is usable again — the input row never locks up.
    await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled()

    // And nothing reached the diary.
    await page.getByRole('button', { name: 'Close assistant' }).click()
    await expect(page.getByRole('tab', { name: 'Home' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('No entries for this day yet.')).toBeVisible({ timeout: 15_000 })
  })
})

test.describe('C2-P2-6: the Provider & key row is tappable at 390×844', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('Profile tab → the Provider & key row opens its screen (not permanently covered)', async ({ page }) => {
    await restoreOnboarding(page)
    await page.getByRole('tab', { name: 'You' }).click()
    const row = page.getByRole('button', { name: 'Provider & key' })
    await expect(row).toBeVisible({ timeout: 15_000 })
    // Playwright's click performs the actionability hit-test: it FAILS when
    // another element permanently intercepts pointer events on the row. The
    // click itself is the test.
    await row.click()
    // The screen's own close control — unambiguous proof the provider-settings
    // screen opened (the Profile tab behind the stack ALSO renders an
    // 'AI provider' group title, so the title text alone is ambiguous).
    await expect(page.getByRole('button', { name: 'Close provider settings' })).toBeVisible({ timeout: 15_000 })
  })
})
