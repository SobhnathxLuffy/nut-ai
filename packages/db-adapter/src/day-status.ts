import type { DbAdapter, SqlValue } from './types.js'

export const DAY_COMPLETION_STATUSES = ['complete', 'partial', 'unknown', 'fasting'] as const
export type DayCompletion = (typeof DAY_COMPLETION_STATUSES)[number]
export type DayStatusActor = 'user' | 'system' | 'auto'

export interface DayStatusRecord {
  local_date: string
  completion: DayCompletion
  confirmed_at: number | null
  updated_at: number
  actor: DayStatusActor
  provenance: string | null
}

export function isValidDayCompletion(value: unknown): value is DayCompletion {
  return typeof value === 'string' && (DAY_COMPLETION_STATUSES as readonly string[]).includes(value)
}

export function normalizeDayCompletion(value: string): DayCompletion {
  const lower = value.toLowerCase().trim()
  if ((DAY_COMPLETION_STATUSES as readonly string[]).includes(lower)) {
    return lower as DayCompletion
  }
  throw new Error(
    `Invalid day completion status: "${value}". Must be one of: ${DAY_COMPLETION_STATUSES.join(', ')}`,
  )
}

const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function validateLocalDate(date: string): void {
  if (!LOCAL_DATE_RE.test(date)) {
    throw new Error(`Invalid local_date format: "${date}". Expected YYYY-MM-DD.`)
  }
  const [year, month, day] = date.split('-').map(Number)
  const parsed = new Date(Date.UTC(year!, month! - 1, day!))
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month! - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`Invalid local_date value: "${date}".`)
  }
}

export interface SetDayStatusInput {
  localDate: string
  completion: DayCompletion | string
  confirmedAt?: number | null
  actor?: DayStatusActor
  provenance?: string | null
  now?: number
}

export async function getDayStatus(
  db: DbAdapter,
  localDate: string,
): Promise<DayStatusRecord | null> {
  validateLocalDate(localDate)
  const row = await db.get<{
    local_date: string
    completion: string
    confirmed_at: number | null
    updated_at: number
    actor: string
    provenance: string | null
  }>(
    'SELECT local_date, completion, confirmed_at, updated_at, actor, provenance FROM day_status WHERE local_date = ?',
    [localDate],
  )

  if (!row) return null

  return {
    local_date: row.local_date,
    completion: normalizeDayCompletion(row.completion),
    confirmed_at: row.confirmed_at,
    updated_at: row.updated_at,
    actor: (row.actor as DayStatusActor) || 'user',
    provenance: row.provenance,
  }
}

export async function setDayStatus(
  db: DbAdapter,
  input: SetDayStatusInput,
): Promise<DayStatusRecord> {
  validateLocalDate(input.localDate)
  const normalizedCompletion = normalizeDayCompletion(input.completion)
  const now = input.now ?? Date.now()
  const actor = input.actor ?? 'user'
  if (!(['user', 'system', 'auto'] as const).includes(actor)) {
    throw new Error(`Invalid day status actor: "${actor}".`)
  }
  const confirmedAt = input.confirmedAt !== undefined ? input.confirmedAt : now
  const provenance = input.provenance ?? null

  await db.run(
    `INSERT INTO day_status (local_date, completion, confirmed_at, updated_at, actor, provenance)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(local_date) DO UPDATE SET
       completion = excluded.completion,
       confirmed_at = excluded.confirmed_at,
       updated_at = excluded.updated_at,
       actor = excluded.actor,
       provenance = excluded.provenance`,
    [input.localDate, normalizedCompletion, confirmedAt, now, actor, provenance],
  )

  return {
    local_date: input.localDate,
    completion: normalizedCompletion,
    confirmed_at: confirmedAt,
    updated_at: now,
    actor,
    provenance,
  }
}

export async function listDayStatuses(
  db: DbAdapter,
  options: { startDate?: string; endDate?: string } = {},
): Promise<DayStatusRecord[]> {
  let sql = 'SELECT local_date, completion, confirmed_at, updated_at, actor, provenance FROM day_status'
  const params: SqlValue[] = []
  const conditions: string[] = []

  if (options.startDate) {
    validateLocalDate(options.startDate)
    conditions.push('local_date >= ?')
    params.push(options.startDate)
  }

  if (options.endDate) {
    validateLocalDate(options.endDate)
    conditions.push('local_date <= ?')
    params.push(options.endDate)
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ')
  }

  sql += ' ORDER BY local_date ASC'

  const rows = await db.all<{
    local_date: string
    completion: string
    confirmed_at: number | null
    updated_at: number
    actor: string
    provenance: string | null
  }>(sql, params)

  return rows.map((r) => ({
    local_date: r.local_date,
    completion: normalizeDayCompletion(r.completion),
    confirmed_at: r.confirmed_at,
    updated_at: r.updated_at,
    actor: (r.actor as DayStatusActor) || 'user',
    provenance: r.provenance,
  }))
}
