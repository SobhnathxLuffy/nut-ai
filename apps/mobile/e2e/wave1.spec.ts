import { test, expect } from '@playwright/test';

// ==================================================
// WAVE 1 FIX VALIDATION E2E (Playwright Snippets)
// ==================================================

test.describe('BUG-002: Onboarding Dead End', () => {
  test('Continue button has a hint label when disabled on OptionScreen', async ({ page }) => {
    // Navigate to a single-option screen like /onboarding/sex
    await page.goto('/onboarding/sex');

    // Button should be visible but disabled initially
    const continueBtn = page.getByRole('button', { name: 'Continue' });
    await expect(continueBtn).toBeDisabled();

    // Explicitly check for the new hint label
    const hintLabel = page.getByText('Select an option to continue');
    await expect(hintLabel).toBeVisible();

    // Selecting an option should enable the CTA. OptionScreen renders options
    // with accessibilityRole="radio", not "button".
    await page.getByRole('radio', { name: 'Female' }).click();
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
  // P2-13 triage (QA Wave 4): ticketed skip, not a silent fixme. Blocker:
  // reaching Home requires a COMPLETED onboarding state, and a fresh
  // Playwright profile is redirected into onboarding before '/' ever renders
  // the DayStrip. Activation condition: a state-seeding harness (drive the
  // real onboarding flow, or seed the user DB kv flag from qa-backup.json).
  // Until then the DayStrip history is guarded by unit tests, and the skip
  // stays visible in every report as `test.skip` with this reason.
  test.skip('Home screen DayStrip includes 56 days of history instead of just 7', async ({ page }) => {
    await page.goto('/');

    // We can't easily scroll horizontally in simple assertions, but we can assert
    // that there are many more days rendered than a single week.
    const _dayButtons = page.locator('div[role="button"]:has-text("Sun"), div[role="button"]:has-text("Mon")').first();
    // Assuming Playwright treats the Pressables as accessible roles
    const allDays = page.getByRole('button');
    const dayCount = await allDays.count();
    
    // There should be > 7 day buttons rendered in the new DayStrip
    expect(dayCount).toBeGreaterThan(7);
  });
});

test.describe('BUG-009: Workout Load Units', () => {
  // P2-13 triage (QA Wave 4): ticketed skip, not a silent fixme. Blockers:
  // (a) an active workout session — the set editor only exists after
  // launching a routine — and (b) an accessibility label on the load input
  // ('Load (lb)') the current editor does not expose. Activation condition: a
  // workout-seeding harness (qa-backup.json) + the a11y label. The kg
  // conversion itself IS covered by workout-units unit tests.
  test.skip('Workout set editor converts user lb input into canonical kg storage seamlessly', async ({ page }) => {
    // Note: Since this is an E2E snippet, we're stubbing the flow for the test logic.
    await page.goto('/workout');

    // Assume weight unit preference is already set to lb
    const loadInput = page.getByLabel('Load (lb)');
    await expect(loadInput).toBeVisible();

    // Fill the input with '100' lb
    await loadInput.fill('100');
    
    // Check that the input still displays '100' (instead of dropping digits or re-converting weirdly)
    await expect(loadInput).toHaveValue('100');

    // Further E2E checks would submit and verify the SQLite storage, which our Vitest unit test already covers!
  });
});
