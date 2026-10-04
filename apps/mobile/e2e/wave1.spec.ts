import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';

// ==================================================
// WAVE 1 FIX VALIDATION E2E (Playwright Snippets)
// ==================================================
//
// BUG-007 and BUG-009 were P2-13 ticketed skips (QA Wave 4 triage): both were
// blocked on a state-seeding harness, not on missing app behaviour. Wave 5A
// closed them: the enriched qa-backup.json fixture (see
// e2e/fixtures/fixture-invariant.test.ts for its invariants) restores a
// completed profile — goals, an ACTIVE workout, lb units — so both journeys
// now run against the restored state through the app's real paths.

const BACKUP = path.join(__dirname, 'fixtures', 'qa-backup.json')

/** The restore-backup state-seeding harness (wave3/wave4 pattern). */
async function restoreOnboarding(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Restore from a backup' }).click();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 20_000 }),
    page.getByText('Choose backup file').click(),
  ]);
  await chooser.setFiles(BACKUP);
  await expect(page.getByText('Backup found')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  const dialog = page.locator('[role="alertdialog"]');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByRole('tab', { name: 'Home' })).toBeVisible({ timeout: 30_000 });
}

test.describe('BUG-002: Onboarding Dead End', () => {
  test('the single-page form gates its CTA until every required question is answered', async ({ page }) => {
    // Owner QA 2026-10: onboarding is ONE page — every question from the old
    // 12-step flow is a section with ONE Continue ("See my plan"). The gate
    // semantics survive: the CTA stays disabled until EVERY required field
    // has an answer, with the hint visible the whole time. Same-labelled
    // Yes/No pairs (professional vs rollover) are scoped by radiogroup.
    await page.goto('/onboarding');

    // Button should be visible but disabled initially
    const continueBtn = page.getByRole('button', { name: 'See my plan' });
    await expect(continueBtn).toBeDisabled();

    // Explicitly check for the gate hint (every required question must be answered)
    const hintLabel = page.getByText('Answer every question to continue');
    await expect(hintLabel).toBeVisible();

    const aboutYou = page.getByRole('radiogroup', { name: /personal trainer or registered dietitian/ }).first();
    // Selecting one option is not enough: the button stays disabled until
    // every required group has an answer.
    await page.getByRole('radio', { name: 'Female' }).click();
    await expect(continueBtn).toBeDisabled();

    await page.getByRole('radio', { name: '3-5' }).click();
    await expect(continueBtn).toBeDisabled();

    // Options render with accessibilityRole="radio", not "button". NOTE
    // exact + radiogroup scope: 'No' is a substring of "Workouts now and
    // then" under Playwright's default partial match, and the single page
    // has a SECOND No (the rollover group).
    await aboutYou.getByRole('radio', { name: 'No', exact: true }).click();
    // About-you done — but diet, accomplish, rollover and provider are still open.
    await expect(continueBtn).toBeDisabled();

    await page.getByRole('radio', { name: 'Balanced' }).click();
    await page.getByRole('radio', { name: 'Lack of consistency' }).click();
    await page.getByRole('radio', { name: 'Eat and live healthier' }).click();
    await page
      .getByRole('radiogroup', { name: /Rollover/ })
      .getByRole('radio', { name: 'Yes', exact: true })
      .click();
    await page.getByRole('radio', { name: 'No key for now' }).click();
    await expect(continueBtn).toBeEnabled();
  });
});

test.describe('BUG-004: Silent Failure on Bad Deep Links', () => {
  test('Invalid food-review payload renders an explicit error boundary state instead of crashing/redirecting', async ({ page }) => {
    // Visit food-review with a deliberately malformed payload
    // A payload without nutrientSnapshot would previously cause a fatal unhandled JS error, resetting the app route.
    const badPayload = JSON.stringify({ selection: { displayName: 'Crash Test', grams: 100 } }); 
    await page.goto(`/food-review?payload=${encodeURIComponent(badPayload)}`);

    // We expect the explicit error boundary message rather than a redirect to Onboarding
    // (Wave 3 copy pass: the message now states the cause and the way out).
    const errorText = page.getByText('damaged data and cannot be opened');
    await expect(errorText).toBeVisible();

    // And a fallback 'Back' button should render
    const backBtn = page.getByRole('button', { name: 'Back' });
    await expect(backBtn).toBeVisible();
  });
});

test.describe('BUG-007: Historical Day Navigation Blocked', () => {
  // P2-13 ticket CLOSED (Wave 5A). Old blocker: a fresh Playwright profile
  // was redirected into onboarding before '/' ever rendered the DayStrip —
  // reaching Home requires a completed onboarding state. The restore-backup
  // harness (wave3/wave4 pattern) now marks onboarding complete, and the
  // restored goals row gives Home a real target to render (fixture shape
  // locked by e2e/fixtures/fixture-invariant.test.ts).
  test('Home DayStrip renders 56 days of history with a Today marker and disabled future days', async ({ page }) => {
    await restoreOnboarding(page);

    // A COLD visit to '/' lands on Home, not onboarding — the gate the skip
    // was blocked on.
    await page.goto('/');
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('tab', { name: 'Home' })).toBeVisible({ timeout: 30_000 });

    // The restored goals row is live: the hero reads a real target instead
    // of the skeleton placeholders.
    await expect(page.getByText(/kcal target/)).toBeVisible({ timeout: 15_000 });

    // The strip: 56 weekday-labelled day buttons — 8 Monday-first weeks, not
    // the 7 the ticket reported. Today's own textContent matches the same
    // weekday pattern; it is one of the 56.
    const dayButtons = page.getByRole('button').filter({ hasText: /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s*\d+$/ });
    await expect(dayButtons.first()).toBeVisible({ timeout: 15_000 });
    await expect(dayButtons).toHaveCount(56);

    // Today carries the explicit "Today, <Dow> <date>" accessibility label
    // and stays tappable.
    const today = page.getByRole('button', { name: /^Today, (Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d+$/ });
    await expect(today).toBeVisible();
    await expect(today).toBeEnabled();

    // Days after today render (the current week renders whole) but are
    // dimmed and disabled — you cannot log tomorrow. The expected count is
    // derived from the strip's own Today label, so a run that crosses
    // midnight between mount and assertion stays correct.
    const todayLabel = await today.getAttribute('aria-label');
    const parsed = /^Today, (Sun|Mon|Tue|Wed|Thu|Fri|Sat) (\d+)$/.exec(todayLabel ?? '');
    expect(parsed).not.toBeNull();
    const dow = (['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parsed![1]!) + 6) % 7;
    const futureDays = page.locator('button[aria-disabled="true"]').filter({ hasText: /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s*\d+$/ });
    await expect(futureDays).toHaveCount(6 - dow);

    // A past day is a real navigation target — since Wave 5A (O4) pressing a
    // strip day drills into the dedicated day-detail view for that date
    // (Home's inline selection stays synced for when you come back). The
    // first strip button is the oldest day in the 8-week window; its title
    // renders as the full weekday format, and the way back is the header.
    const oldest = await dayButtons.first().textContent();
    const parsedDay = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s*(\d+)$/.exec((oldest ?? '').trim());
    expect(parsedDay).not.toBeNull();
    await dayButtons.first().click();
    await expect(page).toHaveURL(/\/day-detail\?date=/, { timeout: 15_000 });
    await expect(
      page.getByRole('heading', { name: /(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\w*, \w+ \d+, \d{4}/ }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Back to home' }).click();
    await expect(page).toHaveURL('/');
    await expect(dayButtons).toHaveCount(56);
    await expect(today).toBeEnabled();
  });
});

test.describe('BUG-009: Workout Load Units', () => {
  // P2-13 ticket CLOSED (Wave 5A). Old blockers: (a) no 'Load (lb)'
  // accessibility label — the Wave 3 set-table rewrite had already added
  // unit-aware labels ('Load (lb) set N', mirrored in workout.tsx and
  // log-exercise.tsx via getFieldLabels(unit)); (b) no workout-seeded state —
  // the enriched qa-backup.json now restores an ACTIVE workout (id 1: Barbell
  // Bench Press, one completed + one open set) plus the lb unit preference.
  // The kg conversion arithmetic stays locked by the workout-units unit
  // tests; this journey proves the DISPLAY round-trip: lb in, canonical kg
  // stored, same lb digits back out.
  test('Workout set editor converts user lb input into canonical kg storage seamlessly', async ({ page }) => {
    await restoreOnboarding(page);

    // The seeded workout opens directly — the same screen the Train tab's
    // Resume button routes to.
    await page.goto('/workout?id=1');
    await expect(page.getByRole('heading', { name: 'QA Upper Day' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Barbell Bench Press', { exact: true })).toBeVisible();

    // The set editor exposes unit-aware a11y labels (blocker (a)).
    const load = page.getByLabel('Load (lb) set 2', { exact: true });
    await expect(load).toBeVisible();
    await expect(page.getByLabel('Reps set 2', { exact: true })).toBeVisible();

    // The seeded set carries 60 kg canonical; in lb units the editor READS it
    // back as 132.28 — display converts, storage stays kg.
    await expect(load).toHaveValue('132.28');

    // Filling 100 lb keeps '100' in the field — no digit-dropping, no
    // mid-typing reconversion.
    await load.fill('100');
    await expect(load).toHaveValue('100');

    // Completing the set writes through the real save path (lb → kg
    // canonical), and the refreshed row round-trips back to the same digits.
    await page.getByRole('button', { name: 'Complete set 2' }).click();
    await expect(load).toHaveValue('100');
    await expect(page.getByText('2/2 sets complete')).toBeVisible({ timeout: 15_000 });
  });
});
