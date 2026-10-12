# Nut AI v0.5.0 — Release Notes

Tag `apk-v0.5.0` · versionCode 6 · installs as an in-place upgrade over apk-v0.4.0 (versionCode 5) — same stable CI upload key, your data migrates automatically.

## Your reported issues, fixed

**1. The dates never switched to the new day (the big one)**
- Home's day strip froze on the day the app was opened: keep the app in recents overnight and Oct 12 never arrived — you could not log "today", and the strip had no 12 Oct chip at all.
- Worse, the chips and the data read two different clocks, so an Oct 11 log rendered under the Oct 10 chip, while tapping the Oct 11 chip showed the correct day-detail. All three readers (chips, home data, day-detail) now run on ONE shared day anchor that rolls on focus and on app resume — verified at midnight and on month/year boundaries by new unit tests.

**2. Routines → Add exercises: the search bar was unreachable**
- The picker sheet stacked ~2.3k px of content above the screen edge: only the alphabet-tail of 30 exercises was visible and the search field could not be seen. The sheet body is now a height-bounded, scrollable list with the search field pinned at the top, the FULL 225-exercise catalog reachable, proper spacing restored, and the Done button as a fixed footer instead of buried ~14,000 px deep.

**3. Light mode**
- Both palettes always existed; the app only ever followed the OS. Profile → Units & health → **Appearance** now offers **Match system / Light / Dark** — the tap re-themes the whole app instantly and is remembered on the device. Default stays "Match system" (identical to the old behaviour).

**4. Meal detail: the black dead space**
- After the keyboard closed, the meal editor stayed shrunken and left large dead areas above/below the ingredient rows (an Android KeyboardAvoidingView bug). The container no longer shrinks on Android; the double-counted bottom inset is gone. Tap a logged food card: header, date, slots, ingredient rows, totals and actions render edge-to-edge with no voids.

**5. AI scan quality on small models (your aicredits.in key)**
- Ran the real scan prompt against the aicredits.in gateway across 3 real food photos and 7 models, mirroring the app's exact gateway wire mode. Found the gateway contract and the validator contradicting each other ("use 0 when unknown" vs a schema that rejects 0) — rule-following small models failed wholesale.
- Fixed on both ends: the contract now states the exact per-kind unknown-value rule, the prompt (v1.3.1) allows `beverage_category: null` for non-drinks, and the repair layer learned the drift shapes (zeroed/string gram ranges, numeric sizes, object-shaped assumptions, percent fill levels). Measured on the gateway: gemini-2.5-flash-lite went 1/3 → 3/3 valid scans.
- Try it: Profile → Provider & key → paste your key, base URL `https://aicredits.in/v1`, model `gemini-2.5-flash-lite` (cheapest that passed all photos), `gemma-3-12b-it` also strong. (`ling-3.0-flash-vl` was failing upstream at the gateway itself during testing.)

## New

**6. Bulk JSON import for routines & programs**
- Train tab → **"Import routines & programs (JSON)"** (also under Profile → Your data): paste or load ONE file carrying any number of routines and programs.
- Exercises resolve by NAME against your library, every set is validated by the same engine the editors use, program schedules accept weekday names ("Mon") converted against the start date, and each import is transactional and individually undoable. One bad item is skipped and listed — never the whole batch.
- A loadable example ships in the screen; full field reference in `docs/training-import-format.md`.

**7. Workout-mode tutorial**
- The tutorial gained a sixth card teaching the live workout session by its real labels: the set table, the self-starting rest timer, set kinds (warmup / drop / failure / AMRAP), supersets A/B/C, warmup ramps, the "This week" progression banner, PR detection and "Save as routine". Replay from Profile → "Replay the tutorial".

## Verification at this tag

- 2,003 unit tests passing; lint, strict typecheck (root + app), node-purity 26/26, contrast 104/104 pairs (light 52 + dark 52), data golden queries, IFCT and indian-dishes audits — all green.
- Web e2e: 45 passed / 0 failed (1 documented skip) on the shipped tree.
- Live-model scan evals: harness and reports in `eval/run-model.mjs`.
- On-device rows (TalkBack, widget taps, camera feel) remain untestable in CI — no Android environment in the build sandbox.

## Install on your phone

1. Download `nut-ai-v0.5.0.apk` from the release below.
2. If v0.4.0 (or earlier) is installed, install straight over it — versionCode 6 upgrades cleanly.
3. Fresh install: allow "install unknown apps" for your browser if asked.
4. After updating: open Home once — the strip now lands on today and keeps rolling at midnight.
