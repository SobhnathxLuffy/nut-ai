import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * P1-2 (QA report Cycle 2) — the wiring contract for the vision-failure model
 * hint, source-swept because the orchestrator and the result screen both sit
 * behind native/expo imports vitest's node environment cannot load (the
 * established pattern for app/ screens, e.g. wave3.test.ts's DayTimeline
 * sweep). The counter SEMANTICS are unit-tested in store.test.ts; this file
 * pins that the pieces are actually wired together.
 *
 * The live failure this guards: a reseller gateway broke one model's vision
 * path server-side (inclusionai/ling-3.0-flash-vl — any image payload → HTTP
 * 500 at the 30s wall, text-only fine) while the scan UI kept offering
 * "Try again". Nothing told the user the MODEL was the problem, so every
 * retry failed identically and read as "the app is broken".
 */

const orchestrator = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'orchestrator.ts'), 'utf8')
const resultScreen = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'app', 'result.tsx'),
  'utf8',
)

describe('P1-2 model hint wiring', () => {
  it('the orchestrator failure phase carries a modelHint built from the failure, model and base URL', () => {
    // The hint rides the SAME failed phase the retry copy does — no parallel
    // channel, no separate store the result screen has to know about.
    expect(orchestrator).toContain('modelHint: modelHintFor(outcome.error, model, baseUrl)')
    // Honest gating: only 500-class errors count (auth/quota/offline say
    // nothing about vision capability)…
    expect(orchestrator).toContain("error.kind === 'error-retryable'")
    expect(orchestrator).toContain('(error.httpStatus ?? 0) >= 500')
    // …only from the SECOND consecutive failure of the SAME model…
    expect(orchestrator).toContain('streak < 2')
    // …and only through a custom base URL (official endpoints fix their own 500s).
    expect(orchestrator).toContain('if (!baseUrl || streak < 2) return undefined')
    // The counter lives in the scan store and resets on that model's success.
    expect(orchestrator).toContain('recordScanModelServerFailure(model)')
    expect(orchestrator).toContain('resetScanModelFailures(model)')
    // The hint names a Gemma vision model as the escape route.
    expect(orchestrator).toContain('google/gemma-3-12b-it')
  })

  it('the result screen renders the hint below the failure copy in textFaint', () => {
    expect(resultScreen).toContain('phase.modelHint ? (')
    expect(resultScreen).toContain('{phase.modelHint}')
    // The hint is secondary guidance, not a second error: faint tier, under
    // the failure message (wave3 sweeps pin the caption scale itself).
    expect(resultScreen).toMatch(/phase\.modelHint \? \([\s\S]{0,240}color: theme\.textFaint/)
  })
})
