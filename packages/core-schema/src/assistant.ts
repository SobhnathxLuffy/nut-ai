import { z } from 'zod'

export const GetLastWorkoutArgsZ = z.object({
  exercise_name: z.string().describe('The name of the exercise to look up, e.g. "bench press" or "running"'),
})

export const GetNutritionSummaryArgsZ = z.object({
  timeframe: z.enum(['today', 'yesterday', 'this_week', 'last_week']).describe('The timeframe to summarize'),
})

export const ProposeMealArgsZ = z.object({
  name: z.string().describe('Name of the meal being logged'),
  ingredients: z.array(z.object({
    name: z.string().describe('Name of the food item'),
    grams: z.number().describe('Estimated mass in grams'),
  })).describe('List of ingredients in this meal'),
})

export const ProposeWorkoutRoutineArgsZ = z.object({
  name: z.string().describe('Name of the workout routine, e.g. Push Day'),
  exercises: z.array(z.object({
    name: z.string().describe('Name of the exercise'),
    sets: z.number().describe('Suggested number of sets'),
    reps: z.string().describe('Suggested reps per set, e.g. "8-12"'),
  })).describe('List of exercises in this routine'),
})

export const AssistantToolCallZ = z.discriminatedUnion('tool_name', [
  z.object({
    tool_name: z.literal('get_last_workout'),
    arguments: GetLastWorkoutArgsZ,
  }),
  z.object({
    tool_name: z.literal('get_nutrition_summary'),
    arguments: GetNutritionSummaryArgsZ,
  }),
  z.object({
    tool_name: z.literal('propose_meal'),
    arguments: ProposeMealArgsZ,
  }),
  z.object({
    tool_name: z.literal('propose_workout_routine'),
    arguments: ProposeWorkoutRoutineArgsZ,
  }),
])

export type AssistantToolCall = z.infer<typeof AssistantToolCallZ>
