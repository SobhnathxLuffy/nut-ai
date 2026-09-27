# Web P0 Fixes — WEB-003 / 005 / 006 / 007 / 008 / 009 / 010

Status: fixed, all gates green (612/612 unit tests, typecheck, lint 0 warnings,
node-purity 18/18). WEB-001, WEB-002 and WEB-011 were fixed earlier in
`f0ae3b0`; this round closes every remaining P0 from the web QA backlog.

---

## WEB-003 — Dish composer wrote household variants into a read-only DB

**Was:** `logDish()` in `app/dish-composer.tsx` INSERTed the user's "My
Version" dish into the nutrition corpus database. On web that database is
deserialized with `SQLITE_DESERIALIZE_READONLY` (`src/db/expo-adapter.web.ts`),
so every save threw, the error was swallowed by a bare `catch`, and the user
got a success-looking flow with **nothing persisted** — a false save on a
trusted-nutrition surface.

**Fix:**
- Household variants are user data and now live in the **writable user DB**
  (`openUserDb()`), with the table created idempotently (`ensureUserDishTable`).
- Failures now alert instead of vanishing; the screen also renders its error
  state instead of silently staying blank.
- Reading a dish by id checks the user DB first (household variants), then the
  corpus (curated/draft definitions).
- `app/indian-dishes.tsx` merges user-DB household variants into the listing
  (deduped, name-sorted) so a saved variant is actually retrievable. A save
  that can never be found again is still a false save.

**Files:** `apps/mobile/app/dish-composer.tsx`, `apps/mobile/app/indian-dishes.tsx`

---

## WEB-005 — User DB backed by localStorage hit the 5MB quota

**Was:** `openUserDb()` used sqlite-wasm's `JsStorageDb`, which backs SQLite
onto localStorage. localStorage is capped at ~5MB per origin; the user DB is
the one store that grows forever (meals, workouts, undo journal). Hitting the
quota turned every write into a `QuotaExceededError` and silently lost data.

**Fix:** the user DB now prefers the **OPFS VFS** (`oo1.OpfsDb('/nutai-user.db')`),
whose quota is effectively gigabytes. `serve-3000.py` already ships the
COOP/COEP headers OPFS requires. A one-time, fully guarded migration
(`sqlite3_js_db_export` → `OpfsDb.importDb`) moves existing localStorage
databases; the legacy copy is only purged **after** a verified import, and any
failure leaves it untouched. Without OPFS the code falls back to the old
JsStorageDb behavior.

**Files:** `apps/mobile/src/db/expo-adapter.web.ts`

---

## WEB-006 — API keys stored in sessionStorage, lost on every refresh

**Was:** `credentials.web.ts` kept provider keys in `sessionStorage`: closed
tab or F5 = keys gone, user dumped back into onboarding with a valid key they
still own.

**Fix:** keys live in **localStorage** (survives refresh, shared across tabs of
the same origin). A one-time promotion path copies any legacy sessionStorage
key into localStorage on first load and purges the old copy, so nobody re-enters
a key after upgrading and the key never exists in two places. `clearCredential`
wipes both stores. This is still browser storage, not mobile SecureStore — the
trade-off is documented in the module header; losing the key every refresh was
strictly worse for a local-first app whose keys never leave the device except
to the provider the user named.

**Files:** `apps/mobile/src/inference/credentials.web.ts`

---

## WEB-007 — Cross-provider fallback hardcoded expired model snapshots

**Was:** `runAssistantChatApi` fell back to hardcoded model ids, including
`claude-3-5-sonnet-20240620` — a dated snapshot Anthropic has since retired.
The "safe" fallback path failed with model-unavailable long after the primary
error. Separately, a fallback provider **without a saved key** returned
"No credentials for X" and **aborted the whole chain** instead of being skipped.

**Fix:**
- Fallback models are derived from the live catalogue via
  `cheapestModel(provider)` — a model change now lands in exactly one place:
  `PROVIDER_MODELS` in `@nutai/prompt`. No dates, nothing to expire silently.
- Chain semantics: a definitive rejection on the **primary** (rejected key,
  unknown model) still short-circuits so the real problem stays visible;
  a fallback provider missing a key is now *skipped*, not fatal; the primary's
  own error is the one surfaced if everything else fails.

**Files:** `apps/mobile/src/inference/pathA/client.ts` (existing
`provider-fallback.test.ts` still passes: 1-call short-circuit and
2-call fallback behavior preserved)

---

## WEB-008 — Assistant routine save was a `console.log` stub

**Was:** `applyProposal('propose_workout_routine')` in
`src/inference/pathA/assistant.ts` only logged. The UI flipped the proposal
card to "SAVED" while nothing was written — a false save on a write action,
the exact class the P0 definition calls out.

**Fix:** applying a routine proposal now:
1. matches each proposed exercise against the user's exercise library
   (case-insensitive; unmatched names are skipped and reported),
2. builds a schema-valid `RoutineInput` — `"sets": 3` counts and `"8-12"`
   rep ranges are resolved to concrete planned sets, with rep/load defaults
   only where the tracking type allows them and **never inventing numbers the
   model did not provide** (a distance exercise with no distance is skipped,
   not guessed),
3. persists via `saveRoutine` from `@nutai/training`, which validates every
   planned set against the exercise's tracking type, and
4. **throws on failure** so the UI shows FAILED instead of a fake success.

Meal proposals remain intentionally handled by the food-review flow; applying
them here now throws an explanatory error instead of logging.

**Files:** `apps/mobile/src/inference/pathA/assistant.ts`

---

## WEB-009 — e2e suite existed but nothing ever ran it

**Was:** `apps/mobile/e2e/wave1.spec.ts` shipped with no Playwright config and
no CI job. Zero executions = zero regression protection.

**Fix:**
- `apps/mobile/playwright.config.ts`: serves the exported web bundle through
  `serve-3000.py` (COOP/COEP + SPA fallback), baseURL wired, traces retained
  on failure, CI retries capped at 2.
- `.github/workflows/web-e2e.yml`: on every push/PR to main — typecheck, unit
  tests, node purity, lint, then `expo export --platform web` → Playwright
  chromium run against the real bundle; traces uploaded as artifacts on failure.
- Also fixed the latent `vitest.config.ts` gap: `@nutai/indian-dishes` was
  missing from the source-alias map, so any environment without a built
  `dist/` failed 14 test suites (CI would have hit the same wall).

**Files:** `apps/mobile/playwright.config.ts`, `.github/workflows/web-e2e.yml`,
`vitest.config.ts`

---

## WEB-010 — Native module audit (web bundle safety)

Verified how every native-only module is kept out of the web bundle:

| Module | Where | Web safety mechanism | Verdict |
| --- | --- | --- | --- |
| `expo-sqlite` | `src/db/expo-adapter.ts` | Metro platform override: `expo-adapter.web.ts` replaces the whole file on web | SAFE |
| `expo-secure-store` | `src/inference/credentials.ts` | Platform override: `credentials.web.ts` | SAFE |
| `expo-haptics` | `src/components/onboarding/Controls.tsx` | Ships a web implementation (no-op wrappers) | SAFE |
| `expo-camera` | `app/camera.tsx` | Ships a web implementation (`getUserMedia`) | SAFE |
| `expo-file-system` | only `src/scan/photo-privacy.test.ts` | Node-side test only, never in the app bundle | SAFE |
| HealthKit adapter | `src/health/healthkit.ts` | Dynamic `import()` guarded behind platform check | SAFE |
| `expo-asset` | `src/db/expo-adapter.web.ts` | `require()` inside async fn, web-only path | SAFE |
| `Alert.alert` | ~25 call sites | `src/ui/alert-web.ts` shim imported in `app/_layout.tsx` | SAFE |

No unguarded native imports found at module scope on any web-reachable path.
This audit should be re-run whenever a new native capability lands: the rule
is "platform override file or guarded dynamic import, never a bare top-level
import of a native-only module".
