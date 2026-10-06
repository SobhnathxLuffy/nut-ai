import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View,  } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { undoOperation } from '@nutai/db-adapter'
import { loadFood, resolveByText, type ScoredCandidate } from '@nutai/resolver'
import { Icon } from '../src/components/Icon'
import { Empty } from '../src/components/Empty'
// UI/UX report Table 9.2 (Wave 1c): "Save recipe → Success" — fires with the
// undo strip, the same reward moment as meal logging.
import { success as hapticSuccess } from '../src/utils/haptics'
import { db } from '../src/data/repo'
import { openIfctDb, openNutritionDb } from '../src/db/expo-adapter'
import {
  createRecipe,
  deleteRecipe,
  editRecipe,
  getEditableRecipe,
  listRecipes,
  recipeSelection,
  type RecipeDraft,
  type RecipeListItem,
  type RecipePreparation,
} from '../src/data/recipes'
import { formatIngredientContribution, ingredientContributions } from '../src/data/recipes-contributions'
import { encodeFoodReview } from '../src/data/food-review'
import { localDate } from '../src/data/repo'
import { useWebDirtyGuard } from '../src/ui/web-dirty-guard'
import { confirmDialog } from '../src/ui/alert-web'
import { useTheme } from '../src/theme/ThemeProvider'
import { Field } from '../src/components/Field'

// The old local wrapper's container metrics (two-column flexWrap rows).
const FIELD_CONTAINER = { minWidth: 140, marginTop: space.md }
import { MIN_TAP_TARGET, radius, space, type } from '../src/theme/tokens'

interface IngredientForm {
  foodId: string
  displayName: string
  grams: string
  kcal: string
  protein: string
  fat: string
  carbs: string
  fiber: string
}

interface RecipeFormSnapshot {
  name: string
  preparation: RecipePreparation
  oil: string
  water: string
  yieldGrams: string
  servings: string
  ingredients: IngredientForm[]
}

const PREPARATIONS: RecipePreparation[] = ['boiled', 'fried', 'roasted', 'raw']

/**
 * Wave 5A (AGENTS.md §0.2): tolerant parse for the live contribution caption.
 * Blank text is "not entered yet" → null (NOT zero — `Number('')` is 0, which
 * would fabricate a known zero), invalid text also null, and neither may
 * explode into NaN state (AGENTS.md §8.3).
 */
function looseNumber(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function blankIngredient(): IngredientForm {
  return { foodId: '', displayName: '', grams: '', kcal: '', protein: '', fat: '', carbs: '', fiber: '' }
}

const EMPTY_SNAPSHOT: RecipeFormSnapshot = {
  name: '',
  preparation: 'boiled',
  oil: '0',
  water: '0',
  yieldGrams: '',
  servings: '1',
  ingredients: [blankIngredient()],
}

export default function Recipes() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ date?: string }>()
  const [recipes, setRecipes] = useState<RecipeListItem[]>([])
  const [editingId, setEditingId] = useState<number | 'new' | null>(null)
  const [name, setName] = useState('')
  const [preparation, setPreparation] = useState<RecipePreparation>('boiled')
  const [oil, setOil] = useState('0')
  const [water, setWater] = useState('0')
  const [yieldGrams, setYieldGrams] = useState('')
  const [servings, setServings] = useState('1')
  const [ingredients, setIngredients] = useState<IngredientForm[]>([blankIngredient()])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const isSavingRef = useRef(false)
  const [undoUuid, setUndoUuid] = useState<string | null>(null)
  const [matchingIndex, setMatchingIndex] = useState<number | null>(null)
  const [matches, setMatches] = useState<ScoredCandidate[]>([])
  const [showDetails, setShowDetails] = useState(false)
  const [initialSnapshot, setInitialSnapshot] = useState<RecipeFormSnapshot>(EMPTY_SNAPSHOT)

  const reload = useCallback(async () => {
    const handle = await db()
    setRecipes(await listRecipes(handle))
  }, [])

  useFocusEffect(useCallback(() => {
    void reload()
  }, [reload]))

  function resetEditor() {
    setEditingId(null)
    setInitialSnapshot(EMPTY_SNAPSHOT)
    setName('')
    setPreparation('boiled')
    setOil('0')
    setWater('0')
    setYieldGrams('')
    setServings('1')
    setIngredients([blankIngredient()])
    setError(null)
    setMatchingIndex(null)
    setMatches([])
  }

  function startNewRecipe() {
    resetEditor()
    setInitialSnapshot(EMPTY_SNAPSHOT)
    setEditingId('new')
  }

  async function beginEdit(recipeId: number) {
    const recipe = await getEditableRecipe(await db(), recipeId)
    if (!recipe) return
    const mappedIngredients = recipe.ingredients.map((ingredient) => ({
      foodId: ingredient.foodId,
      displayName: ingredient.displayName,
      grams: String(ingredient.gramWeight),
      kcal: String(ingredient.energyKcal),
      protein: String(ingredient.proteinG),
      fat: String(ingredient.fatG),
      carbs: String(ingredient.carbG),
      fiber: ingredient.fiberG == null ? '' : String(ingredient.fiberG),
    }))
    const snap: RecipeFormSnapshot = {
      name: recipe.name,
      preparation: recipe.preparation,
      oil: String(recipe.addedOilG),
      water: String(recipe.addedWaterG),
      yieldGrams: String(recipe.finalCookedWeightG),
      servings: String(recipe.servings),
      ingredients: mappedIngredients,
    }
    setInitialSnapshot(snap)
    setEditingId(recipeId)
    setName(snap.name)
    setPreparation(snap.preparation)
    setOil(snap.oil)
    setWater(snap.water)
    setYieldGrams(snap.yieldGrams)
    setServings(snap.servings)
    setIngredients(snap.ingredients)
  }

  const isDirty = useMemo(() => {
    if (editingId == null) return false
    const currentSnap: RecipeFormSnapshot = {
      name,
      preparation,
      oil,
      water,
      yieldGrams,
      servings,
      ingredients,
    }
    return JSON.stringify(currentSnap) !== JSON.stringify(initialSnapshot)
  }, [editingId, name, preparation, oil, water, yieldGrams, servings, ingredients, initialSnapshot])

  // Wave 5A (AGENTS.md §0.2): live per-ingredient contributed macros for the
  // caption line under each ingredient row. Derived state only — no new
  // inputs: it recomputes as grams / per-100g / servings / yield are typed.
  // Blank grams weigh nothing (0); blank per-100g macros read as unknown.
  // The frame is one serving, exactly like the totals the recipe screen
  // displays and logs, so the captions reconcile with them (plus the oil share).
  const liveServings = looseNumber(servings) ?? 1
  const liveContributions = useMemo(() => ingredientContributions({
    servings: liveServings,
    finalCookedWeightG: looseNumber(yieldGrams) ?? 0,
    ingredients: ingredients.map((ingredient) => ({
      foodId: ingredient.foodId,
      displayName: ingredient.displayName,
      gramWeight: looseNumber(ingredient.grams) ?? 0,
      energyKcal: looseNumber(ingredient.kcal),
      proteinG: looseNumber(ingredient.protein),
      carbG: looseNumber(ingredient.carbs),
      fatG: looseNumber(ingredient.fat),
    })),
  }), [ingredients, liveServings, yieldGrams])

  const handleCancel = useCallback(() => {
    if (isDirty) {
      // Losing unsaved edits is irreversible — the destructive confirm
      // (UI/UX report §10.1 rule two, Wave 1b).
      confirmDialog({
        title: 'Discard recipe changes?',
        message: 'Your unsaved recipe changes will be lost.',
        confirmLabel: 'Discard',
        destructive: true,
        onConfirm: resetEditor,
      })
    } else {
      resetEditor()
    }
  }, [isDirty])

  // P2-15: web parity for the Android-only hardware-back guard — reload and
  // tab close now get the browser leave-confirmation while the editor holds
  // unsaved work. (Browser back cannot be intercepted on expo-router web; see
  // src/ui/web-dirty-guard.ts.)
  useWebDirtyGuard(editingId != null)

  useEffect(() => {
    if (editingId == null) return
    const onBackPress = () => {
      handleCancel()
      return true
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress)
    return () => sub.remove()
  }, [editingId, handleCancel])

  function draft(): RecipeDraft {
    const number = (value: string, field: string) => {
      const parsed = Number(value)
      if (!Number.isFinite(parsed) || parsed < 0) throw new RangeError(`${field} must be a non-negative number`)
      return parsed
    }
    const optionalNumber = (value: string, field: string) => value.trim() ? number(value, field) : null
    // P1-4: name the exact ingredient that is missing its source, instead of
    // the blanket "Every ingredient needs a name and source ID".
    ingredients.forEach((ingredient, position) => {
      const named = ingredient.displayName.trim()
      if (named && !ingredient.foodId.trim()) {
        throw new RangeError(`"${named}" (ingredient ${position + 1}) has no nutrition source — tap Find nutrition, or set its Source ID under Nutrition details`)
      }
    })
    return {
      name,
      preparation,
      addedOilG: number(oil, 'Oil'),
      addedWaterG: number(water, 'Water'),
      finalCookedWeightG: number(yieldGrams, 'Cooked yield'),
      servings: number(servings, 'Servings'),
      ingredients: ingredients.map((ingredient) => ({
        foodId: ingredient.foodId,
        displayName: ingredient.displayName,
        gramWeight: number(ingredient.grams, 'Ingredient grams'),
        energyKcal: number(ingredient.kcal, 'Ingredient kcal'),
        proteinG: number(ingredient.protein, 'Ingredient protein'),
        fatG: number(ingredient.fat, 'Ingredient fat'),
        carbG: number(ingredient.carbs, 'Ingredient carbs'),
        fiberG: optionalNumber(ingredient.fiber, 'Ingredient fiber'),
        sugarG: null,
        sodiumMg: null,
      })),
    }
  }

  async function save() {
    if (busy || isSavingRef.current || editingId == null) return
    isSavingRef.current = true
    let draftData: RecipeDraft
    try {
      draftData = draft()
    } catch (caught) {
      isSavingRef.current = false
      setError(caught instanceof Error ? caught.message : 'Could not save recipe')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const handle = await db()
      const result = editingId === 'new'
        ? await createRecipe(handle, draftData, Date.now())
        : await editRecipe(handle, editingId, draftData, Date.now())
      // Table 9.2: save recipe → success haptic.
      void hapticSuccess()
      setUndoUuid(result.operation.uuid)
      resetEditor()
      await reload()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save recipe')
    } finally {
      isSavingRef.current = false
      setBusy(false)
    }
  }

  async function findIngredient(index: number) {
    const query = ingredients[index]?.displayName.trim()
    if (!query) {
      setError('Enter an ingredient name first')
      return
    }
    setMatchingIndex(index)
    setMatches([])
    setError(null)
    try {
      const [nutritionDb, ifctDb, userDb] = await Promise.all([openNutritionDb(), openIfctDb(), db()])
      const result = await resolveByText(nutritionDb, {
        canonicalFoodKey: query,
        observedBrand: null,
        prepFacet: null,
        modelCategory: null,
        estimatedGrams: Number(ingredients[index]?.grams) || 100,
      }, { ifctDb, userDb })
      const candidates = result.outcome.kind === 'auto_accept'
        ? [result.outcome.match]
        : result.outcome.kind === 'disambiguate' ? result.outcome.candidates : []
      if (candidates.length === 0) {
        setError(`No nutrition match for ${query} — try a simpler name, or fill the nutrition details by hand`)
        return
      }
      // P1-4: when the resolver is confident (exactly one match), apply it
      // immediately. Requiring a second tap on the lone candidate row made
      // "Find nutrition" look finished while ingredient.foodId stayed empty,
      // so Save then false-rejected with "Every ingredient needs a name and
      // source ID".
      if (candidates.length === 1) {
        setMatchingIndex(null)
        await chooseIngredient(index, candidates[0]!)
        return
      }
      setMatches(candidates)
    } catch (error) {
      setError(error instanceof Error ? error.message : `Could not look up nutrition for ${query}`)
    }
  }

  async function chooseIngredient(index: number, candidate: ScoredCandidate) {
    // P1-4: this used to run under `void` with no catch, so a failed food
    // lookup died silently and the ingredient stayed unresolved while the
    // user moved on to Save.
    try {
      const [nutritionDb, ifctDb, userDb] = await Promise.all([openNutritionDb(), openIfctDb(), db()])
      const food = await loadFood(nutritionDb, candidate.foodId, { ifctDb, userDb })
      if (!food) {
        setError('That food is no longer available — pick another match')
        return
      }
      if (food.energyKcal === null || food.proteinG === null || food.fatG === null || food.carbG === null) {
        setError('Core nutrition is unavailable for that ingredient')
        return
      }
      setIngredients((current) => current.map((ingredient, itemIndex) => itemIndex === index ? {
        ...ingredient,
        foodId: food.foodId,
        displayName: food.name,
        kcal: String(food.energyKcal),
        protein: String(food.proteinG),
        fat: String(food.fatG),
        carbs: String(food.carbG),
        fiber: food.fiberG === null ? '' : String(food.fiberG),
      } : ingredient))
      setMatchingIndex(null)
      setMatches([])
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not load that ingredient — pick the match again')
    }
  }

  if (editingId != null) {
    return (
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: theme.bg }}
        // Edge-to-edge (Expo SDK 53+) broke Android's windowSoftInputMode
        // resize the old `undefined` behavior leaned on — 'height' keeps the
        // recipe editor's fields above the keyboard. Web never shows a
        // software keyboard and react-native-web's KeyboardAvoidingView is a
        // plain View, so this is inert there.
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={{ backgroundColor: theme.bg }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.lg, paddingBottom: 160 }}
        >
          <View style={styles.header}>
            <Text style={[type.title, { color: theme.text }]}>{editingId === 'new' ? 'New recipe' : 'Edit recipe'}</Text>
            <Pressable onPress={handleCancel} hitSlop={space.md} accessibilityRole="button" accessibilityLabel="Close recipe editor">
              <Icon name="close" size={22} color={theme.textMuted} />
            </Pressable>
          </View>

        <Field containerStyle={FIELD_CONTAINER} label="Recipe name" value={name} onValueChange={setName} placeholder="Home dal" />
        <Text style={[type.label, { color: theme.textMuted, marginTop: space.lg }]}>Preparation</Text>
        <View style={styles.segmented}>
          {PREPARATIONS.map((value) => (
            <Pressable
              key={value}
              onPress={() => setPreparation(value)}
              style={[
                styles.segment,
                { borderColor: theme.border, backgroundColor: value === preparation ? theme.text : theme.bg },
              ]}
            >
              <Text style={[type.caption, { color: value === preparation ? theme.bg : theme.text }]}>{value}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.twoCol}>
          <Field containerStyle={FIELD_CONTAINER} label="Oil / ghee (g)" value={oil} onValueChange={setOil} numeric />
          <Field containerStyle={FIELD_CONTAINER} label="Added water (g)" value={water} onValueChange={setWater} numeric />
          <Field containerStyle={FIELD_CONTAINER} label="Cooked yield (g)" value={yieldGrams} onValueChange={setYieldGrams} numeric />
          <Field containerStyle={FIELD_CONTAINER} label="Servings" value={servings} onValueChange={setServings} numeric />
        </View>

        <View style={[styles.header, { marginTop: space.xl }]}>
          <Text style={[type.heading, { color: theme.text }]}>Ingredients</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add ingredient"
            onPress={() => setIngredients((current) => [...current, blankIngredient()])}
            style={[styles.iconButton, { borderColor: theme.border }]}
          >
            <Icon name="plus" size={18} color={theme.text} />
          </Pressable>
        </View>
        {/* Wave 5A: the per-ingredient captions below are in the ONE-SERVING
            frame — the same numbers the Log button writes — so they state the
            frame the way the decomposer's breakdown does ("in your Xg serving"). */}
        <Text style={[type.caption, { color: theme.textFaint, marginTop: 2 }]}>
          Each ingredient's contribution to one serving · recipe serves {liveServings}
        </Text>

        {ingredients.map((ingredient, index) => (
          <View key={index} style={[styles.ingredient, { borderColor: theme.border }]}>
            <View style={styles.header}>
              <Text style={[type.bodyStrong, { color: theme.text }]}>Ingredient {index + 1}</Text>
              {ingredients.length > 1 ? (
                <Pressable
                  accessibilityLabel={`Remove ingredient ${index + 1}`}
                  hitSlop={space.sm}
                  onPress={() => setIngredients((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                >
                  <Icon name="close" size={18} color={theme.textMuted} />
                </Pressable>
              ) : null}
            </View>
            <Field containerStyle={FIELD_CONTAINER} label="Food name" value={ingredient.displayName} onValueChange={(value) => updateIngredient(index, 'displayName', value, setIngredients)} placeholder="Lentil dal" />
            <Pressable
              accessibilityRole="button"
              onPress={() => void findIngredient(index)}
              style={[styles.lookupButton, { borderColor: theme.border }]}
            >
              <Icon name="search" size={16} color={theme.text} />
              <Text style={[type.label, { color: theme.text }]}>Find nutrition</Text>
            </Pressable>
            {matchingIndex === index ? matches.map((candidate) => (
              <Pressable
                key={candidate.foodId}
                onPress={() => void chooseIngredient(index, candidate)}
                style={[styles.matchRow, { borderColor: theme.border }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[type.body, { color: theme.text }]} numberOfLines={2}>{candidate.name}</Text>
                  <Text style={[type.caption, { color: theme.textFaint }]}>{candidate.source?.toUpperCase()}</Text>
                </View>
                <Text style={[type.caption, { color: theme.textMuted }]}>{Math.round(candidate.energyKcal ?? 0)} kcal</Text>
              </Pressable>
            )) : null}
            <Field containerStyle={FIELD_CONTAINER} label="Amount (g)" value={ingredient.grams} onValueChange={(value) => updateIngredient(index, 'grams', value, setIngredients)} numeric />
            {/* Wave 5A (AGENTS.md §0.2): live contributed macros for this
                ingredient — the decomposer's caption-line pattern, updating as
                grams / per-100g / servings change. Unknown macros degrade like
                the totals do ('kcal unknown'), zero grams contribute zero. */}
            <Text style={[type.caption, styles.contribution, { color: theme.textMuted, marginTop: space.xs }]}>
              {formatIngredientContribution(liveContributions[index]!)}
            </Text>
            <Pressable onPress={()=>setShowDetails(value=>!value)} style={styles.details}><Text style={[type.caption,{color:theme.textMuted}]}>{showDetails?'Hide nutrition details':'Nutrition details'}</Text></Pressable>
            {showDetails ? <View style={styles.twoCol}>
              <Field containerStyle={FIELD_CONTAINER} label="Source ID" value={ingredient.foodId} onValueChange={(value) => updateIngredient(index, 'foodId', value, setIngredients)} placeholder="Selected automatically" />
              <Field containerStyle={FIELD_CONTAINER} label="kcal / 100 g" value={ingredient.kcal} onValueChange={(value) => updateIngredient(index, 'kcal', value, setIngredients)} numeric />
              <Field containerStyle={FIELD_CONTAINER} label="Protein / 100 g" value={ingredient.protein} onValueChange={(value) => updateIngredient(index, 'protein', value, setIngredients)} numeric />
              <Field containerStyle={FIELD_CONTAINER} label="Carbs / 100 g" value={ingredient.carbs} onValueChange={(value) => updateIngredient(index, 'carbs', value, setIngredients)} numeric />
              <Field containerStyle={FIELD_CONTAINER} label="Fat / 100 g" value={ingredient.fat} onValueChange={(value) => updateIngredient(index, 'fat', value, setIngredients)} numeric />
              <Field containerStyle={FIELD_CONTAINER} label="Fiber / 100 g" value={ingredient.fiber} onValueChange={(value) => updateIngredient(index, 'fiber', value, setIngredients)} numeric />
            </View> : null}
          </View>
        ))}

        {error ? <Text style={[type.caption, { color: theme.safety, marginTop: space.md }]}>{error}</Text> : null}
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void save()}
          style={[styles.primary, { backgroundColor: theme.text }, busy && { opacity: 0.5 }]}
        >
          <Text style={[type.bodyStrong, { color: theme.bg }]}>{busy ? 'Saving...' : 'Save recipe'}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + space.lg }}>
      <View style={[styles.header, { paddingHorizontal: space.lg }]}>
        <Text style={[type.title, { color: theme.text }]}>Recipes</Text>
        <Pressable onPress={() => router.back()} hitSlop={space.md}><Text style={[type.body, { color: theme.textMuted }]}>Done</Text></Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 120 }}>
        {recipes.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={startNewRecipe}
            style={[styles.primary, { backgroundColor: theme.text, marginTop: 0 }]}
          >
            <Icon name="plus" size={18} color={theme.bg} />
            <Text style={[type.bodyStrong, { color: theme.bg }]}>New recipe</Text>
          </Pressable>
        ) : null}

        {undoUuid ? (
          <Pressable
            accessibilityRole="button"
            onPress={async () => {
              await undoOperation(await db(), undoUuid)
              setUndoUuid(null)
              await reload()
            }}
            style={[styles.undo, { backgroundColor: theme.bgSunken }]}
          >
            <Text style={[type.bodyStrong, { color: theme.text }]}>Recipe saved</Text>
            <Text style={[type.label, { color: theme.uncertainText }]}>Undo</Text>
          </Pressable>
        ) : null}

        {recipes.length === 0 ? (
          // UI/UX report Ch. 6.3 / Table 10.1 (Wave 1c): the Empty primitive with
          // the Table 6.1 recipes glyph and the create-first action — the same
          // startNewRecipe the primary button runs.
          <Empty
            icon="bookOpen"
            title="No household recipes yet"
            message="Build one from ingredients — nutrition is computed deterministically from the food database, never guessed."
            action={{ label: 'New recipe', onPress: startNewRecipe }}
          />
        ) : recipes.map((recipe) => (
          <View key={recipe.id} style={[styles.recipeRow, { borderColor: theme.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[type.bodyStrong, { color: theme.text }]}>{recipe.name}</Text>
              <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
                v{recipe.versionNumber} · {Math.round(recipe.servingSizeG)} g · {recipe.energyKcal === null ? 'calories unknown' : `${Math.round(recipe.energyKcal)} kcal`}
              </Text>
              {/* Wave 5A (AGENTS.md §0.2): the same per-ingredient contribution
                  captions in the read-only context — one serving, the frame the
                  totals line above already displays ("150 g · 215 kcal"). */}
              <Text style={[type.caption, styles.contribution, { color: theme.textFaint, fontWeight: '700', marginTop: 2 }]}>
                By ingredient (per serving):
              </Text>
              {recipe.contributions.map((contribution, index) => (
                <Text
                  key={`${contribution.id}:${index}`}
                  style={[type.caption, styles.contribution, { color: theme.textFaint, marginTop: 2 }]}
                >
                  {contribution.name} · {Math.round(contribution.grams)} g {formatIngredientContribution(contribution)}
                </Text>
              ))}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${recipe.name}`} onPress={() => void beginEdit(recipe.id)} style={styles.rowCommand}>
              <Icon name="pencil" size={18} color={theme.textMuted} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={async () => router.push({pathname:'/food-review',params:{payload:encodeFoodReview({selection:await recipeSelection(await db(),recipe.id),date:params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)?params.date:localDate(Date.now())})}} as never)}
              style={[styles.logButton, { borderColor: theme.border }]}
            >
              <Text style={[type.label, { color: theme.text }]}>Log</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${recipe.name}`} onPress={()=>confirmDialog({title:'Delete this recipe?',message:'Existing diary entries keep their saved nutrition.',confirmLabel:'Delete',destructive:true,onConfirm:()=>void (async()=>{const uuid=await deleteRecipe(await db(),recipe.id,Date.now());setUndoUuid(uuid);await reload()})()})} style={styles.rowCommand}><Icon name="close" size={18} color={theme.safety}/></Pressable>
          </View>
        ))}
      </ScrollView>
    </View>
  )
}

function updateIngredient(
  index: number,
  field: keyof IngredientForm,
  value: string,
  setIngredients: React.Dispatch<React.SetStateAction<IngredientForm[]>>,
) {
  setIngredients((current) => current.map((ingredient, itemIndex) => itemIndex === index ? { ...ingredient, [field]: value } : ingredient))
}


const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  input: { minHeight: MIN_TAP_TARGET, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, paddingHorizontal: space.md, marginTop: space.xs },
  // Wave 5A: tabular figures (tokens.ts §4.2 — the monoData digit-alignment
  // rationale) on the live per-ingredient contribution captions, which update
  // on every keystroke and would otherwise jitter digit-width to digit-width.
  // Size/leading/color stay the caption tier; the digits align.
  contribution: { fontVariant: ['tabular-nums'] },
  segmented: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.sm },
  segment: { minHeight: MIN_TAP_TARGET, paddingHorizontal: space.md, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm },
  twoCol: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  ingredient: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.lg, marginTop: space.lg },
  iconButton: { width: MIN_TAP_TARGET, height: MIN_TAP_TARGET, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  lookupButton: { minHeight: MIN_TAP_TARGET, alignSelf: 'flex-start', marginTop: space.sm, paddingHorizontal: space.md, flexDirection: 'row', gap: space.sm, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm },
  details: { minHeight: MIN_TAP_TARGET, justifyContent: 'center' },
  matchRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space.md, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: space.sm },
  primary: { minHeight: 50, marginTop: space.xl, borderRadius: radius.sm, flexDirection: 'row', gap: space.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  undo: { minHeight: 52, marginTop: space.md, paddingHorizontal: space.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: radius.sm },
  recipeRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  rowCommand: { width: MIN_TAP_TARGET, height: MIN_TAP_TARGET, alignItems: 'center', justifyContent: 'center' },
  logButton: { minWidth: 56, minHeight: MIN_TAP_TARGET, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm },
})
