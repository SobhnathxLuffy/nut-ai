import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Task 12-c — a meal proposal with ZERO (or all-unresolvable) ingredients must
 * not synthesize an aggregated 0 kcal/100 g selection and route it to
 * /food-review, where it could be saved as a zero-calorie item (§19: missing
 * nutrition never silently becomes zero). resolveMealProposal now throws on an
 * empty resolution list, and handleMealConfirm's existing catch marks the
 * proposal FAILED — the established honest failure path (Failed badge +
 * "Save failed — tap Review & Save to try again." on ProposalCard).
 *
 * app/ screens sit behind expo imports vitest's node environment cannot load,
 * so the wiring is pinned by SOURCE SWEEP (the established pattern —
 * keyboard.test.ts, wave3-food.test.ts).
 */

const here = dirname(fileURLToPath(import.meta.url))
const assistant = readFileSync(join(here, '..', '..', '..', 'app', 'assistant.tsx'), 'utf8')

describe('assistant zero-ingredient proposal guard — AGENTS §19 "missing nutrition never becomes zero"', () => {
  it('resolveMealProposal refuses to build an aggregate from zero resolved selections', () => {
    expect(assistant).toMatch(
      /if \(resolvedSelections\.length === 0\) \{\s*throw new Error\('No ingredients in this proposal could be resolved to a food with nutrition\.'\)\s*\}/,
    )
  })

  it('the guard sits inside resolveMealProposal, BEFORE the synthetic aggregate totals', () => {
    const guardAt = assistant.indexOf('resolvedSelections.length === 0')
    const totalsAt = assistant.indexOf('const totalGrams = resolvedSelections.reduce')
    expect(guardAt).toBeGreaterThan(-1)
    expect(totalsAt).toBeGreaterThan(guardAt)
  })
})
