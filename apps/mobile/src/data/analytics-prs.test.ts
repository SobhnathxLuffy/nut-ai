import { describe, expect, it } from 'vitest'
import { collapseDailyPrs } from './analytics'

const nameFor = (id: number) => (id === 1 ? 'Barbell Bench Press' : `Exercise ${id}`)

describe('collapseDailyPrs (P2-2 duplicate PR rows)', () => {
  it('collapses same-day improvements of the same kind to the best value', () => {
    const rows = collapseDailyPrs([
      { exercise_id: 1, kind: 'set volume', value: 340, unit: 'kg·reps', local_date: '2026-09-21' },
      { exercise_id: 1, kind: 'set volume', value: 425, unit: 'kg·reps', local_date: '2026-09-21' },
      { exercise_id: 1, kind: 'set volume', value: 300, unit: 'kg·reps', local_date: '2026-09-21' },
    ], nameFor)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ exercise_name: 'Barbell Bench Press', kind: 'set volume', value: 425, date: '2026-09-21' })
  })

  it('keeps rows from different days and different kinds', () => {
    const rows = collapseDailyPrs([
      { exercise_id: 1, kind: 'set volume', value: 340, unit: 'kg·reps', local_date: '2026-09-21' },
      { exercise_id: 1, kind: 'set volume', value: 360, unit: 'kg·reps', local_date: '2026-09-24' },
      { exercise_id: 1, kind: 'heaviest load', value: 100, unit: 'kg', local_date: '2026-09-21' },
    ], nameFor)
    expect(rows).toHaveLength(3)
  })

  it('keeps the LOWEST value for assistance work where less is better', () => {
    const rows = collapseDailyPrs([
      { exercise_id: 1, kind: 'least assistance for 8 reps', value: 40, unit: 'kg assistance', local_date: '2026-09-21' },
      { exercise_id: 1, kind: 'least assistance for 8 reps', value: 25, unit: 'kg assistance', local_date: '2026-09-21' },
    ], nameFor)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.value).toBe(25)
  })

  it('does not merge the same kind across different exercises', () => {
    const rows = collapseDailyPrs([
      { exercise_id: 1, kind: 'set volume', value: 340, unit: 'kg·reps', local_date: '2026-09-21' },
      { exercise_id: 2, kind: 'set volume', value: 340, unit: 'kg·reps', local_date: '2026-09-21' },
    ], nameFor)
    expect(rows).toHaveLength(2)
  })
})
