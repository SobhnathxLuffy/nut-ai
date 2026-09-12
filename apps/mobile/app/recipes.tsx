import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { undoOperation } from '@nutai/db-adapter'
import { loadFood, resolveByText, type ScoredCandidate } from '@nutai/resolver'
import { Icon } from '../src/components/Icon'
import { db } from '../src/data/repo'
import { openIfctDb, openNutritionDb } from '../src/db/expo-adapter'
import {
  createRecipe,
  editRecipe,
  getEditableRecipe,
  listRecipes,
  logRecipe,
  type RecipeDraft,
  type RecipeListItem,
  type RecipePreparation,
} from '../src/data/recipes'
import { useTheme } from '../src/theme/ThemeProvider'
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

const PREPARATIONS: RecipePreparation[] = ['boiled', 'fried', 'roasted', 'raw']

function blankIngredient(): IngredientForm {
  return { foodId: '', displayName: '', grams: '', kcal: '', protein: '', fat: '', carbs: '', fiber: '' }
}

export default function Recipes() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
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
  const [undoUuid, setUndoUuid] = useState<string | null>(null)
  const [matchingIndex, setMatchingIndex] = useState<number | null>(null)
  const [matches, setMatches] = useState<ScoredCandidate[]>([])

  const reload = useCallback(async () => {
    const handle = await db()
    setRecipes(await listRecipes(handle))
  }, [])

  useFocusEffect(useCallback(() => {
    void reload()
  }, [reload]))

  function resetEditor() {
    setEditingId(null)
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

  async function beginEdit(recipeId: number) {
    const recipe = await getEditableRecipe(await db(), recipeId)
    if (!recipe) return
    setEditingId(recipeId)
    setName(recipe.name)
    setPreparation(recipe.preparation)
    setOil(String(recipe.addedOilG))
    setWater(String(recipe.addedWaterG))
    setYieldGrams(String(recipe.finalCookedWeightG))
    setServings(String(recipe.servings))
    setIngredients(recipe.ingredients.map((ingredient) => ({
      foodId: ingredient.foodId,
      displayName: ingredient.displayName,
      grams: String(ingredient.gramWeight),
      kcal: String(ingredient.energyKcal),
      protein: String(ingredient.proteinG),
      fat: String(ingredient.fatG),
      carbs: String(ingredient.carbG),
      fiber: String(ingredient.fiberG),
    })))
  }

  function draft(): RecipeDraft {
    const number = (value: string, field: string) => {
      const parsed = Number(value)
      if (!Number.isFinite(parsed) || parsed < 0) throw new RangeError(`${field} must be a non-negative number`)
      return parsed
    }
    return {
      name,
      preparation,
      addedOilG: number(oil, 'Oil'),
      addedWaterG: number(water, 'Water'),
      finalCookedWeightG: number(yieldGrams, 'Cooked yield'),
      servings: number(servings, 'Servings'),
      ingredients: ingredients.map((ingredient, index) => ({
        foodId: ingredient.foodId || `manual:recipe-ingredient-${index + 1}`,
        displayName: ingredient.displayName,
        gramWeight: number(ingredient.grams, 'Ingredient grams'),
        energyKcal: number(ingredient.kcal, 'Ingredient kcal'),
        proteinG: number(ingredient.protein, 'Ingredient protein'),
        fatG: number(ingredient.fat, 'Ingredient fat'),
        carbG: number(ingredient.carbs, 'Ingredient carbs'),
        fiberG: number(ingredient.fiber || '0', 'Ingredient fiber'),
        sugarG: 0,
        sodiumMg: 0,
      })),
    }
  }

  async function save() {
    if (busy || editingId == null) return
    setBusy(true)
    setError(null)
    try {
      const handle = await db()
      const result = editingId === 'new'
        ? await createRecipe(handle, draft(), Date.now())
        : await editRecipe(handle, editingId, draft(), Date.now())
      setUndoUuid(result.operation.uuid)
      resetEditor()
      await reload()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save recipe')
    } finally {
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
    setMatches(candidates)
    if (candidates.length === 0) setError(`No nutrition match for ${query}`)
  }

  async function chooseIngredient(index: number, candidate: ScoredCandidate) {
    const [nutritionDb, ifctDb, userDb] = await Promise.all([openNutritionDb(), openIfctDb(), db()])
    const food = await loadFood(nutritionDb, candidate.foodId, { ifctDb, userDb })
    if (!food) {
      setError('That food is no longer available')
      return
    }
    setIngredients((current) => current.map((ingredient, itemIndex) => itemIndex === index ? {
      ...ingredient,
      foodId: food.foodId,
      displayName: food.name,
      kcal: String(food.energyKcal ?? 0),
      protein: String(food.proteinG ?? 0),
      fat: String(food.fatG ?? 0),
      carbs: String(food.carbG ?? 0),
      fiber: String(food.fiberG ?? 0),
    } : ingredient))
    setMatchingIndex(null)
    setMatches([])
  }

  if (editingId != null) {
    return (
      <ScrollView
        style={{ backgroundColor: theme.bg }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.lg, paddingBottom: 120 }}
      >
        <View style={styles.header}>
          <Text style={[type.title, { color: theme.text }]}>{editingId === 'new' ? 'New recipe' : 'Edit recipe'}</Text>
          <Pressable onPress={resetEditor} hitSlop={space.md} accessibilityLabel="Close recipe editor">
            <Icon name="close" size={22} color={theme.textMuted} />
          </Pressable>
        </View>

        <Field label="Recipe name" value={name} onChange={setName} placeholder="Home dal" />
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
          <Field label="Oil / ghee (g)" value={oil} onChange={setOil} numeric />
          <Field label="Added water (g)" value={water} onChange={setWater} numeric />
          <Field label="Cooked yield (g)" value={yieldGrams} onChange={setYieldGrams} numeric />
          <Field label="Servings" value={servings} onChange={setServings} numeric />
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
            <Field label="Food name" value={ingredient.displayName} onChange={(value) => updateIngredient(index, 'displayName', value, setIngredients)} placeholder="Lentil dal" />
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
                  <Text style={[type.micro, { color: theme.textFaint }]}>{candidate.source?.toUpperCase()}</Text>
                </View>
                <Text style={[type.caption, { color: theme.textMuted }]}>{Math.round(candidate.energyKcal ?? 0)} kcal</Text>
              </Pressable>
            )) : null}
            <Field label="Source ID" value={ingredient.foodId} onChange={(value) => updateIngredient(index, 'foodId', value, setIngredients)} placeholder="ifct:B013" />
            <View style={styles.twoCol}>
              <Field label="Amount (g)" value={ingredient.grams} onChange={(value) => updateIngredient(index, 'grams', value, setIngredients)} numeric />
              <Field label="kcal / 100 g" value={ingredient.kcal} onChange={(value) => updateIngredient(index, 'kcal', value, setIngredients)} numeric />
              <Field label="Protein / 100 g" value={ingredient.protein} onChange={(value) => updateIngredient(index, 'protein', value, setIngredients)} numeric />
              <Field label="Carbs / 100 g" value={ingredient.carbs} onChange={(value) => updateIngredient(index, 'carbs', value, setIngredients)} numeric />
              <Field label="Fat / 100 g" value={ingredient.fat} onChange={(value) => updateIngredient(index, 'fat', value, setIngredients)} numeric />
              <Field label="Fiber / 100 g" value={ingredient.fiber} onChange={(value) => updateIngredient(index, 'fiber', value, setIngredients)} numeric />
            </View>
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
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + space.lg }}>
      <View style={[styles.header, { paddingHorizontal: space.lg }]}> 
        <Text style={[type.title, { color: theme.text }]}>Recipes</Text>
        <Pressable onPress={() => router.back()} hitSlop={space.md}><Text style={[type.body, { color: theme.textMuted }]}>Done</Text></Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 120 }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setEditingId('new')}
          style={[styles.primary, { backgroundColor: theme.text, marginTop: 0 }]}
        >
          <Icon name="plus" size={18} color={theme.bg} />
          <Text style={[type.bodyStrong, { color: theme.bg }]}>New recipe</Text>
        </Pressable>

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
            <Text style={[type.label, { color: theme.uncertain }]}>Undo</Text>
          </Pressable>
        ) : null}

        {recipes.length === 0 ? (
          <Text style={[type.body, { color: theme.textMuted, marginTop: space.xl }]}>No household recipes yet.</Text>
        ) : recipes.map((recipe) => (
          <View key={recipe.id} style={[styles.recipeRow, { borderColor: theme.border }]}> 
            <View style={{ flex: 1 }}>
              <Text style={[type.bodyStrong, { color: theme.text }]}>{recipe.name}</Text>
              <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
                v{recipe.versionNumber} · {Math.round(recipe.servingSizeG)} g · {Math.round(recipe.energyKcal)} kcal
              </Text>
            </View>
            <Pressable accessibilityLabel={`Edit ${recipe.name}`} onPress={() => void beginEdit(recipe.id)} style={styles.rowCommand}>
              <Icon name="pencil" size={18} color={theme.textMuted} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={async () => {
                await logRecipe(await db(), recipe.id, Date.now())
                router.back()
              }}
              style={[styles.logButton, { borderColor: theme.border }]}
            >
              <Text style={[type.label, { color: theme.text }]}>Log</Text>
            </Pressable>
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

function Field({ label, value, onChange, placeholder, numeric = false }: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  numeric?: boolean
}) {
  const theme = useTheme()
  return (
    <View style={{ flex: 1, minWidth: 140, marginTop: space.md }}>
      <Text style={[type.caption, { color: theme.textMuted }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.textFaint}
        keyboardType={numeric ? 'decimal-pad' : 'default'}
        style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSunken }]}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  input: { minHeight: MIN_TAP_TARGET, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, paddingHorizontal: space.md, marginTop: space.xs },
  segmented: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.sm },
  segment: { minHeight: MIN_TAP_TARGET, paddingHorizontal: space.md, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm },
  twoCol: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  ingredient: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.lg, marginTop: space.lg },
  iconButton: { width: MIN_TAP_TARGET, height: MIN_TAP_TARGET, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  lookupButton: { minHeight: MIN_TAP_TARGET, alignSelf: 'flex-start', marginTop: space.sm, paddingHorizontal: space.md, flexDirection: 'row', gap: space.sm, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm },
  matchRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space.md, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: space.sm },
  primary: { minHeight: 50, marginTop: space.xl, borderRadius: radius.sm, flexDirection: 'row', gap: space.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  undo: { minHeight: 52, marginTop: space.md, paddingHorizontal: space.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: radius.sm },
  recipeRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  rowCommand: { width: MIN_TAP_TARGET, height: MIN_TAP_TARGET, alignItems: 'center', justifyContent: 'center' },
  logButton: { minWidth: 56, minHeight: MIN_TAP_TARGET, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm },
})
