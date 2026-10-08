import { showToast } from '../components/toast-store'
import { undoLastOperation } from './repo'

/**
 * THE one undo toast (extracted from the triplicated block in result.tsx,
 * (tabs)/food.tsx and food-review.tsx — same "Meal logged." copy, same 6 s
 * window, same "Could not undo —" failure honesty). The toast host is mounted
 * at the app root, so it outlives any dismiss; undoLastOperation emits the
 * food-mutation event that refreshes the Home/Food timelines.
 */
export function showUndoableLoggedToast(
  message = 'Meal logged.',
  /** Failure copy must match the ACTION being undone, not always "added". */
  failureMessage = 'Could not undo — the log changed since this meal was added.',
): void {
  showToast({
    message,
    tone: 'success',
    durationMs: 6000,
    action: {
      label: 'Undo',
      onPress: () => {
        void undoLastOperation().then((r) => {
          if (!r.success) {
            showToast({ message: failureMessage, tone: 'error' })
          }
        })
      },
    },
  })
}
