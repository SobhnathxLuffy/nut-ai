# Honesty-contract round (2026-09-30)

The owner hand-tested a perception prompt against their reseller gateway and
asked that it become the app's actual scan contract. The same round covers the
reseller routing hardening, a truncation self-heal, and the first public web
deployment. Shipped at commits `2032fb1` (contract) and `58cefb2` (hosting).

## What changed

### 1. Prompt v1.3.0 — the owner's prompt IS the contract

The vision-stage system prompt now runs the owner's live-tested voice
end-to-end, with the engine contract attached:

- **Scene-first meal identity** — a thali is "Indian mixed thali", a pizza is
  "Supreme pizza"; components are listed separately (visible / likely /
  inferred), never invented.
- **Absolute-scale honesty** — with no scale cue in frame the model returns
  `null` grams or broad low-confidence ranges. A whole pizza comes back as a
  700–800 g RANGE with a clarifying question, never a fake-precise 500 g
  point. Qualitative topping amounts replace fragment counting.
- **Intrinsic vs added cooking fat** — ghee in a dal is intrinsic;
  `added_cooking_fat` only describes visible cooking fat added to the pan.
- **One highest-impact clarification question** per scan, prioritizing eaten
  amount > meal size > piece count > hidden fat > preparation, asked in
  natural units (roti, katori, slice, piece).
- **Honesty blocks on every result** — `portion_context`,
  `major_uncertainties`, `highest_impact_question`, `summary`. The model
  never emits calories or grams as facts; the deterministic engine owns every
  number.

Wire→domain mapping lives in `packages/pipeline/src/scan-contract.ts`
(closed-set enum re-validation, snake_case `added_cooking_fat`,
`'none'`-sentinel handling); `repair` re-stamps schema_version drift; the
result screen ships HonestySummaryCard, the model-question card, the
top-uncertainty line and the portion-context chip.

### 2. Reseller gateway routing

Every provider rides an OpenAI-compatible `/chat/completions` request when a
custom base URL is configured, with the model id passed **verbatim**
(`gemini-2.5-flash` and `google/gemini-2.5-flash` both tried exactly as
typed). Non-auth failures surface honest, key-redacted error snippets with
the HTTP status; empty/prose 200 responses are fished from any envelope slot
before giving up; structured-output mode falls back to schema-as-text on
structural 400s.

### 3. Truncation self-heal

Live-reproduced: gemini-2.5-flash on a hard pizza image returned HTTP 200
`finish_reason=length` — thinking models burn the default 8192-token output
budget on reasoning and emit half a JSON, and no retry path existed. Fixed by
threading `maxTokens` through the scan path, firing ONE escalated retry at
`min(base × 2, 16384)` on kind `'truncated'`, and teaching the orchestrator's
instruction-schema rescue to cover truncation. 8 new tests pin the behavior.

### 4. Sub-path web hosting (GitHub Pages)

GitHub Pages cannot set the COOP/COEP headers the sqlite-wasm OPFS VFS
needs, and project sites serve under `/<repo>/`. The web DB adapter and app
config are now sub-path aware via `EXPO_PUBLIC_WEB_BASE` (unset = root-
anchored, byte-identical behavior), and `scripts/build-ghpages.sh` exports
with `experiments.baseUrl`, injects the canonical coi-serviceworker shim
(client-side isolation headers + one reload), and ships `404.html` SPA
fallback + `.nojekyll`.

Live deployment: **https://sobhnathxluffy.github.io/nut-ai/**

## Evidence

- Gates at `2032fb1`: vitest **1,077 passed / 8 skipped / 0 failed**, lint
  clean, typecheck clean (root + app), node-purity **19/19**.
- Live probes (owner's key, env-transient only): thali → "Indian mixed
  thali" with ranked uncertainties and a plate-diameter question; pizza →
  700–800 g range + "What size is the pizza?"; `added_cooking_fat: none` on a
  dry pan; gemini truncation reproduced then healed by the escalation retry.
  `google/gemini-2.5-flash` 402 "API Key Budget Exceeded" = owner-side quota,
  routing passthrough confirmed by wire evidence.
- Deployment: 8/8 critical paths HTTP 200 under the `/nut-ai/` prefix on a
  local prefix-simulating server; production shim, entry bundle and
  sqlite3.wasm all HTTP 200.
- Incident: a sandbox rebuild restored a stale pre-`2032fb1` snapshot
  (mode-only churn from the platform's `chmod -R 755` restore; content diffs
  = 0). Recovered by fast-forwarding from `origin/main` and re-materializing
  `dist/` from the `gh-pages` branch. No work lost.

## Follow-ups

- Browser-side scan smoke (gateway CORS from https origins) — NOT TESTED.
- Full `npm run check` re-run after reinstalling `node_modules` in the
  rebuilt sandbox.
- Per-row quality columns and meal-level honesty persistence
  (`repo.ts` log_items) deferred.
