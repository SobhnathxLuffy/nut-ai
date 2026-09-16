import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { undoOperation } from '@nutai/db-adapter'
import { loadFood, resolveByText, type ScoredCandidate } from '@nutai/resolver'
import { Icon } from '../src/components/Icon'
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
import { encodeFoodReview } from '../src/data/food-review'
import { localDate } from '../src/data/repo'
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

  const handleCancel = useCallback(() => {
    if (isDirty) {
      Alert.alert(
        'Discard recipe changes?',
        'Your unsaved recipe changes will be lost.',
        [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: resetEditor },
        ],
      )
    } else {
      resetEditor()
    }
  }, [isDirty])

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
  }

  if (editingId != null) {
    return (
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: theme.bg }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
            <Field label="Amount (g)" value={ingredient.grams} onChange={(value) => updateIngredient(index, 'grams', value, setIngredients)} numeric />
            <Pressable onPress={()=>setShowDetails(value=>!value)} style={styles.details}><Text style={[type.caption,{color:theme.textMuted}]}>{showDetails?'Hide nutrition details':'Nutrition details'}</Text></Pressable>
            {showDetails ? <View style={styles.twoCol}>
              <Field label="Source ID" value={ingredient.foodId} onChange={(value) => updateIngredient(index, 'foodId', value, setIngredients)} placeholder="Selected automatically" />
              <Field label="kcal / 100 g" value={ingredient.kcal} onChange={(value) => updateIngredient(index, 'kcal', value, setIngredients)} numeric />
              <Field label="Protein / 100 g" value={ingredient.protein} onChange={(value) => updateIngredient(index, 'protein', value, setIngredients)} numeric />
              <Field label="Carbs / 100 g" value={ingredient.carbs} onChange={(value) => updateIngredient(index, 'carbs', value, setIngredients)} numeric />
              <Field label="Fat / 100 g" value={ingredient.fat} onChange={(value) => updateIngredient(index, 'fat', value, setIngredients)} numeric />
              <Field label="Fiber / 100 g" value={ingredient.fiber} onChange={(value) => updateIngredient(index, 'fiber', value, setIngredients)} numeric />
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
        <Pressable
          accessibilityRole="button"
          onPress={startNewRecipe}
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
                v{recipe.versionNumber} · {Math.round(recipe.servingSizeG)} g · {recipe.energyKcal === null ? 'calories unknown' : `${Math.round(recipe.energyKcal)} kcal`}
              </Text>
            </View>
            <Pressable accessibilityLabel={`Edit ${recipe.name}`} onPress={() => void beginEdit(recipe.id)} style={styles.rowCommand}>
              <Icon name="pencil" size={18} color={theme.textMuted} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={async () => router.push({pathname:'/food-review',params:{payload:encodeFoodReview({selection:await recipeSelection(await db(),recipe.id),date:params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)?params.date:localDate(Date.now())})}} as never)}
              style={[styles.logButton, { borderColor: theme.border }]}
            >
              <Text style={[type.label, { color: theme.text }]}>Log</Text>
            </Pressable>
            <Pressable accessibilityLabel={`Delete ${recipe.name}`} onPress={()=>Alert.alert('Delete this recipe?','Existing diary entries keep their saved nutrition.',[{text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:()=>void (async()=>{const uuid=await deleteRecipe(await db(),recipe.id,Date.now());setUndoUuid(uuid);await reload()})()}])} style={styles.rowCommand}><Icon name="close" size={18} color={theme.safety}/></Pressable>
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
  details: { minHeight: MIN_TAP_TARGET, justifyContent: 'center' },
  matchRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space.md, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: space.sm },
  primary: { minHeight: 50, marginTop: space.xl, borderRadius: radius.sm, flexDirection: 'row', gap: space.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  undo: { minHeight: 52, marginTop: space.md, paddingHorizontal: space.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: radius.sm },
  recipeRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  rowCommand: { width: MIN_TAP_TARGET, height: MIN_TAP_TARGET, alignItems: 'center', justifyContent: 'center' },
  logButton: { minWidth: 56, minHeight: MIN_TAP_TARGET, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm },
})
