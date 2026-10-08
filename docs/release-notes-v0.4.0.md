# Nut AI v0.4.0 — the Cal AI-parity scan flow and the training overhaul

> Tag `apk-v0.4.0` · versionCode 5 · installs as an in-place upgrade over the
> v0.3.0 APK. This wave implements the full Chapter-8/9 roadmap of the
> competitive UX research report (`docs/reports/`): all 5 P0s, all 9 P1s and
> every P2 the register tracked, plus the reviewer findings from a two-axis
> code review of the whole diff.

## The scan flow is now Cal AI-shaped

- **Snap → logged. Immediately.** The meal row is written to the log the
  moment the shutter lands (no network, no model in the way), the camera
  dismisses straight back to the app, and analysis runs in the background.
  The pending card appears in the Home/Food timeline in the same tap.
- **Designed wait, never a hostage screen.** The pending card shows staged
  status (queued → analysing → complete) as a stored field, not a spinner;
  the day's totals count it honestly as "still being analysed, 0 kcal for
  now".
- **Nothing silently disappears.** A failed analysis keeps the photo and
  offers retry / log-manually / delete. Cancelling a pending scan deletes
  the row with undo.
- **Quick/Advanced is gone.** One automatic path; low-confidence items
  surface as inline follow-up chips instead of a mode. The camera screen
  keeps a single compact capture-mode selector.
- **Editing is first-class.** Tap a logged card to review; grams are
  per-item chips; AI numbers carry an estimate badge; macros (kcal /
  protein / carbs / fat per 100 g) are hand-correctable in meal detail and
  every total rescales; a real calendar picker replaces typed dates.
- **The describe-an-edit feature actually works now.** The assistant reads
  today AND yesterday, matches food names fuzzily (including non-ASCII
  names) instead of demanding internal ids, reports applied vs skipped per
  operation, understands "half / 2 rotis / a bowl", lands additions in the
  meal the request names, and the correction call streams with the 180 s
  ceiling — the 30 s non-streaming trap that made it time out is gone.

## Training: transparent progression and a builder that behaves

- **Every lift progresses, not just barbell work.** Bodyweight/reps ladder
  (+1 rep, then +1 set at the ceiling), time and distance +5 % steps,
  assisted lifts shed assistance. History spans ALL completed workouts, so
  live "empty workout" sessions count.
- **The engine explains itself.** The suggestion that used to be silently
  discarded at launch now shows as a "This week" banner with its reason
  ("you hit 12 reps on all sets"), plus next-time notes after each exercise.
- **Adding exercises happens inside the editor.** A picker sheet with a
  recents rail, search and muscle/equipment filters replaces the
  leave-the-editor round trip; new exercises seed from your last real
  performance instead of a hard-coded 20 kg × 10; blocks reorder,
  duplicate and collapse.
- **The editor is unit-aware.** An lb user plans in lb (kg storage
  unchanged) — the 2.2× silent planning error is dead.
- **Deleting a routine no longer corrupts programs.** The dialog's promise
  is now kept: schedules are cleaned up in the same action.
- **Plain language everywhere.** Effort capture asks "Easy / Could do 2
  more / Barely finished"; RIR, RPE, AMRAP, set kinds, tempo and e1RM
  explain themselves at the point of use.
- **Programs are plans, not forms.** A real calendar pick for the start
  date, a generated two-week date preview, "Week 3 of 8 · Pull A today" on
  the Train tab, and a Plan-adherence card (planned vs done + week streak)
  on Progress.
- **Save-as-routine** offers Overwrite on a name collision and defaults to
  the "Reps first, then weight" rule instead of a rule that never
  progresses. Warm-up ramps (40%×5 · 70%×3 · 90%×1) and PR detection at
  finish included.

## Small honest fixes

- Double-log window from mounted search results closed; barcode digits ride
  the route (module-global race removed); undo toasts unified and durable
  (delete with undo from the logged card's long-press); "Quick workout"
  renamed to match the UI; per-exercise rest defaults with a vibrate-at-zero
  timer.

## Quality gates

`tsc` clean · `eslint` clean · 1,944 vitest tests (1,937 passing; the 10
failures are pre-existing, environment-only) · node-purity OK · contrast
104/104 · new tests cover the optimistic-log state machine, the correction
repair pass, the fuzzy resolver (including Devanagari) and the qualitative
sizes. Device rows remain NOT VERIFIED on real hardware (no KVM in CI);
review the Chapter-7 journey scripts if you want a physical checklist.
