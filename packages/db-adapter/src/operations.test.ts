import { beforeEach, describe, expect, it } from 'vitest'
import {
  compactOperations,
  currentVersion,
  getOperation,
  getOperationByIdempotencyKey,
  listOperations,
  migrate,
  recordOperation,
  redoOperation,
  undoOperation,
  USER_SCHEMA_VERSION,
  type DbAdapter,
} from './index.js'
import { openMemoryDb } from './node.js'
import { isValidUuid } from './uuid.js'

const NOW = 1_754_200_000_000

describe('Structured Operations and Undo Foundation (FND-003)', () => {
  let db: DbAdapter

  beforeEach(async () => {
    db = openMemoryDb()
    await db.exec('PRAGMA foreign_keys = ON;')
    await migrate(db, NOW)
  })

  describe('schema and migration v4', () => {
    it('migrates to schema v4 with operations table and indexes', async () => {
      expect(await currentVersion(db)).toBe(USER_SCHEMA_VERSION)
      expect(USER_SCHEMA_VERSION).toBeGreaterThanOrEqual(4)

      const columns = await db.all<{ name: string; type: string; notnull: number }>(
        'PRAGMA table_info(operations)',
      )
      const colMap = new Map(columns.map((c) => [c.name, c]))
      expect(colMap.has('id')).toBe(true)
      expect(colMap.has('uuid')).toBe(true)
      expect(colMap.has('entity_type')).toBe(true)
      expect(colMap.has('entity_id')).toBe(true)
      expect(colMap.has('op_type')).toBe(true)
      expect(colMap.has('prev_json')).toBe(true)
      expect(colMap.has('new_json')).toBe(true)
      expect(colMap.has('actor')).toBe(true)
      expect(colMap.has('idempotency_key')).toBe(true)
      expect(colMap.has('created_at')).toBe(true)
      expect(colMap.has('undone_at')).toBe(true)

      const indexes = await db.all<{ name: string }>('PRAGMA index_list(operations)')
      const indexNames = indexes.map((i) => i.name)
      expect(indexNames).toContain('idx_operations_entity')
      expect(indexNames).toContain('idx_operations_idempotency')
      expect(indexNames).toContain('idx_operations_created_at')
    })
  })

  describe('operation recording and contract', () => {
    it('records an operation with UUIDv7, actor, timestamp, and payloads', async () => {
      const op = await recordOperation(db, {
        entityType: 'meals',
        entityId: 42,
        opType: 'insert',
        newJson: { meal: { id: 42, local_date: '2026-08-01' } },
        actor: 'user',
        idempotencyKey: 'meal-create-42',
        createdAt: NOW,
      })

      expect(op.id).toBeGreaterThan(0)
      expect(isValidUuid(op.uuid)).toBe(true)
      expect(op.entity_type).toBe('meals')
      expect(op.entity_id).toBe(42)
      expect(op.op_type).toBe('insert')
      expect(op.actor).toBe('user')
      expect(op.idempotency_key).toBe('meal-create-42')
      expect(op.created_at).toBe(NOW)
      expect(op.undone_at).toBeNull()
      expect(JSON.parse(op.new_json!)).toEqual({ meal: { id: 42, local_date: '2026-08-01' } })

      // Can lookup by ID or UUID
      const byId = await getOperation(db, op.id)
      expect(byId).toEqual(op)

      const byUuid = await getOperation(db, op.uuid)
      expect(byUuid).toEqual(op)
    })

    it('enforces idempotency on replay with the same idempotency key', async () => {
      const first = await recordOperation(db, {
        entityType: 'meals',
        entityId: 100,
        opType: 'insert',
        newJson: { id: 100 },
        actor: 'system',
        idempotencyKey: 'idem-abc-123',
        createdAt: NOW,
      })

      // Replay identical mutation
      const second = await recordOperation(db, {
        entityType: 'meals',
        entityId: 100,
        opType: 'insert',
        newJson: { id: 100 },
        actor: 'system',
        idempotencyKey: 'idem-abc-123',
        createdAt: NOW + 100,
      })

      expect(second.id).toBe(first.id)
      expect(second.uuid).toBe(first.uuid)

      // Query by key
      const found = await getOperationByIdempotencyKey(db, 'idem-abc-123')
      expect(found).toEqual(first)

      // Ensure only 1 row exists
      const allOps = await listOperations(db, { entityType: 'meals' })
      expect(allOps).toHaveLength(1)
    })

    it('rejects unsupported entities and actors before recording SQL', async () => {
      await expect(recordOperation(db, {
        entityType: 'settings; DROP TABLE meals', entityId: 1, opType: 'delete',
      })).rejects.toThrow(/Unsupported operation entity/)
      await expect(recordOperation(db, {
        entityType: 'meals', entityId: 1, opType: 'delete', actor: 'attacker',
      })).rejects.toThrow(/Unsupported operation actor/)
      await expect(recordOperation(db, {
        entityType: 'meals', entityId: 1, opType: 'insert',
        newJson: { meal: { id: 1, injected_column: 'boom' }, items: [] },
      })).rejects.toThrow(/Invalid new payload/)
      expect(await listOperations(db)).toHaveLength(0)
    })
  })

  describe('undo and redo operations', () => {
    it('undos a meal delete by restoring the meal and its log items', async () => {
      // 1. Seed a meal with 2 items
      await db.run(
        `INSERT INTO meals (id, logged_at, local_date, meal_slot, portion_eaten_fraction, analysis_status, created_at)
         VALUES (10, ?, '2026-08-01', 'dinner', 1.0, 'complete', ?)`,
        [NOW, NOW],
      )
      await db.run(
        `INSERT INTO scan_cost_ledger
           (id, meal_id, provider, model, input_tokens, output_tokens, cost_usd, local_month, created_at)
         VALUES (7, 10, 'openai', 'test', 10, 20, 0.01, '2026-08', ?)`,
        [NOW],
      )
      await db.run(
        `INSERT INTO log_items (id, meal_id, matched_food_source, display_name, grams, gram_pathway, portion_source, logged_at)
         VALUES (1, 10, 'corpus', 'Rice', 150, 'scale', 'manual', ?)`,
        [NOW],
      )
      await db.run(
        `INSERT INTO log_items (id, meal_id, matched_food_source, display_name, grams, gram_pathway, portion_source, logged_at)
         VALUES (2, 10, 'corpus', 'Dal', 200, 'scale', 'manual', ?)`,
        [NOW],
      )

      const mealRow = await db.get<Record<string, unknown>>('SELECT * FROM meals WHERE id = 10')
      const itemRows = await db.all<Record<string, unknown>>('SELECT * FROM log_items WHERE meal_id = 10')
      const ledgerRows = await db.all<Record<string, unknown>>('SELECT * FROM scan_cost_ledger WHERE meal_id = 10')

      // 2. Perform delete and record operation
      await db.run('DELETE FROM log_items WHERE meal_id = 10')
      await db.run('DELETE FROM scan_cost_ledger WHERE meal_id = 10')
      await db.run('DELETE FROM meals WHERE id = 10')

      const deleteOp = await recordOperation(db, {
        entityType: 'meals',
        entityId: 10,
        opType: 'delete',
        prevJson: { meal: mealRow, items: itemRows, ledger: ledgerRows },
        actor: 'user',
        createdAt: NOW + 10,
      })

      // Verify meal is gone
      expect(await db.get('SELECT * FROM meals WHERE id = 10')).toBeNull()
      expect(await db.all('SELECT * FROM log_items WHERE meal_id = 10')).toHaveLength(0)

      // 3. Undo the delete
      const undoRes = await undoOperation(db, deleteOp.id, NOW + 20)
      expect(undoRes.success).toBe(true)
      expect(undoRes.operation?.undone_at).toBe(NOW + 20)

      // Verify meal and child items are restored!
      const restoredMeal = await db.get<{ id: number; local_date: string; meal_slot: string }>(
        'SELECT id, local_date, meal_slot FROM meals WHERE id = 10',
      )
      expect(restoredMeal).toBeDefined()
      expect(restoredMeal?.local_date).toBe('2026-08-01')
      expect(restoredMeal?.meal_slot).toBe('dinner')

      const restoredItems = await db.all<{ id: number; display_name: string; grams: number }>(
        'SELECT id, display_name, grams FROM log_items WHERE meal_id = 10 ORDER BY id ASC',
      )
      expect(restoredItems).toHaveLength(2)
      expect(restoredItems[0]?.display_name).toBe('Rice')
      expect(restoredItems[1]?.display_name).toBe('Dal')
      expect(await db.all('SELECT * FROM scan_cost_ledger WHERE meal_id = 10')).toHaveLength(1)

      // 4. Redo the delete
      const redoRes = await redoOperation(db, deleteOp.id)
      expect(redoRes.success).toBe(true)
      expect(redoRes.operation?.undone_at).toBeNull()

      // Meal should be gone again
      expect(await db.get('SELECT * FROM meals WHERE id = 10')).toBeNull()
      expect(await db.all('SELECT * FROM log_items WHERE meal_id = 10')).toHaveLength(0)
      expect(await db.all('SELECT * FROM scan_cost_ledger WHERE meal_id = 10')).toHaveLength(0)
    })

    it('refuses to replace a newer row when an old integer id has been reused', async () => {
      const old = {
        id: 30, logged_at: NOW, local_date: '2026-08-01', portion_eaten_fraction: 1,
        analysis_status: 'complete', retry_count: 0, created_at: NOW,
      }
      const op = await recordOperation(db, {
        entityType: 'meals', entityId: 30, opType: 'delete',
        prevJson: { meal: old, items: [], ledger: [] }, createdAt: NOW,
      })
      await db.run(
        `INSERT INTO meals (id, logged_at, local_date, analysis_status, created_at)
         VALUES (30, ?, '2026-09-01', 'complete', ?)`,
        [NOW + 1, NOW + 1],
      )

      const result = await undoOperation(db, op.id)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/identity is already in use/)
      const current = await db.get<{ local_date: string }>('SELECT local_date FROM meals WHERE id = 30')
      expect(current?.local_date).toBe('2026-09-01')
    })

    it('undos a meal insert by removing the meal', async () => {
      // Insert meal
      await db.run(
        `INSERT INTO meals (id, logged_at, local_date, meal_slot, portion_eaten_fraction, analysis_status, created_at)
         VALUES (20, ?, '2026-08-01', 'breakfast', 1.0, 'complete', ?)`,
        [NOW, NOW],
      )
      await db.run(
        `INSERT INTO log_items (id, meal_id, matched_food_source, display_name, grams, gram_pathway, portion_source, logged_at)
         VALUES (5, 20, 'corpus', 'Oats', 50, 'scale', 'manual', ?)`,
        [NOW],
      )

      const mealRow = await db.get<Record<string, unknown>>('SELECT * FROM meals WHERE id = 20')
      const itemRows = await db.all<Record<string, unknown>>('SELECT * FROM log_items WHERE meal_id = 20')

      const insertOp = await recordOperation(db, {
        entityType: 'meals',
        entityId: 20,
        opType: 'insert',
        newJson: { meal: mealRow, items: itemRows },
        actor: 'user',
        createdAt: NOW,
      })

      // Undo insert
      const undoRes = await undoOperation(db, insertOp.id, NOW + 5)
      expect(undoRes.success).toBe(true)

      // Verified removed
      expect(await db.get('SELECT * FROM meals WHERE id = 20')).toBeNull()
      expect(await db.all('SELECT * FROM log_items WHERE meal_id = 20')).toHaveLength(0)

      // Redo insert
      const redoRes = await redoOperation(db, insertOp.id)
      expect(redoRes.success).toBe(true)

      expect(await db.get('SELECT * FROM meals WHERE id = 20')).toBeDefined()
      expect(await db.all('SELECT * FROM log_items WHERE meal_id = 20')).toHaveLength(1)
    })

    it('undos an entity update by reverting to previous field values', async () => {
      await db.run(
        `INSERT INTO weight_entries (id, local_date, weight_kg, logged_at) VALUES (1, '2026-08-01', 75.0, ?)`,
        [NOW],
      )

      const prevRow = await db.get<Record<string, unknown>>('SELECT * FROM weight_entries WHERE id = 1')

      // Update to 76.5
      await db.run('UPDATE weight_entries SET weight_kg = 76.5 WHERE id = 1')
      const newRow = await db.get<Record<string, unknown>>('SELECT * FROM weight_entries WHERE id = 1')

      const updateOp = await recordOperation(db, {
        entityType: 'weight_entries',
        entityId: 1,
        opType: 'update',
        prevJson: prevRow,
        newJson: newRow,
        actor: 'user',
        createdAt: NOW + 1,
      })

      // Check current
      const current = await db.get<{ weight_kg: number }>('SELECT weight_kg FROM weight_entries WHERE id = 1')
      expect(current?.weight_kg).toBe(76.5)

      // Undo update
      const undoRes = await undoOperation(db, updateOp.id)
      expect(undoRes.success).toBe(true)

      const restored = await db.get<{ weight_kg: number }>('SELECT weight_kg FROM weight_entries WHERE id = 1')
      expect(restored?.weight_kg).toBe(75.0)

      // Redo update
      const redoRes = await redoOperation(db, updateOp.id)
      expect(redoRes.success).toBe(true)

      const reapplied = await db.get<{ weight_kg: number }>('SELECT weight_kg FROM weight_entries WHERE id = 1')
      expect(reapplied?.weight_kg).toBe(76.5)
    })

    it('rejects duplicate undo and redo attempts gracefully', async () => {
      const op = await recordOperation(db, {
        entityType: 'weight_entries',
        entityId: 99,
        opType: 'insert',
        newJson: { id: 99 },
      })

      // Cannot redo an operation that is not undone
      const invalidRedo = await redoOperation(db, op.id)
      expect(invalidRedo.success).toBe(false)
      expect(invalidRedo.reason).toBe('not_undone')

      // First undo succeeds
      const firstUndo = await undoOperation(db, op.id)
      expect(firstUndo.success).toBe(true)

      // Second undo fails gracefully
      const secondUndo = await undoOperation(db, op.id)
      expect(secondUndo.success).toBe(false)
      expect(secondUndo.reason).toBe('already_undone')
    })
  })

  describe('retention and compaction', () => {
    it('retains up to 1000 operations or 30 days, whichever is smaller', async () => {
      const thirtyOneDaysMs = 31 * 24 * 60 * 60 * 1000
      const oldTime = NOW - thirtyOneDaysMs
      const recentTime = NOW - 1000

      // Insert 5 old operations (older than 30 days)
      for (let i = 1; i <= 5; i++) {
        await recordOperation(db, {
          entityType: 'meals',
          entityId: i,
          opType: 'insert',
          createdAt: oldTime + i * 1000,
        })
      }

      // Insert 10 recent operations
      for (let i = 6; i <= 15; i++) {
        await recordOperation(db, {
          entityType: 'meals',
          entityId: i,
          opType: 'insert',
          createdAt: recentTime + i * 1000,
        })
      }

      expect(await listOperations(db)).toHaveLength(15)

      // Compact with 30-day maxAge and maxCount of 8
      const res = await compactOperations(db, {
        maxAgeMs: 30 * 24 * 60 * 60 * 1000,
        maxCount: 8,
        now: NOW,
      })

      // The 5 old operations are pruned because they are > 30 days old.
      // Out of the 10 recent operations, only the latest 8 are kept (2 pruned).
      // Total pruned: 5 + 2 = 7. Remaining: 8.
      expect(res.deletedCount).toBe(7)

      const remaining = await listOperations(db)
      expect(remaining).toHaveLength(8)

      // Ensure all remaining operations are recent
      for (const op of remaining) {
        expect(op.created_at).toBeGreaterThanOrEqual(NOW - 30 * 24 * 60 * 60 * 1000)
      }
    })
  })
})
