# Release notes draft — v0.2.0 (versionCode 3)

Status: DRAFT for the coordinator. Nothing in this file is a shipped claim yet.
Prepared by T6-prep (release engineering). Companion changes already landed in
the working tree (uncommitted):

- `apps/mobile/app.config.ts`: `version: '0.2.0'`, `android.versionCode: 3`
  (upgrade-safe over the released versionCode 2 / apk-v0.1.1 APK — same stable
  CI upload key on both).
- `.github/workflows/build-apk.yml`: version/versionCode derived from
  `app.config.ts` at run time; APK filename, artifact paths, release tag/title
  and body versions all parametrized; SHA-256 checksum generated, uploaded as a
  second artifact and attached as a second release asset; tags matching
  `apk-*-rc*` publish as pre-releases.

**Before pushing the tag:** the changelog bullets inside the workflow's
`body:` still describe v0.1.1 (they were deliberately left structurally intact
by T6-prep). Replace them with the "GitHub Release notes body" section below —
in particular "Onboarding is ONE page" is no longer true in v0.2.0 and must not
ship.

---

## 1. Exact doc claim updates this wave requires

### AGENTS.md

1. **§0.1 baseline paragraph (line ~17):** replace the stale fully-gated
   baseline "1,595 tests (140 files), e2e 36 passed" with this wave's numbers
   (1,875 tests / 158 files; e2e 46/46 after the coordinator's central run).
   Keep the historical chain intact; keep "Re-run `npm run check` after any
   reinstall before quoting the number".
2. **§0.1 add feature bullets, each with its evidence class** (see §3 of this
   draft for the honest wording): step-by-step onboarding rebuild (supersedes
   the single-page collapse of `eef6071`), independent height/weight units,
   post-onboarding tutorial, local notifications, three Android widgets, Codex
   CLI local bridge, Home hero close-bounce fix, Routines jitter fix, routine
   editor/programs IA cleanup, offline barcode honesty (`BARCODE_OFFLINE`).
3. **§0.2 "Settings / Onboarding / Backup":** "onboarding remain partial" must
   be updated — the stepwise rebuild, tutorial and units decoupling are
   implemented and automatically verified; KEEP the device-verification caveat
   (TalkBack, 130%, real journey) as open. Keep "destructive restore/reset
   flows must not be tested casually against the owner's active data".
4. **§0.2 "Training":** add — Routines jitter root-caused (useFocusEffect
   identity loop) and fixed with a red-first regression lock; routine editor
   ships real advanced controls; programs are editable with weekday↔cycle
   conversion. KEEP "Training is not complete" and the Exercise Library device
   re-verification gate (still unreproduced since 2026-09-14).
5. **§0.2 "Home / Food UX":** add the hero close-bounce mechanism fix (single
   setExpanded writer, critically damped spring, rounded onLayout). The
   duplicate-press root cause stays INFERRED until the Samsung device pass —
   do not promote it to verified.
6. **§0.2 "AI / Photo":** add the Codex CLI bridge entry with the capability
   evidence classes from §2c below. Explicitly forbid claiming model routing,
   image understanding or successful completions (no credentials — NOT TESTED).
7. **§13 "Current reference baseline":** 140 files/1,595 → 158 files/1,875;
   e2e 36 → 46; note the new suites (tools/codex-bridge 36 tests,
   training-surface, routines-screen, notification handler/scheduler,
   wave3-screens additions).

### PLAN.md

1. Mark the wave items complete **with evidence classes**: onboarding rebuild,
   height/weight unit decoupling, tutorial, notifications, widgets, Codex CLI
   bridge, Home bounce fix, workout-mode/routine/program UX cleanup, jitter
   fix, offline barcode honesty, a11y audit remediations.
2. Update the current-baseline counts to 1,875 tests / 158 files / e2e 46/46.
3. Add the release row: v0.2.0 (versionCode 3) prepared — bump + parametrized
   workflow + SHA-256 + prerelease support done; release body from this draft;
   **device wave pending** — the release must not be described as
   device-verified anywhere.

### VERIFICATION.md

1. Add the wave entry as a per-feature evidence-class table (source for the
   wording: §3 of this draft). Required NOT TESTED rows: TalkBack on all new
   surfaces; 130% font-scale on new screens (restore screen, height
   typed-input, notification settings, widget layouts); widget
   placement/publish/tap on a real launcher; notification tap routing on
   device; Samsung duplicate-press confirmation; Codex CLI success path (no
   credentials); the release workflow itself until the first `apk-v0.2.0*` tag
   run.
2. Update the "latest fully-gated automated baseline" numbers (1,875/158;
   e2e 46/46; contrast 104/104; purity 19/19 — unchanged gates noted as such).
3. Record the release-mechanics change (parametrized build-apk.yml, SHA-256,
   prerelease tags) as CODE-INSPECTED + locally simulated, NOT verified in CI
   until the first tag run.

---

## 2. GitHub Release notes body (draft — paste over the workflow body)

> Tag: `apk-v0.2.0` · versionCode 3 · upgrade-installs over apk-v0.1.1

## Nut AI v0.2.0 — Android APK

### New

**Step-by-step onboarding, rebuilt**
- The single-page form is gone: 12 guided steps (about you → body metrics →
  units → provider → plan), a gated Continue on each step, keyboard-friendly
  numeric entry, and a final "See my plan" reveal. Your answers persist as a
  draft, so an interrupted onboarding resumes where you left off.
- Height and weight units are now independent: choose cm or ft/in for height
  and kg or lb for weight separately — in onboarding and later in
  Profile → Units & Health. Everything is stored canonically (kg, cm) and
  converted only for display.
- A short optional tutorial after onboarding (5 cards, replayable from
  Profile, Skip always visible — it never traps you).

**Local notifications (no cloud, no accounts)**
- Meal reminders learned from your plan and rest-timer completion notices,
  scheduled entirely on the device via AlarmManager. No FCM, no push token.
- The Android 13+ notification permission is asked CONTEXTUALLY — when you
  first enable a reminder or start a rest timer — never at app startup, and
  the app works fine if you decline. Manage everything in
  Profile → Notifications.

**Three Android home-screen widgets**
- **Today** (calories remaining + protein progress), **Quick Action** (one-tap
  log/scan/train), **Training** (your next scheduled session). They update
  from the app's own data on-device; if the snapshot goes stale they say
  "Open Nut AI to refresh" instead of guessing. Taps deep-link straight into
  the right screen.

**Codex CLI as an AI provider (local bridge)**
- Run `tools/codex-bridge` on your computer (requires the
  [Codex CLI](https://github.com/openai/codex) installed and logged in) and add
  a provider in the app pointing at the bridge's local URL. It exposes the
  OpenAI-compatible endpoints the app already speaks and translates them to
  `codex exec`.
- What we verified by installing and probing real codex-cli 0.160.0: the
  headless surface (`exec`, `-m` model, `-i` image files, `--json` event
  stream, `--output-schema`/`-o`, `--ephemeral`, sandbox flags) exists and
  parses, and failures map honestly — exit-code 1 + a truthful 401/403/429
  envelope reaches the app instead of a generic "server error" (verified
  end-to-end through the real bridge/CLI).
- What is NOT verified (needs API credentials): successful completions, model
  routing, image understanding quality, and JSON-schema enforcement — those
  shapes are documented by the CLI but not exercised by us.
- Limitations: the bridge is plain HTTP on your local network (no TLS yet) —
  use it only on a network you trust; `codex exec` has no timeout flag; your
  Codex auth lives on your computer, never inside the APK.

### Fixed

- **Home calorie breakdown animation:** the calorie card could open-close-open
  when tapped (duplicate press delivery on some Samsung/OneUI devices,
  amplified by the height spring restarting mid-flight). One tap now flips it
  exactly once, the spring is critically damped with overshoot clamping, and
  content re-measures can no longer restart the animation. Regression-locked
  in tests; the on-device tap behavior still needs the owner device pass.
- **Routines screen jitter:** Create/New Routine re-fetched its lists in a
  focus-effect loop (4 SQLite round-trips per cycle, busy spinner flicker).
  Root cause fixed (stable callbacks + change fingerprint) with a red-first
  regression test that proves 25 refires before → 1 after.
- **Workout modes, routines and programs, cleaned up:** honest "Start empty
  workout" wording, Simple/Advanced set fields named consistently, real
  advanced controls in the routine editor (progression labels, superset chips,
  per-exercise context), programs actually editable with a weekday↔cycle-day
  fix (schedules starting mid-week used to never fire), delete confirmations,
  dirty-exit guards, and an explainer for the program schedule.
- **Android APK QA pass:** font-scaling contract enforced on every text input
  (31/31), screen-reader labels composed correctly on report rows, larger tap
  targets on dish chips, notification settings disabled-state made
  screen-reader-visible, barcode offline vs not-found told apart honestly,
  restore screen scrolls on small displays, and the onboarding plan button
  can no longer double-fire (double-tap previously double-persisted your
  goals). Health-step copy now says plainly that Health Connect for Android
  isn't built yet.

## Install on your phone

1. If v0.1.0 is installed, UNINSTALL it first — v0.1.0 shipped with a one-off
   CI debug key, and Android forbids updating across signing keys (one-time
   step; releases from v0.1.1 on install as updates over each other).
2. Download `nut-ai-v0.2.0.apk` below and tap it.
3. Android will warn about unknown apps — choose **Install anyway / Allow from
   this source**.

## SHA-256 checksum

Verify your download: the file `nut-ai-v0.2.0.apk.sha256` is attached to this
release — put both files in one folder and run `sha256sum -c
nut-ai-v0.2.0.apk.sha256`, or compare the APK hash against the value printed
in the release body.

---

## 3. Verification (keep this section verbatim-honest in the release)

Evidence classes per AGENTS.md §3: PHYSICALLY VERIFIED / AUTOMATICALLY
VERIFIED / CODE-INSPECTED / INFERRED / NOT TESTED / DEFERRED. Nothing below is
upgraded to "verified" without the evidence named next to it.

### Automatically verified (this tree's gates)

- **1,875 tests across 158 Vitest files, 0 failed** — full unit/integration
  suite, including regression locks for every fix listed above (jitter
  red-first test, bounce mechanism locks, onboarding flow/screens, codex
  bridge 36 tests, notification handler/scheduler, training surfaces).
- **Web e2e: 46 passed / 0 failed** — Playwright against the real exported web
  bundle, including the stepwise-onboarding walk and the unit-independence
  journey (kg/cm ↔ lb/ft+in), run on every push by CI.
- **Contrast gate 104/104 pairs** (light 52 + dark 52) — computed from the
  token source of truth, completeness-guarded.
- **Node purity 19/19 shared packages** — the nutrition/training/data cores
  stay runtime-clean.
- **Strict TypeScript typecheck** (root + apps/mobile) and **ESLint
  `--max-warnings=0`** — both green.

### NOT TESTED — pending the emulator / owner-device wave

No device or emulator exists in the development environment; the following are
code-inspected and test-locked at most, and must not be described as
device-verified anywhere:

- **Device journeys:** onboarding + tutorial end-to-end on hardware; widget
  placement, snapshot publish latency and tap routing on a real launcher;
  notification tap routing and rest-timer notifications on device; the
  program-scheduling journey; the Home calorie-card tap on Samsung hardware
  (the duplicate-press root cause is INFERRED from mechanism analysis, not
  observed).
- **TalkBack:** the new `accessibilityValue`/live-region/header-role semantics
  (onboarding wheels, step-change announcements, notification settings,
  widgets) — properties are set and unit-locked; spoken behavior is not.
- **130% font-scale / small-screen layout on the new screens** (restore screen
  after the scroll wrap, height typed-input, notification settings, widget
  layouts).
- **Codex CLI success path** — completions, model routing, image
  understanding, schema enforcement (needs credentials; only the failure
  mapping was verified live).
- **The release pipeline itself** — version derivation, SHA-256 asset and
  prerelease flag run on GitHub Actions for the first time with this tag.

---

## 4. Next actions for the coordinator

1. Paste §2 over the workflow's `body:` (or edit before tagging); the version
   strings are derived — do not hardcode them back.
2. Apply §1 to AGENTS.md / PLAN.md / VERIFICATION.md after the final central
   gate run (re-confirm 1,875 / 46/46 before quoting).
3. Commit + push, then tag `apk-v0.2.0` (or `apk-v0.2.0-rc1` first to exercise
   the prerelease path and the new pipeline end-to-end).
4. Schedule the emulator/owner device wave against the NOT TESTED list in §3;
   update VERIFICATION.md as evidence lands.
