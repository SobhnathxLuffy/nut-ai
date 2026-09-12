import {
  recordOperation,
  getOperationByIdempotencyKey,
  createSyncMetadata,
  type DbAdapter,
  type OperationActor,
} from '@nutai/db-adapter'
import type { NutrientRow100g } from '@nutai/core-schema'
import { localDate, slotFor } from './date-utils'

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

export async function logManualFood(
  h: DbAdapter,
  selection: ManualFoodSelection,
  now: number,
  options?: {
    actor?: OperationActor | string
    idempotencyKey?: string
  },
): Promise<number> {
  const date = localDate(now)
  const scale = selection.grams / 100
  const n = selection.nutrientSnapshot
  const scaled = (v: number | null | undefined) => (v == null ? null : v * scale)

  return h.transaction(async (tx) => {
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
        now, date, slotFor(now), now, mealSync.uuid, mealSync.updated_at,
        mealSync.revision, mealSync.deleted_at, mealSync.sync_state,
      ],
    )
    const mealId = Number(meal.lastInsertRowId)

    const itemSync = createSyncMetadata(now)
    await tx.run(
      `INSERT INTO log_items (meal_id, matched_food_id, matched_food_source, display_name, grams,
                              gram_pathway, portion_source, snap_energy_kcal, snap_protein_g, snap_fat_g,
                              snap_carb_g, snap_fiber_g, snap_sugar_g, snap_sodium_mg,
                              is_estimate, macros_user_edited, sort_order, logged_at, uuid,
                              created_at, updated_at, revision, deleted_at, sync_state)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,0,?,?,?,?,?,?,?)`,
      [
        mealId,
        selection.foodId,
        selection.matchedFoodSource,
        selection.displayName,
        selection.grams,
        selection.gramPathway ?? 'fndds_standard_portion',
        selection.portionSource ?? 'db_search',
        scaled(n.kcal),
        scaled(n.protein_g),
        scaled(n.fat_g),
        scaled(n.carbs_g),
        scaled(n.fiber_g),
        scaled(n.sugar_g),
        scaled(n.sodium_mg),
        now,
        itemSync.uuid,
        itemSync.created_at,
        itemSync.updated_at,
        itemSync.revision,
        itemSync.deleted_at,
        itemSync.sync_state,
      ],
    )

    const mealRow = await tx.get<Record<string, unknown>>('SELECT * FROM meals WHERE id = ?', [mealId])
    const itemRows = await tx.all<Record<string, unknown>>(
      'SELECT * FROM log_items WHERE meal_id = ? ORDER BY id ASC',
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
}
