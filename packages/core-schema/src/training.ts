import { z } from 'zod'

export const TrackingType = z.enum(['weight_reps', 'bodyweight_reps', 'distance_time', 'time', 'reps', 'weight_time', 'distance', 'assisted'])
export type TrackingType = z.infer<typeof TrackingType>
export const SetKind = z.enum(['normal', 'warmup', 'drop', 'failure', 'amrap', 'myo', 'cluster', 'cooldown'])
export const ExerciseInput = z.object({
  name: z.string().trim().min(1).max(120), tracking_type: TrackingType,
  aliases: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  primary_muscles: z.array(z.string().min(1)).min(1), secondary_muscles: z.array(z.string()).default([]),
  antagonist_muscles: z.array(z.string()).default([]), equipment: z.array(z.string()).default([]),
  notes: z.string().max(4000).default(''), media_uri: z.string().max(2000).nullable().default(null),
})
export type ExerciseInput = z.infer<typeof ExerciseInput>
export const SetValues = z.object({
  load_kg: z.number().finite().min(0).max(1500).nullable().default(null),
  reps: z.number().int().min(0).max(10000).nullable().default(null),
  duration_s: z.number().finite().min(0).max(604800).nullable().default(null),
  distance_m: z.number().finite().min(0).max(1000000).nullable().default(null),
  assistance_kg: z.number().finite().min(0).max(500).nullable().default(null),
  rir: z.number().finite().min(0).max(10).nullable().default(null),
  rpe: z.number().finite().min(1).max(10).nullable().default(null),
  tempo: z.string().regex(/^(\d+|X)-(\d+|X)-(\d+|X)-(\d+|X)$/).nullable().default(null),
})
export type SetValues = z.infer<typeof SetValues>
export const TRACKING_FIELDS: Record<TrackingType, readonly (keyof SetValues)[]> = {
  weight_reps: ['load_kg', 'reps'], bodyweight_reps: ['load_kg', 'reps'],
  distance_time: ['distance_m', 'duration_s'], time: ['duration_s'], reps: ['reps'],
  weight_time: ['load_kg', 'duration_s'], distance: ['distance_m'], assisted: ['assistance_kg', 'reps'],
}
export function validateSet(type: TrackingType, input: unknown, completed = false): SetValues {
  const values = SetValues.parse(input)
  const fields = TRACKING_FIELDS[TrackingType.parse(type)]
  for (const key of ['load_kg', 'reps', 'duration_s', 'distance_m', 'assistance_kg'] as const) {
    if (!fields.includes(key) && values[key] !== null) throw new Error(`${key} is incompatible with ${type}`)
    if (completed && fields.includes(key) && (values[key] === null || (key !== 'load_kg' && key !== 'assistance_kg' && values[key]! <= 0))) {
      throw new Error(`Enter ${key} before completing this set`)
    }
  }
  return values
}
export const ProgressionRule = z.object({
  kind: z.enum(['double', 'fixed', 'percentage', 'rir', 'manual', 'program']),
  increment: z.number().finite().min(0).max(100).default(2.5),
  min_reps: z.number().int().min(1).max(100).default(8), max_reps: z.number().int().min(1).max(100).default(12),
  target_rir: z.number().min(0).max(10).default(2),
}).refine(v => v.max_reps >= v.min_reps, 'Maximum reps must be at least minimum reps')
export type ProgressionRule = z.infer<typeof ProgressionRule>
export const RoutineInput = z.object({
  name: z.string().trim().min(1).max(120),
  exercises: z.array(z.object({ exercise_id: z.number().int().positive(), group: z.string().nullable().default(null),
    sets: z.array(SetValues).min(1).max(100), rule: ProgressionRule,
  })).min(1).max(100),
})
export type RoutineInput = z.infer<typeof RoutineInput>
export const ProgramInput = z.object({
  name: z.string().trim().min(1).max(120), start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weeks: z.number().int().min(1).max(104),
  schedule: z.array(z.object({ day: z.number().int().min(0).max(6), routine_id: z.number().int().positive() })).min(1).max(7),
}).refine(v => new Set(v.schedule.map(s => s.day)).size === v.schedule.length, 'One routine per schedule day')
export type ProgramInput = z.infer<typeof ProgramInput>
export const EquipmentInput = z.object({
  name: z.string().trim().min(1).max(100), kind: z.enum(['barbell', 'dumbbell', 'ez_bar', 'trap_bar', 'plate', 'machine', 'band', 'kettlebell', 'cable', 'bench']),
  weight_kg: z.number().finite().min(0).max(1000), count: z.number().int().min(1).max(100),
})
export type EquipmentInput = z.infer<typeof EquipmentInput>
