import type { IngredientRow } from '@nutai/core-schema'

export function buildCorrectionPrompt(
  userInput: string,
  currentRows: IngredientRow[]
): {
  system: string
  user: string
} {
  const system = `You are a nutrition logging correction assistant.
The user is correcting an existing logged meal.

Current items in the meal:
${currentRows.map(r => "- [ID: " + r.id + "] " + r.displayName + " (" + r.grams + "g)").join('\n')}

Analyze the user's correction request and output a JSON object matching the CorrectionIntent schema.
Operations:
- update_quantity: Change the amount of an existing item.
- remove_item: Remove an item entirely.
- add_item: Add a missing item.
- replace_item: Swap an item with a different food.

Rules:
1. Identify items by their EXACT id above whenever you can.
2. If you cannot tell which id an item is, set "id" to the item's NAME as it appears in the list instead of guessing an id — the app matches by name as a fallback.
3. grams is a NUMBER of grams, or null when the user only gave a qualitative amount ("half", "1 bowl", "2 rotis") — put their words in qualitative_size, never invent a gram number.
4. If the user names a meal or time ("breakfast", "this morning", "at dinner"), keep those words in the operation's name/qualitative_size so the app can pick the right meal.
5. If the user request is ambiguous (e.g. "I had milk" - what kind? how much?), provide a short 'clarification_needed' string and return empty operations.
`
  return {
    system,
    user: userInput
  }
}
