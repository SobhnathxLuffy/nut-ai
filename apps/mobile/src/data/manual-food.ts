import {
  recordOperation,
  getOperationByIdempotencyKey,
  createSyncMetadata,
  type DbAdapter,
  type OperationActor,
} from '@nutai/db-adapter'
import type { NutrientRow100g } from '@nutai/core-schema'
import { localDate, slotFor } from './date-utils'
import { emitFoodMutation } from './food-mutations'

/**
 * A food picked directly off the Food Database search screen — no photo, no
 * model call. `nutrientSnapshot` is the resolved row's real per-100 g values;
 * `logManualFood` scales them to `grams` and copies the result in at log
 * time, exactly like every other logging path, so a later corpus rebuild can
 * never move a historical log's numbers.
 *
 * This takes its `DbAdapter` as a parameter rather than reaching for repo.ts's
 * cached app singleton — same shape as `backup-core.ts` — specifically so it
 * is testable under plain Node against `@nutai/db-adapter/node`'s
 * `openMemoryDb()`. The singleton's `db()` calls `openUserDb()` in
 * `apps/mobile/src/db/expo-adapter.ts`, which imports `expo-sqlite`; that
 * import throws under Node, so any function that hard-codes it can only ever
 * be exercised inside a running app, never in this test suite.
 */
export interface ManualFoodSelection {
  /** Local numeric source row when one exists; recipes have UUID source IDs. */
  foodId: number | null
  matchedFoodSource: string
  displayName: string
  grams: number
  gramPathway?: string
  portionSource?: string
  nutrientSnapshot: NutrientRow100g
}

export interface ManualMealOptions {
  actor?: OperationActor | string
  idempotencyKey?: string
  localDate?: string
  mealSlot?: string
}

function validateLocalDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T12:00:00Z`))) {
    throw new Error('Choose a valid date')
  }
  return value
}

export async function logManualMealWithItems(
  h: DbAdapter,
  selections: ManualFoodSelection[],
  now: number,
  options?: ManualMealOptions,
): Promise<number> {
  if (selections.length === 0) throw new Error('Cannot log meal with 0 items')
  const date = options?.localDate ? validateLocalDate(options.localDate) : localDate(now)
  const mealSlot = options?.mealSlot?.trim() || slotFor(now)

  const mealId = await h.transaction(async (tx) => {
    if (options?.idempotencyKey) {
      const existing = await getOperationByIdempotencyKey(tx, options.idempotencyKey)
      if (existing) return existing.entity_id
    }
    const mealSync = createSyncMetadata(now)
    const meal = await tx.run(
      `INSERT INTO meals
         (logged_at, local_date, meal_slot, portion_eaten_fraction, analysis_status, created_at,
          uuid, updated_at, revision, deleted_at, sync_state)
       VALUES (?,?,?,1.0,'complete',?,?,?,?,?,?)`,
      [
        now, date, mealSlot, now, mealSync.uuid, mealSync.updated_at,
        mealSync.revision, mealSync.deleted_at, mealSync.sync_state,
      ],
    )
    const mealId = Number(meal.lastInsertRowId)

    for (let i = 0; i < selections.length; i++) {
      const selection = selections[i]!
      const n = selection.nutrientSnapshot
      const itemSync = createSyncMetadata(now)
      await tx.run(
        `INSERT INTO log_items (meal_id, matched_food_id, matched_food_source, display_name, grams,
                                gram_pathway, portion_source, snap_energy_kcal, snap_protein_g, snap_fat_g,
                                snap_carb_g, snap_fiber_g, snap_sugar_g, snap_sodium_mg,
                                is_estimate, macros_user_edited, sort_order, logged_at, uuid,
                                created_at, updated_at, revision, deleted_at, sync_state)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,?,?,?,?,?,?,?,?)`,
        [
          mealId,
          selection.foodId,
          selection.matchedFoodSource,
          selection.displayName,
          selection.grams,
          selection.gramPathway ?? 'fndds_standard_portion',
          selection.portionSource ?? 'db_search',
          n.kcal,
          n.protein_g,
          n.fat_g,
          n.carbs_g,
          n.fiber_g ?? null,
          n.sugar_g ?? null,
          n.sodium_mg ?? null,
          i,
          now,
          itemSync.uuid,
          itemSync.created_at,
          itemSync.updated_at,
          itemSync.revision,
          itemSync.deleted_at,
          itemSync.sync_state,
        ],
      )
    }

    const mealRow = await tx.get<Record<string, unknown>>('SELECT * FROM meals WHERE id = ?', [mealId])
    const itemRows = await tx.all<Record<string, unknown>>(
      'SELECT * FROM log_items WHERE meal_id = ? ORDER BY sort_order ASC, id ASC',
      [mealId],
    )

    await recordOperation(tx, {
      entityType: 'meals',
      entityId: mealId,
      opType: 'insert',
      newJson: { meal: mealRow, items: itemRows, ledger: [] },
      actor: options?.actor ?? 'user',
      idempotencyKey: options?.idempotencyKey,
      createdAt: now,
    })

    return mealId
  })
  emitFoodMutation({ kind: 'meal' })
  return mealId
}

export async function logManualFood(
  h: DbAdapter,
  selection: ManualFoodSelection,
  now: number,
  options?: ManualMealOptions,
): Promise<number> {
  return logManualMealWithItems(h, [selection], now, options)
}
