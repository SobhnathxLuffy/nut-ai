import { describe, expect, it } from 'vitest'
import { migrate, undoOperation, listOperations } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import { seedExercises, listExercises, startWorkout, addExercise, saveSet, workoutDetail, finishWorkout, activeWorkout, performanceHistory, deriveRecords } from './index.js'

describe('workout phone preview production paths',()=>{
  it('migrates every shipped schema through v10',async()=>{
    for(let version=1;version<=9;version++){
      const db=openMemoryDb()
      await migrate(db,1000,version)
      await db.run("INSERT INTO settings(key,value) VALUES('preview.preserve','yes')")
      await migrate(db,2000)
      await seedExercises(db)
      expect((await listExercises(db)).length).toBeGreaterThan(200)
      expect(await db.get("SELECT value FROM settings WHERE key='preview.preserve'")).toEqual({value:'yes'})
      expect(await db.all('PRAGMA foreign_key_check')).toEqual([])
      await db.close()
    }
  })
  it('saves drafts, completes a workout, derives a PR, and undoes completion',async()=>{
    const db=openMemoryDb();await migrate(db,1000);await seedExercises(db)
    const exercise=(await listExercises(db)).find(e=>e.name==='Barbell Bench Press')!
    const id=await startWorkout(db,'2026-09-12','USB preview',10000)
    const entry=await addExercise(db,id,exercise.id,11000)
    const set=await saveSet(db,entry,{load_kg:20,reps:8},{},12000)
    expect((await workoutDetail(db,id)).exercises[0]?.sets[0]?.completed_at).toBeNull()
    await saveSet(db,entry,{load_kg:20,reps:8},{id:set,completed:true},13000)
    expect((await activeWorkout(db))?.rest_until).toBe(103000)
    await finishWorkout(db,id,14000)
    expect(await activeWorkout(db)).toBeNull()
    expect(deriveRecords(await performanceHistory(db)).some(r=>r.kind==='estimated 1RM')).toBe(true)
    const latest=(await listOperations(db))[0]!
    expect((await undoOperation(db,latest.id,15000)).success).toBe(true)
    expect((await activeWorkout(db))?.id).toBe(id)
    await db.close()
  })
})
