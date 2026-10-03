import { defineConfig } from '@playwright/test'

/**
 * WEB-009: the e2e suite existed but nothing ever ran it — no local config,
 * no CI job. This config serves the exported web bundle (apps/mobile/dist)
 * through serve-3000.py, which provides the COOP/COEP headers the SQLite-WASM
 * database requires plus the SPA fallback for deep links.
 *
 * Locally:   npx expo export --platform web && npx playwright test
 * In CI:     .github/workflows/web-e2e.yml does export -> serve -> test.
 */
export default defineConfig({
  testDir: './e2e',
  // Wave 5A: Playwright owns the .spec.ts journeys; the .test.ts file under
  // e2e/fixtures is the vitest-side fixture invariant (root vitest.config.ts
  // includes it). Without this, Playwright's default testMatch also picks up
  // *.test.ts and fails to load it as a CommonJS spec.
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  fullyParallel: false,
  // A green e2e suite in CI is the point of WEB-009; retries exist to absorb
  // wasm/database boot jitter, not to hide real failures.
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'python3 serve-3000.py',
    url: 'http://127.0.0.1:3000',
    cwd: __dirname,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
