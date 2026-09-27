/**
 * P1-5: turn raw save failures into language a lifter can act on.
 *
 * Auto-saving a set goes through zod (`SetValues`), and a failed
 * `String(zodError)` renders the entire issue array as JSON inside the
 * workout UI — `[{"code":"invalid_type","expected":"integer",...}]` — which
 * is hostile and tells the user nothing about what to fix.
 *
 * This module maps zod issues (detected structurally, so this file stays
 * dependency-free and testable under bare Node) into short field-level
 * sentences, and falls back to the error's own message for non-zod failures.
 * The draft semantics do not change: the invalid text stays in its field and
 * nothing is written to the database until a valid value is entered.
 */

const FIELD_LABELS: Record<string, string> = {
  load_kg: 'Load',
  reps: 'Reps',
  duration_s: 'Duration',
  distance_m: 'Distance',
  assistance_kg: 'Assistance',
  rir: 'RIR',
  rpe: 'RPE',
  tempo: 'Tempo',
}

interface IssueLike {
  code?: string
  path?: Array<string | number | symbol>
  expected?: string
  received?: string
  minimum?: number | string
  maximum?: number | string
}

function labelFor(key: string): string {
  return FIELD_LABELS[key] ?? (key ? key : 'That value')
}

export function friendlySetValueError(error: unknown): string {
  const issues = (error as { issues?: unknown } | null)?.issues
  if (Array.isArray(issues) && issues.length > 0) {
    const parts = issues.slice(0, 3).map((raw) => {
      const issue = raw as IssueLike
      const label = labelFor(String(issue.path?.[0] ?? ''))
      if (issue.code === 'invalid_type' && issue.expected === 'integer' && issue.received === 'float') {
        return `${label} must be a whole number (like 8, not 8.5)`
      }
      if (issue.code === 'invalid_type') return `${label} must be a number`
      if (issue.code === 'too_big' && issue.maximum !== undefined) {
        return `${label} must be ${issue.maximum} or less`
      }
      if (issue.code === 'too_small' && issue.minimum !== undefined) {
        return `${label} must be at least ${issue.minimum}`
      }
      if (issue.code === 'invalid_string') return `${label} has an invalid format`
      return `${label} was not saved — check its value`
    })
    return parts.join(' · ')
  }

  if (error instanceof Error && error.message) {
    // Defensive: some paths stringify a zod error before it reaches us.
    if (error.message.trimStart().startsWith('[{')) {
      return 'That value could not be saved — check the set fields'
    }
    return error.message
  }
  return 'That value could not be saved — check the set fields'
}
