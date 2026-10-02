import { createSyncMetadata, recordOperation, type DbAdapter } from '@nutai/db-adapter'
import type { AssumptionTag, IngredientRow } from '@nutai/core-schema'
import { emitFoodMutation } from './food-mutations'

/**
 * The saved_meals writer (P1-3, QA report Cycle 2).
 *
 * saved_meals stores the CORRECTED ingredient array — `items_json` holds
 * IngredientRow[], exactly the shape app/saved-foods.tsx parses back and
 * re-opens in /food-review, which is what makes relogging free: zero network
 * requests, zero clarifying questions, identical numbers to the day the rows
 * were corrected. Until this module the ONLY writer of the table was the
 * backup import: every user who never restored a backup saw an empty Saved
 * Foods screen no matter how many meals they "saved" from the timeline — the
 * timeline's save wrote logging_shortcuts only.
 *
 * The column set mirrors the backup import's INSERT shape (backup-core.ts
 * writes this table with the schema-v2 sync columns backfilled), so rows
 * written here round-trip through export/restore unchanged.
 */

/** The log_items columns logMeal/manual-food/log-corrections actually write. */
interface LogItemRow {
  id: number
  matched_food_id: number | null
  raw_model_label: string | null
  display_name: string
  grams: number
  gram_pathway: string
  portion_source: string
  snap_energy_kcal: number | null
  snap_protein_g: number | null
  snap_fat_g: number | null
  snap_carb_g: number | null
  snap_fiber_g: number | null
  snap_sugar_g: number | null
  snap_sodium_mg: number | null
  is_estimate: number
  macros_user_edited: number
  band_half_pct: number | null
  assumptions_json: string | null
}

/** Assumption tags survive as JSON; a corrupt or empty blob degrades to []. */
function parseAssumptions(json: string | null): AssumptionTag[] {
  if (json == null) return []
  try {
    const parsed: unknown = JSON.parse(json)
    return Array.isArray(parsed) ? (parsed as AssumptionTag[]) : []
  } catch {
    return []
  }
}

/**
 * The inverse of repo.ts logMeal's ingredient mapping, column for column — so
 * a relogged row carries the SAME provenance class the original log wrote
 * (saved-foods.tsx's toSelection mirrors logMeal's FORWARD mapping on these
 * same fields). origin/gramPathway are trusted casts: every in-app writer
 * stores union values (logMeal writes row.origin/row.gramPathway verbatim),
 * the same trust level saved-foods.tsx already applies to imported rows.
 */
function ingredientRowFromLogItem(item: LogItemRow): IngredientRow {
  return {
    id: `row_${item.id}`,
    displayName: item.display_name,
    sourceFoodId: item.matched_food_id == null ? null : String(item.matched_food_id),
    grams: item.grams,
    nutrientSnapshot: {
      // The four core numbers are guaranteed non-null by insertSavedMeal's
      // honest-refusal check; the optional micros keep their null meaning
      // NOT REPORTED — never a fabricated 0.
      kcal: item.snap_energy_kcal!,
      protein_g: item.snap_protein_g!,
      fat_g: item.snap_fat_g!,
      carbs_g: item.snap_carb_g!,
      fiber_g: item.snap_fiber_g,
      sugar_g: item.snap_sugar_g,
      sodium_mg: item.snap_sodium_mg,
    },
    origin: item.portion_source as IngredientRow['origin'],
    // logMeal stores the web-lookup source URL in raw_model_label.
    sourceUrl: item.raw_model_label,
    gramPathway: item.gram_pathway as IngredientRow['gramPathway'],
    // Legacy rows without a band fall back to the moderate default the
    // pipeline and the scan store already use; it never feeds relog math.
    bandHalfPct: typeof item.band_half_pct === 'number' ? item.band_half_pct : 0.2,
    isEstimate: item.is_estimate !== 0,
    assumptions: parseAssumptions(item.assumptions_json),
    macrosUserEdited: item.macros_user_edited !== 0,
  }
}

/**
 * Save a logged meal's corrected rows into saved_meals under `name` — the
 * writer the timeline's "Save meal" action now feeds alongside its
 * logging_shortcuts write (the shortcut stays: the two tables serve different
 * surfaces). Re-saving the same name UPDATES the stored rows instead of
 * growing duplicates in the Saved Foods list, mirroring saveShortcut's
 * existing-row upsert. The write is transactional, ledgered (undoable), and
 * emits the same food-mutation event a shortcut save does.
 */
export async function insertSavedMeal(
  db: DbAdapter,
  mealId: number,
  name: string,
  now: number = Date.now(),
): Promise<number> {
  if (!name.trim() || name.length > 120) throw new Error('Enter a saved-meal name')
  let opUuid: string | undefined
  const id = await db.transaction(async (tx) => {
    const items = await tx.all<LogItemRow>(
      `SELECT id, matched_food_id, raw_model_label, display_name, grams, gram_pathway, portion_source,
              snap_energy_kcal, snap_protein_g, snap_fat_g, snap_carb_g, snap_fiber_g, snap_sugar_g,
              snap_sodium_mg, is_estimate, macros_user_edited, band_half_pct, assumptions_json
       FROM log_items WHERE meal_id = ? AND deleted_at IS NULL ORDER BY sort_order, id`,
      [mealId],
    )
    if (items.length === 0) throw new Error('Meal no longer exists')
    for (const item of items) {
      // "Unknown is not zero": without the per-100 g core numbers a row cannot
      // be re-logged honestly from saved rows, so the save is REFUSED rather
      // than fabricating zeros into the snapshot.
      if (
        [item.snap_energy_kcal, item.snap_protein_g, item.snap_fat_g, item.snap_carb_g].some(
          (v) => typeof v !== 'number',
        )
      ) {
        throw new Error(`"${item.display_name}" has no stored nutrition snapshot — it cannot be saved for relogging.`)
      }
    }
    const itemsJson = JSON.stringify(items.map(ingredientRowFromLogItem))
    const trimmed = name.trim()

    const existing = await tx.get<Record<string, unknown>>(
      'SELECT * FROM saved_meals WHERE name = ? AND deleted_at IS NULL',
      [trimmed],
    )
    const sync = createSyncMetadata(now)
    let rowId: number
    if (existing) {
      rowId = Number(existing['id'])
      await tx.run(
        "UPDATE saved_meals SET items_json = ?, updated_at = ?, revision = revision + 1, sync_state = 'local' WHERE id = ?",
        [itemsJson, now, rowId],
      )
    } else {
      const inserted = await tx.run(
        `INSERT INTO saved_meals (name, items_json, use_count, last_used_at, created_at,
                                  uuid, updated_at, revision, deleted_at, sync_state)
         VALUES (?, ?, 0, NULL, ?, ?, ?, ?, ?, ?)`,
        [trimmed, itemsJson, sync.created_at, sync.uuid, sync.updated_at, sync.revision, sync.deleted_at, sync.sync_state],
      )
      rowId = Number(inserted.lastInsertRowId)
    }
    const next = await tx.get<Record<string, unknown>>('SELECT * FROM saved_meals WHERE id = ?', [rowId])
    const op = await recordOperation(tx, {
      entityType: 'saved_meals',
      entityId: rowId,
      opType: existing ? 'update' : 'insert',
      prevJson: existing ?? null,
      newJson: next,
      actor: 'user',
      createdAt: now,
    })
    opUuid = op.uuid
    return rowId
  })
  emitFoodMutation({ kind: 'shortcut', operationUuid: opUuid })
  return id
}
