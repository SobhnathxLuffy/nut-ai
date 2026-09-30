import type { Item } from '@nutai/core-schema'
import {
  QUESTION_BANK,
  inferStructuralUncertainty,
  isCountAmbiguous,
  isThaliLikeScene,
  isWholeDishItem,
  type BankQuestion,
} from './question-bank.js'

export * from './question-bank.js'

/**
 * The interruption rule.
 *
 * SPEC-accuracy-engine.md §8.1.
 *
 *   expected_value(Q) = P(assumption_wrong) x expected_kcal_swing(Q) x severity
 *
 *   ASK Q as a highlighted chip iff  expected_value(Q) > INTERRUPTION_THRESHOLD
 *                                    AND selected_this_scan < MAX_QUESTIONS
 *   ELSE apply the silent default and render it as a visibly-editable,
 *        clearly-labeled, PRE-ANSWERED chip. Never a hidden assumption.
 *
 * THE SINGLE MOST IMPORTANT PROPERTY OF THE ENTIRE DESIGN is the asymmetry this
 * produces: a typical home-cooked mixed-dish photo surfaces 1-2 questions, while a
 * banana or a plain grilled chicken breast surfaces ZERO and logs in one tap. That
 * asymmetry is what stops the feature becoming a 30-second chore, which is the
 * failure mode that kills food logging apps.
 */

/**
 * Both constants are INFERRED, not measured. No study surfaced a user-tolerance
 * curve for question count. They live here, together, as named dials so that "how
 * chatty is the app" is one auditable knob rather than scattered heuristics — and
 * they are explicitly A/B-testable from day one.
 */
export const MAX_QUESTIONS = 2
export const INTERRUPTION_THRESHOLD = 45

export interface SelectionInput {
  item: Item
  /** Model reasons UNIONED with structural ones. Never replaced. */
  extraReasons?: readonly string[] | undefined
  /** Attributes this user has already answered 3+ times — these go silent. */
  rememberedAnswers?: ReadonlyMap<string, string> | undefined
  /** Nudged up when the user's calorie budget is tight. */
  severityWeight?: number | undefined
  /** Set when the gram engine's top two signals disagreed past threshold. */
  gramDisagreement?: { low: number; high: number } | undefined
  /** Set when the matched row has servings_per_container > 1.3. */
  multiServingPackage?: boolean | undefined
  /**
   * The scan's scene, as `scene.meal_type` from the vision payload (schema
   * 1.1). A thali-like scene (indian_thali | mixed_plate | buffet) redirects
   * the meal-portion question to its scene-aware variant, `thali_scope`, so
   * the user is asked "Did you eat the whole platter?" instead of the
   * per-item "Did you eat all of this, or some of it?" — both map to the same
   * meal-level fraction, and asking both would be two chips doing one job.
   */
  scene?: { mealType: string } | undefined
}

export interface SelectedQuestion {
  question: BankQuestion
  /** Rendered text, with any placeholders filled. */
  text: string
  expectedValue: number
  /** Highlighted = we are asking. Pre-answered = default applied and disclosed. */
  state: 'highlighted' | 'pre_answered'
  appliedDefault: string | null
  disclosure: string
}

/**
 * Probability the silent default is wrong for this item.
 *
 * Deliberately RELATIVE, never treated as a calibrated absolute probability — see
 * §7.1 on why the model's own numbers cannot carry that weight. The structural
 * prior fires INDEPENDENT of model confidence, because the category itself is
 * high-variance (oil in a stir-fry) regardless of how confident the model claims
 * to be.
 */
function probabilityWrong(q: BankQuestion, item: Item, structural: boolean): number {
  let p = structural ? 0.55 : 0.3
  if (item.uncertainty_reason !== 'none' && q.reasons.includes(item.uncertainty_reason)) {
    p = Math.max(p, 0.7)
  }
  // Low model portion confidence raises it, but only as a nudge.
  if (item.portion_confidence < 0.4) p = Math.min(0.9, p + 0.15)
  else if (item.portion_confidence > 0.8) p = Math.max(0.15, p - 0.1)
  return p
}

export function expectedValue(
  q: BankQuestion,
  item: Item,
  structural: boolean,
  severityWeight: number,
): number {
  return probabilityWrong(q, item, structural) * q.expectedSwingKcal * severityWeight
}

/**
 * Select questions for one item.
 *
 * Returns ALL applicable questions — the highlighted ones we are asking, and the
 * pre-answered ones whose defaults we applied. Both are rendered; only the
 * highlighted ones interrupt. Nothing applicable is ever dropped silently, because
 * an undisclosed assumption is the failure this whole subsystem exists to prevent.
 */
export function selectQuestions(input: SelectionInput): SelectedQuestion[] {
  const { item } = input
  const severity = input.severityWeight ?? 1
  const structural = inferStructuralUncertainty(item)
  const structuralIds = new Set(structural.questionIds)
  const thaliLike = isThaliLikeScene(input.scene?.mealType)

  const applicable: Array<{ q: BankQuestion; ev: number; structural: boolean }> = []

  for (const q of QUESTION_BANK) {
    // A question the user has answered the same way 3+ times becomes the silent
    // default and stops being asked. That is the whole "it learns from you" claim,
    // and it is a frequency table, not machine learning.
    if (input.rememberedAnswers?.has(q.id)) continue

    let isApplicable = false

    // Rank 1 applies to every plated scan — EXCEPT thali-like scenes, where
    // thali_scope is the meal-portion question in the user's own vocabulary.
    // Ranks 2 and 9 have explicit triggers; 12-14 are scene/shape-triggered.
    if (q.id === 'portion_eaten') isApplicable = !thaliLike && item.legible_label_text == null
    else if (q.id === 'thali_scope') isApplicable = thaliLike && item.legible_label_text == null
    else if (q.id === 'servings_consumed') isApplicable = input.multiServingPackage === true
    else if (q.id === 'gram_disagreement') isApplicable = input.gramDisagreement != null
    else if (q.id === 'whole_dish_size') isApplicable = isWholeDishItem(item)
    else if (q.id === 'count_question') isApplicable = isCountAmbiguous(item)
    else {
      isApplicable =
        structuralIds.has(q.id) ||
        q.reasons.includes(item.uncertainty_reason) ||
        (input.extraReasons?.some((r) => (q.reasons as string[]).includes(r)) ?? false)
    }

    if (!isApplicable) continue
    applicable.push({ q, ev: expectedValue(q, item, structuralIds.has(q.id), severity), structural: structuralIds.has(q.id) })
  }

  // META-RULE: ranks 1-2 are closer to "always ask when applicable" than genuinely
  // threshold-gated. Their swing is multiplicative and their resolution is cheap
  // AND CERTAIN — they are factual questions, not perceptual ones. Ranks 3-11 are
  // what the expected-value computation should genuinely gate, because asking
  // about oil on a plain grilled breast with no visible sauce is a wasted
  // interruption with near-zero expected value.
  applicable.sort((a, b) => {
    if (a.q.multiplicative !== b.q.multiplicative) return a.q.multiplicative ? -1 : 1
    return b.ev - a.ev
  })

  let highlighted = 0
  return applicable.map(({ q, ev }) => {
    const clears = q.multiplicative || ev > INTERRUPTION_THRESHOLD
    const ask = clears && highlighted < MAX_QUESTIONS
    if (ask) highlighted++

    let text = q.text
    if (input.gramDisagreement && q.id === 'gram_disagreement') {
      text = text
        .replace('{low}', String(Math.round(input.gramDisagreement.low)))
        .replace('{high}', String(Math.round(input.gramDisagreement.high)))
    } else if (q.id === 'whole_dish_size') {
      // "How large was the Pizza?" reads wrong; diameters are conversationally
      // lowercase. count_question keeps the item's own case ("Samosas").
      text = text.replace('{name}', item.name.toLowerCase())
    } else if (q.id === 'count_question') {
      // Model names arrive both singular ("Samosa") and already plural
      // ("Samosas"); a blind "…{name}s" rendered "Samosass". Add the plural
      // only when the name does not already end in one.
      const n = item.name
      text = text.replace('{name}s', /s$/i.test(n) ? n : `${n}s`)
    }

    return {
      question: q,
      text,
      expectedValue: ev,
      state: ask ? 'highlighted' : 'pre_answered',
      appliedDefault: ask ? null : q.silentDefault,
      disclosure: q.defaultDisclosure,
    }
  })
}

/**
 * Highlighted questions across a whole meal, respecting the global cap.
 *
 * SCENE-LEVEL QUESTIONS fire once per MEAL, not once per bowl: a thali with
 * eight items carries the scene on every item's SelectionInput, and answering
 * "did you eat the whole platter?" eight times is eight lies about eight
 * separate uncertainties. The highest-expected-value occurrence survives; the
 * duplicates are REMOVED (not demoted) — no default goes undisclosed, because
 * the surviving chip IS the question and carries its own disclosure. Every
 * other question is never dropped: it is demoted to pre-answered so its silent
 * default still shows.
 */
const SCENE_LEVEL_IDS: ReadonlySet<string> = new Set(['thali_scope'])

export function selectMealQuestions(items: readonly SelectionInput[]): SelectedQuestion[] {
  const all = items.flatMap((i) => selectQuestions(i))
  const kept: SelectedQuestion[] = []
  const keptScene = new Map<string, SelectedQuestion>()

  for (const q of all) {
    if (!SCENE_LEVEL_IDS.has(q.question.id)) {
      kept.push(q)
      continue
    }
    const existing = keptScene.get(q.question.id)
    if (existing == null) {
      keptScene.set(q.question.id, q)
      kept.push(q)
    } else if (q.expectedValue > existing.expectedValue) {
      kept[kept.indexOf(existing)] = q
      keptScene.set(q.question.id, q)
    }
    // else: a strictly-weaker duplicate of a question the user IS being asked
    // once — removal, not silence.
  }

  const highlighted = kept.filter((q) => q.state === 'highlighted')

  if (highlighted.length <= MAX_QUESTIONS) return kept

  // Never more than MAX_QUESTIONS highlighted regardless of how many cleared the
  // threshold. Demote the lowest-value ones to pre-answered rather than dropping
  // them — their defaults still get disclosed.
  const keep = new Set(
    [...highlighted].sort((a, b) => b.expectedValue - a.expectedValue).slice(0, MAX_QUESTIONS),
  )
  return kept.map((q) =>
    q.state === 'highlighted' && !keep.has(q)
      ? { ...q, state: 'pre_answered' as const, appliedDefault: q.question.silentDefault }
      : q,
  )
}

/**
 * Answer memory.
 *
 * SPEC §8.7. After the same answer for the same food concept 3 times, the 4th scan
 * applies it silently. A frequency table, nothing more — no fine-tuning, no
 * provider personalization API, no on-device training.
 */
export const REMEMBER_AFTER_ANSWERS = 3

export interface AttributeMemory {
  foodConceptKey: string
  attribute: string
  value: string
  answerCount: number
}

export function shouldApplySilently(memory: AttributeMemory | null): boolean {
  return memory != null && memory.answerCount >= REMEMBER_AFTER_ANSWERS
}

export function recordAnswer(
  existing: AttributeMemory | null,
  foodConceptKey: string,
  attribute: string,
  value: string,
): AttributeMemory {
  if (!existing || existing.value !== value) {
    // A changed answer resets the count. Someone who switches from whole milk to
    // oat has changed their habit, and three old answers should not outvote it.
    return { foodConceptKey, attribute, value, answerCount: 1 }
  }
  return { ...existing, answerCount: existing.answerCount + 1 }
}
