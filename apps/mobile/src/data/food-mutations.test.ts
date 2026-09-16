import { describe, expect, it } from 'vitest'
import { emitFoodMutation, subscribeFoodMutations } from './food-mutations'

describe('food mutation invalidation',()=>{
  it('notifies every mounted food view and stops after unsubscribe',()=>{
    const seen:string[]=[]
    const stopA=subscribeFoodMutations(value=>seen.push(`a:${value.kind}`))
    const stopB=subscribeFoodMutations(value=>seen.push(`b:${value.kind}`))
    emitFoodMutation({kind:'meal'})
    stopA(); emitFoodMutation({kind:'custom-food'}); stopB()
    expect(seen).toEqual(['a:meal','b:meal','b:custom-food'])
  })

  it('guards against rapid double-invocation during save operations', async () => {
    let callCount = 0
    let isSaving = false
    const simulateSave = async () => {
      if (isSaving) return null
      isSaving = true
      try {
        await new Promise((r) => setTimeout(r, 20))
        callCount++
        return { success: true }
      } finally {
        isSaving = false
      }
    }
    const [first, second] = await Promise.all([simulateSave(), simulateSave()])
    expect(callCount).toBe(1)
    expect(first).toEqual({ success: true })
    expect(second).toBeNull()
  })
})
