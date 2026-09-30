# Scan reliability round — every model, every photo, "Could not read this meal"

Two independent fatal defects in the photo-scan flow, both reproduced live in the
exported web bundle against a reseller gateway (aicredits.in base URL) with
gpt-4o, gpt-4o-mini and google/gemma-3-12b-it, on both a thali and a pizza
photo. Either one alone produced the reported symptom — the scan spends its
spinner and lands on the /result failure card ("Could not read this meal") —
which is why the failure looked model- and photo-independent.

## Reproduction harness

`scripts/scan-repro.mjs` (outside the repo, in the agent workspace) drives the
real app end to end on :3000 — restore-onboarding → provider settings (OpenAI +
reseller base URL + key) → /camera → file-picker upload of the same thali and
pizza JPEGs used in earlier live rounds — while intercepting `**/chat/completions`
to (a) verify the outgoing request and (b) replay each candidate gateway
response shape. This was necessary because the user's API key is never persisted
anywhere (by design), so the gateway's reply had to be characterized from the
request contract plus shape-by-shape replay.

The captured request was correct in every dimension: right URL
(`https://aicredits.in/v1/chat/completions`), right model id, `response_format`
json_schema strict mode carrying the full VisionPayload contract, ~300 KB
sanitized JPEG, 15.4 KB system prompt. The failures were both on the response
side of the seam.

## Bug 1 — the wire schema invited answers the client validator kills

`qualitative_size` is validated against `/^(small|medium|large|count:\d+(\.\d+)?)$/`,
but that regex is a Zod `.refine()`, which cannot ride the wire: every provider
dialect transform (and the reseller sanitizer) strips `pattern`, so the model is
constrained only to "a string". A model then answers the way the schema invited
it to — "two slices on a plate" — and the client regex rejected the ENTIRE
payload. `runPipeline` returned null, and a billed, otherwise-perfect scan died
as "The model answered in a shape we could not use. This one is on us."

This was deterministic across models because it is a contract gap, not a model
quality issue: the stricter validator was invisible to the model, and nothing
between the two ever reconciled them.

### Fix (three layers, in the repo's resilience style)

1. **Wire** (`packages/prompt/src/wire-transforms.ts`): `openAiWireSchema`
   gained a `keepPatterns` mode, used by the photo scan when NO custom base URL
   is set — OpenAI strict mode supports `pattern`, so official-endpoint scans
   become format-deterministic (a drifted answer is now impossible, not
   repaired). Reseller gateways keep pattern stripped (acceptance unknown) and
   are covered by layers 2 and 3.
2. **Repair** (`packages/pipeline/src/repair.ts`, pure, unit-tested): one
   deterministic normalization pass before Zod — `validatePayload` now runs
   repair-and-revalidate inside its existing contract. Repairs cover exactly
   the drift classes the reseller round observed: descriptive sizes
   ("two slices on a plate" → `count:2`, "a fairly large serving" → `large`),
   numbers as strings, confidences as percents (70 → 0.7), a missing/replaced
   `schema_version` stamp, invented enum values mapped to safe members
   (`uncertainty_reason` → `none`, `weight_basis` → `as_served`, invalid
   `food_form` → `discrete`/`liquid`), filtered cue/reference arrays, and
   garbage-shaped containers dropped to null. THE PRINCIPLE, enforced in code
   and pinned in tests: repair never invents nutrition data and never guesses a
   number it was not given; anything without a safe deterministic mapping
   fails validation exactly as before.
3. **One-shot instruction retry** (`apps/mobile/src/scan/{decisions,orchestrator}.ts`):
   a 200 whose content is empty or prose (a gateway that silently drops
   `response_format`) used to be a dead end whose manual retry repeated the
   identical request. `shouldRetryWithInstructionSchema` now routes exactly one
   automatic re-ask with the schema shipped as instruction text (the same
   degraded mode the structural-400 fallback uses), gated by a pure decision:
   never after an instruction-mode attempt (no third identical billing), never
   for transport failures the user can fix (401/offline/timeout). Field-level
   Zod issues are logged on every dead end so failures are diagnosable.

## Bug 2 — every first scan with a catalogue-priced model crashed at the ready step

With Bug 1 fixed in the harness, a clean payload sailed through validation and
the pipeline — and then threw
`TypeError: Cannot read properties of null (reading 'costUsd')` inside
`mergeScanMeta`. The Wave-4 rewrite evaluated `prior!.costUsd!` even when
`prior` was null; a null prior is the NORMAL first-scan case, and every model
with a catalogue price (gpt-4o, gpt-4o-mini) took that path. It shipped because
the only null-prior test also used an unknown cost, which short-circuits to
null before the addition. The e2e suite had no full photo-scan journey, so
nothing exercised the merge on device-shaped data.

### Fix

`mergeScanMeta` now computes cost-knowledge over the chain without ever
dereferencing a null prior (`prior == null` → the new cost stands, exactly as
the P2-9 comment always said). The regression test pins the exact live shape:
`mergeScanMeta(null, {…, costUsd: 0.012, …})` must return `0.012`, not throw.

## Evidence

- Harness, against the exported bundle on :3000, reseller base URL + gpt-4o:
  healthy payload → READY review screen (thali and pizza); missing
  schema_version + string numbers + percent confidences + descriptive size →
  READY (repaired); fenced JSON with prose → READY (existing extractor);
  invented enums + container-as-string → READY (repaired); empty content → one
  automatic instruction-mode re-ask (2 captured requests: json_schema then
  json_object), then the honest "The provider returned an unexpected shape"
  failure with no false retry promise.
- `npm run check` EXIT 0 — 869/869 tests (24+1 new: repair suite, wire-pattern
  structure, retry decision contract, mergeScanMeta first-scan regression),
  lint 0 under --max-warnings=0, tsc clean, node purity 18/18, all data audits.
- `npx playwright test`: 24 passed / 2 ticketed skips (unchanged baseline).
