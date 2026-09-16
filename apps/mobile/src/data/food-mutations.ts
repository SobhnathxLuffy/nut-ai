export type FoodMutationKind = 'meal' | 'custom-food' | 'recipe' | 'shortcut'

export interface FoodMutation {
  kind: FoodMutationKind
  operationUuid?: string
}

type Listener = (mutation: FoodMutation) => void
const listeners = new Set<Listener>()

export function emitFoodMutation(mutation: FoodMutation): void {
  for (const listener of listeners) listener(mutation)
}

export function subscribeFoodMutations(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

let lastDeletedMealUndoUuid: string | null = null

export function getLastDeletedMealUndoUuid(): string | null {
  return lastDeletedMealUndoUuid
}

export function setLastDeletedMealUndoUuid(uuid: string | null): void {
  lastDeletedMealUndoUuid = uuid
}
