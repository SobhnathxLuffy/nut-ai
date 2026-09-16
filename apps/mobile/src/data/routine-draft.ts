let pendingRoutineExercises: number[] = []

export function setPendingRoutineExercises(ids: number[]): void {
  pendingRoutineExercises = [...ids]
}

export function consumePendingRoutineExercises(): number[] {
  const ids = [...pendingRoutineExercises]
  pendingRoutineExercises = []
  return ids
}
