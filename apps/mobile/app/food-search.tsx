import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { DbAdapter } from '@nutai/db-adapter'
import { loadFood, resolveByText, type NutritionSourceContext, type ScoredCandidate } from '@nutai/resolver'
import {
  decomposeCompositeMeal,
  isCompositeMealQuery,
  computeUnknownDishNutrition,
  COMMON_BASE_INGREDIENTS,
  COOKING_FAT_OPTIONS,
  COOKING_METHOD_OPTIONS,
  type UnknownDishNutritionResult,
} from '@nutai/indian-dishes'
import { ifctCorpusInfo, nutritionCorpusInfo, openIfctDb, openNutritionDb, resetCorpusPromises } from '../src/db/expo-adapter'
import { db as openUserDb } from '../src/data/repo'
import { resolveSelection } from '../src/data/food-search-select'
import { logManualFood, type ManualFoodSelection } from '../src/data/manual-food'
import { createCustomFood } from '../src/data/custom-foods'
import { encodeFoodReview } from '../src/data/food-review'
import { localDate } from '../src/data/repo'
import { useTheme } from '../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../src/theme/tokens'

interface CompositeMealMatch {
  displayName: string
  selections: ManualFoodSelection[]
  totalKcal: number
  totalProtein: number
  totalCarbs: number
  totalFat: number
}

/**
 * Resolve a tapped row for review. This function never writes a meal.
 */
async function selectFoodForReview(
  nutritionDb: DbAdapter,
  candidate: ScoredCandidate,
  context: NutritionSourceContext,
): Promise<ManualFoodSelection> {
  const resolved = await loadFood(nutritionDb, candidate.foodId, context)
  if (!resolved) {
    if (candidate.source === 'indian_dish_kb') {
      throw new Error('This dish is searchable, but its recipe is still under review. You can decompose it into ingredients below.')
    }
    throw new Error('Selected food is no longer available')
  }
  return resolveSelection(nutritionDb, candidate, resolved)
}

export default function FoodSearch() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ date?: string }>()
  const intendedDate = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : localDate(Date.now())
  const [initialization, setInitialization] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading')
  const [initAttempt, setInitAttempt] = useState(0)

  const [db, setDb] = useState<DbAdapter | null>(null)
  const [sourceContext, setSourceContext] = useState<NutritionSourceContext>({})
  const [corpus, setCorpus] = useState<{
    foods: number
    portions: number
    builtAt: string | null
    ifctFoods: number
    ifctVersion: string | null
  } | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ScoredCandidate[]>([])
  const [outcome, setOutcome] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [selectingId, setSelectingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Composite Meal state
  const [compositeMeal, setCompositeMeal] = useState<CompositeMealMatch | null>(null)
  const [loggingComposite, setLoggingComposite] = useState(false)

  // Unknown Dish Fallback / Decomposition state
  const [showDecompose, setShowDecompose] = useState(false)
  const [decomposeName, setDecomposeName] = useState('')
  const [selectedBaseId, setSelectedBaseId] = useState<string>(COMMON_BASE_INGREDIENTS[0].optionId)
  const [selectedFatId, setSelectedFatId] = useState<string>(COOKING_FAT_OPTIONS[0].optionId)
  const [selectedMethod, setSelectedMethod] = useState<'curried' | 'sauteed' | 'deep_fried' | 'roasted' | 'boiled'>('curried')
  const [decomposePortion, setDecomposePortion] = useState('150')
  const [computedDecomp, setComputedDecomp] = useState<UnknownDishNutritionResult | null>(null)
  const [savingDecomp, setSavingDecomp] = useState(false)

  const initialize = useCallback(async (isAlive: () => boolean) => {
    setInitialization('loading')
    setError(null)
    try {
      const [handle, ifctDb, userDb] = await Promise.all([openNutritionDb(), openIfctDb(), openUserDb()])
      const [info, ifctInfo] = await Promise.all([nutritionCorpusInfo(handle), ifctCorpusInfo(ifctDb)])
      if (!isAlive()) return
      setDb(handle)
      setSourceContext({ ifctDb, userDb })
      setCorpus({ ...info, ifctFoods: ifctInfo.foods, ifctVersion: ifctInfo.version })
      if (info.foods === 0 || ifctInfo.foods === 0) {
        throw new Error(
          info.foods === 0 && ifctInfo.foods === 0
            ? 'Offline food databases are unpopulated or missing.'
            : info.foods === 0
            ? 'USDA food database is empty.'
            : 'IFCT food database is empty.',
        )
      }
      setInitialization('ready')
    } catch (cause) {
      if (!isAlive()) return
      setDb(null)
      setCorpus(null)
      setInitialization('error')
      setError(cause instanceof Error ? cause.message : 'Could not open offline food data')
    }
  }, [])

  useEffect(() => {
    let alive = true
    void initialize(() => alive)
    return () => { alive = false }
  }, [initialize, initAttempt])

  useEffect(() => {
    if (!db || query.trim().length < 2) {
      setResults([])
      setOutcome('')
      setCompositeMeal(null)
      return
    }
    let alive = true
    setBusy(true)
    setError(null)
    const timer = setTimeout(async () => {
      try {
      // 1. Check composite meal
      if (isCompositeMealQuery(query)) {
        const decomposed = decomposeCompositeMeal(query)
        if (decomposed && decomposed.components.length >= 2) {
          const compSelections: ManualFoodSelection[] = []
          let possible = true
          for (const comp of decomposed.components) {
            const compRes = await resolveByText(db, {
              canonicalFoodKey: comp.query,
              observedBrand: null,
              prepFacet: null,
              modelCategory: null,
              estimatedGrams: comp.defaultPortionGrams ?? 100,
            }, sourceContext)

            const matchCandidate = compRes.outcome.kind === 'auto_accept'
              ? compRes.outcome.match
              : compRes.outcome.kind === 'disambiguate'
              ? compRes.outcome.candidates[0]
              : null

            if (matchCandidate) {
              try {
                const resolved = await loadFood(db, matchCandidate.foodId, sourceContext)
                if (resolved) {
                  const sel = await resolveSelection(db, matchCandidate, resolved)
                  if (comp.quantity && comp.quantity > 1) {
                    sel.grams = sel.grams * comp.quantity
                  } else if (comp.defaultPortionGrams && !resolved.servingSizeG) {
                    sel.grams = comp.defaultPortionGrams
                  }
                  compSelections.push(sel)
                } else {
                  possible = false
                  break
                }
              } catch {
                possible = false
                break
              }
            } else {
              possible = false
              break
            }
          }

          if (alive && possible && compSelections.length === decomposed.components.length) {
            const totalKcal = compSelections.reduce((sum, s) => sum + ((s.nutrientSnapshot.kcal * s.grams) / 100), 0)
            const totalProtein = compSelections.reduce((sum, s) => sum + ((s.nutrientSnapshot.protein_g * s.grams) / 100), 0)
            const totalCarbs = compSelections.reduce((sum, s) => sum + ((s.nutrientSnapshot.carbs_g * s.grams) / 100), 0)
            const totalFat = compSelections.reduce((sum, s) => sum + ((s.nutrientSnapshot.fat_g * s.grams) / 100), 0)

            setCompositeMeal({
              displayName: decomposed.displayName,
              selections: compSelections,
              totalKcal,
              totalProtein,
              totalCarbs,
              totalFat,
            })
          } else if (alive) {
            setCompositeMeal(null)
          }
        }
      } else {
        setCompositeMeal(null)
      }

      // 2. Regular candidate resolution
      const r = await resolveByText(db, {
        canonicalFoodKey: query,
        observedBrand: null,
        prepFacet: null,
        modelCategory: null,
        estimatedGrams: 150,
      }, sourceContext)
      if (!alive) return
      if (r.outcome.kind === 'auto_accept') {
        setResults([r.outcome.match])
        setOutcome('Best match')
      } else if (r.outcome.kind === 'disambiguate') {
        setResults(r.outcome.candidates)
        setOutcome(`${r.outcome.candidates.length} matches`)
      } else {
        setResults([])
        setOutcome('no match — decompose into ingredients below')
      }
      } catch (cause) {
        if (alive) {
          setResults([])
          setCompositeMeal(null)
          setOutcome('')
          setError(cause instanceof Error ? cause.message : 'Search failed')
        }
      } finally {
        if (alive) setBusy(false)
      }
    }, 180)
    return () => { alive = false; clearTimeout(timer) }
  }, [db, query, sourceContext])

  // Live unknown dish calculation
  useEffect(() => {
    if (!showDecompose || !db) return
    let alive = true
    const baseOpt = COMMON_BASE_INGREDIENTS.find((b) => b.optionId === selectedBaseId) || COMMON_BASE_INGREDIENTS[0]
    const fatOpt = COOKING_FAT_OPTIONS.find((f) => f.optionId === selectedFatId) ?? COOKING_FAT_OPTIONS[0]
    const portionG = parseFloat(decomposePortion) || 150

    computeUnknownDishNutrition({
      dishName: decomposeName.trim() || query.trim() || 'Custom Recipe',
      baseIngredientId: baseOpt.foodId,
      baseIngredientGrams: baseOpt.defaultRawGrams,
      fatId: fatOpt.foodId,
      fatGrams: fatOpt.defaultGrams,
      cookingMethod: selectedMethod,
      portionGrams: portionG,
    }, db, sourceContext.ifctDb).then((res) => {
      if (alive) setComputedDecomp(res)
    }).catch(() => {
      if (alive) setComputedDecomp(null)
    })

    return () => { alive = false }
  }, [showDecompose, db, selectedBaseId, selectedFatId, selectedMethod, decomposePortion, decomposeName, query, sourceContext])

  async function handleSelect(candidate: ScoredCandidate) {
    if (!db || selectingId != null) return
    setSelectingId(candidate.foodId)
    setError(null)
    try {
      if (candidate.source === 'indian_dish_kb' && candidate.basisConfidence === 'low') {
        throw new Error('This dish is still under review. Build an ingredient estimate before logging it.')
      }
      const selection = await selectFoodForReview(db, candidate, sourceContext)
      setSelectingId(null)
      router.push({
        pathname: '/food-review',
        params: { payload: encodeFoodReview({ selection, date: intendedDate }) },
      } as never)
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : 'Could not log that food — try again.'
      setError(msg)
      setSelectingId(null)
      if (candidate.source === 'indian_dish_kb') {
        setDecomposeName(candidate.name)
        setShowDecompose(true)
      }
    }
  }

  async function handleSelectComposite() {
    if (!compositeMeal || loggingComposite) return
    setLoggingComposite(true)
    setError(null)
    try {
      const selection: ManualFoodSelection = {
        ...compositeMeal.selections[0]!,
        displayName: compositeMeal.displayName,
        grams: compositeMeal.selections.reduce((sum, item) => sum + item.grams, 0),
      }
      setLoggingComposite(false)
      router.push({ pathname: '/food-review', params: {
        payload: encodeFoodReview({ selection, selections: compositeMeal.selections, date: intendedDate }),
      } } as never)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not log composite meal')
      setLoggingComposite(false)
    }
  }

  async function handleLogDecomposed() {
    if (!computedDecomp || savingDecomp) return
    if (computedDecomp.per100g.kcal === null || computedDecomp.per100g.protein_g === null || computedDecomp.per100g.carbs_g === null || computedDecomp.per100g.fat_g === null) {
      setError('Core nutrition is unavailable for one of these ingredients. Choose another ingredient before logging.')
      return
    }
    setSavingDecomp(true)
    setError(null)
    try {
      const userDb = await openUserDb()
      const selection: ManualFoodSelection = {
        foodId: null,
        matchedFoodSource: 'ingredient_decomposition',
        displayName: computedDecomp.dishName,
        grams: computedDecomp.portionGrams,
        gramPathway: 'decomposed_recipe',
        portionSource: 'user_decomposition',
        nutrientSnapshot: computedDecomp.per100g,
      }
      await logManualFood(userDb, selection, Date.now())
      router.back()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not log decomposed dish')
      setSavingDecomp(false)
    }
  }

  async function handleSaveCustomFood() {
    if (!computedDecomp || savingDecomp) return
    if (computedDecomp.serving.kcal === null || computedDecomp.serving.protein_g === null || computedDecomp.serving.carbs_g === null || computedDecomp.serving.fat_g === null) {
      setError('Core nutrition is unavailable for one of these ingredients. Choose another ingredient before saving.')
      return
    }
    setSavingDecomp(true)
    setError(null)
    try {
      const userDb = await openUserDb()
      await createCustomFood(userDb, {
        name: computedDecomp.dishName,
        servingAmount: computedDecomp.portionGrams,
        servingUnit: 'g',
        calories: computedDecomp.serving.kcal,
        protein_g: computedDecomp.serving.protein_g,
        carbs_g: computedDecomp.serving.carbs_g,
        fat_g: computedDecomp.serving.fat_g,
        fiber_g: computedDecomp.serving.fiber_g,
      }, Date.now())
      setShowDecompose(false)
      setSavingDecomp(false)
      setQuery(computedDecomp.dishName)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save custom food')
      setSavingDecomp(false)
    }
  }

  const corpusLine = useMemo(() => {
    if (initialization === 'loading') return 'Loading offline food data…'
    if (initialization === 'error') return error ?? 'Offline food data could not be opened.'
    if (!corpus) return ''
    return `${corpus.ifctFoods.toLocaleString()} IFCT foods · ${corpus.foods.toLocaleString()} USDA foods · offline`
  }, [corpus, initialization, error])

  return (
    <ScrollView
      style={{ backgroundColor: theme.bg }}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.lg, paddingBottom: 160 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[type.title, { color: theme.text }]}>Food Database</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={space.md}>
          <Text style={[type.body, { color: theme.textMuted }]}>Done</Text>
        </Pressable>
      </View>
      <Text style={[type.caption, { color: initialization === 'error' ? theme.safety : theme.textMuted, marginTop: space.xs }]}>
        {corpusLine}
      </Text>
      {initialization === 'error' && (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            resetCorpusPromises()
            setInitAttempt((value) => value + 1)
          }}
          style={[styles.retry, { borderColor: theme.border }]}
        >
          <Text style={[type.label, { color: theme.text }]}>Retry</Text>
        </Pressable>
      )}

      <TextInput
        accessibilityLabel="Search foods"
        placeholder="Search — try “litti chokha”, “idli sambar”, “roti”"
        placeholderTextColor={theme.textFaint}
        value={query}
        editable={initialization === 'ready'}
        onChangeText={(text) => {
          setQuery(text)
          if (showDecompose) setShowDecompose(false)
        }}
        autoCorrect={false}
        autoCapitalize="none"
        style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSunken }]}
      />

      {busy && <ActivityIndicator style={{ marginTop: space.lg }} color={theme.textFaint} />}

      {outcome !== '' && (
        <Text style={[type.micro, { color: theme.textFaint, marginTop: space.md }]}>{outcome.toUpperCase()}</Text>
      )}

      {error != null && (
        <Text style={[type.caption, { color: theme.safety, marginTop: space.md }]}>{error}</Text>
      )}

      {/* Composite Meal Banner */}
      {compositeMeal && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Review meal ${compositeMeal.displayName}`}
          disabled={loggingComposite}
          onPress={handleSelectComposite}
          style={({ pressed }) => [
            styles.compositeCard,
            { backgroundColor: theme.bgSunken, borderColor: theme.protein, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={[type.body, { color: theme.protein, fontWeight: '700' }]}>
              {compositeMeal.displayName}
            </Text>
            {loggingComposite ? (
              <ActivityIndicator size="small" color={theme.protein} />
            ) : (
              <Text style={[type.micro, { color: theme.protein, fontWeight: '600' }]}>Review</Text>
            )}
          </View>
          <Text style={[type.caption, { color: theme.text, marginTop: space.xs }]}>
            {compositeMeal.selections.map((s) => `${s.grams}g ${s.displayName}`).join('  +  ')}
          </Text>
          <Text style={[type.micro, { color: theme.textMuted, marginTop: space.xs }]}>
            Total: {Math.round(compositeMeal.totalKcal)} kcal · {compositeMeal.totalProtein.toFixed(1)}g P · {compositeMeal.totalCarbs.toFixed(1)}g C · {compositeMeal.totalFat.toFixed(1)}g F
          </Text>
        </Pressable>
      )}

      {/* Regular Search Result Rows */}
      {results.map((r) => (
        <Pressable
          key={r.foodId}
          testID={`food-search-row-${r.foodId}`}
          accessibilityRole="button"
          accessibilityLabel={`Review ${r.name}`}
          disabled={selectingId != null}
          onPress={() => handleSelect(r)}
          style={({ pressed }) => [
            styles.row,
            { borderColor: theme.border, minHeight: MIN_TAP_TARGET, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <View style={{ flex: 1 }}>
            <Text style={[type.body, { color: theme.text }]} numberOfLines={2}>{r.name}</Text>
            <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
              {r.source === 'indian_dish_kb' && r.basisConfidence === 'low' ? 'Under review · nutrition unavailable' : r.energyKcal != null ? `${Math.round(r.energyKcal)} kcal / 100 g` : 'Nutrition shown during review'}
              {r.brand ? ` · ${r.brand}` : ''}
            </Text>
            <Text style={[type.micro, { color: theme.textFaint, marginTop: 2 }]}>
              {sourceLabel(r.source)}
            </Text>
          </View>
          {selectingId === r.foodId ? <ActivityIndicator color={theme.textFaint} /> : null}
        </Pressable>
      ))}

      {/* Unknown Dish / Zero Matches Fallback Button */}
      {initialization === 'ready' && query.trim().length >= 2 && !busy && results.length === 0 && !showDecompose && (
        <View style={{ marginTop: space.lg }}>
          <Text style={[type.caption, { color: theme.textMuted }]}>
            Nothing matched directly. Build an estimate from ingredients and a cooking method.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setDecomposeName(query)
              setShowDecompose(true)
            }}
            style={[styles.actionBtn, { backgroundColor: theme.bgSunken, borderColor: theme.protein }]}
          >
            <Text style={[type.body, { color: theme.protein, fontWeight: '600' }]}>
              Decompose “{query}” into Ingredients
            </Text>
          </Pressable>
        </View>
      )}

      {/* Unknown Dish Decomposition / Recipe Builder Interface */}
      {showDecompose && (
        <View style={[styles.decomposeContainer, { backgroundColor: theme.bgSunken, borderColor: theme.border }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={[type.body, { color: theme.text, fontWeight: '700' }]}>
              🥣 Dish Recipe Decomposition
            </Text>
            <Pressable accessibilityRole="button" onPress={() => setShowDecompose(false)} hitSlop={space.sm}>
              <Text style={[type.caption, { color: theme.textMuted }]}>✕ Close</Text>
            </Pressable>
          </View>

          <Text style={[type.micro, { color: theme.textMuted, marginTop: space.xs }]}>
            Deterministic arithmetic: verified ingredients × yield × portion. No flat guesses.
          </Text>

          {/* Dish Name */}
          <Text style={[type.caption, { color: theme.text, marginTop: space.md, fontWeight: '600' }]}>Dish Name</Text>
          <TextInput
            value={decomposeName}
            onChangeText={setDecomposeName}
            placeholder="Dish Name"
            placeholderTextColor={theme.textFaint}
            style={[styles.smallInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bg }]}
          />

          {/* Base Ingredient */}
          <Text style={[type.caption, { color: theme.text, marginTop: space.md, fontWeight: '600' }]}>Primary Ingredient (IFCT/USDA)</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: space.xs }}>
            <View style={{ flexDirection: 'row', gap: space.xs }}>
              {COMMON_BASE_INGREDIENTS.map((item) => (
                <Pressable
                  key={item.optionId}
                  onPress={() => setSelectedBaseId(item.optionId)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: selectedBaseId === item.optionId ? theme.protein : theme.bg,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  <Text style={[type.micro, { color: selectedBaseId === item.optionId ? '#fff' : theme.text }]}>
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>

          {/* Cooking Fat / Oil Clarification */}
          <Text style={[type.caption, { color: theme.text, marginTop: space.md, fontWeight: '600' }]}>Cooking Fat / Clarification</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: space.xs }}>
            <View style={{ flexDirection: 'row', gap: space.xs }}>
              {COOKING_FAT_OPTIONS.map((item) => (
                <Pressable
                  key={item.optionId}
                  onPress={() => setSelectedFatId(item.optionId)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: selectedFatId === item.optionId ? theme.protein : theme.bg,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  <Text style={[type.micro, { color: selectedFatId === item.optionId ? '#fff' : theme.text }]}>
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>

          {/* Cooking Method / Yield Clarification */}
          <Text style={[type.caption, { color: theme.text, marginTop: space.md, fontWeight: '600' }]}>Cooking Method & Yield</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: space.xs }}>
            <View style={{ flexDirection: 'row', gap: space.xs }}>
              {COOKING_METHOD_OPTIONS.map((item) => (
                <Pressable
                  key={item.method}
                  onPress={() => setSelectedMethod(item.method)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: selectedMethod === item.method ? theme.protein : theme.bg,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  <Text style={[type.micro, { color: selectedMethod === item.method ? '#fff' : theme.text }]}>
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>

          {/* Portion Size (grams) */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.md, gap: space.md }}>
            <Text style={[type.caption, { color: theme.text, fontWeight: '600' }]}>Portion Size (g):</Text>
            <TextInput
              value={decomposePortion}
              onChangeText={setDecomposePortion}
              keyboardType="numeric"
              style={[styles.smallInput, { width: 80, textAlign: 'center', color: theme.text, borderColor: theme.border, backgroundColor: theme.bg }]}
            />
          </View>

          {/* Live Calculated Nutrition Result */}
          {computedDecomp && (
            <View style={[styles.nutritionBox, { backgroundColor: theme.bg, borderColor: theme.border }]}>
              <Text style={[type.caption, { color: theme.text, fontWeight: '700' }]}>
                Calculated Serving ({computedDecomp.portionGrams}g):
              </Text>
              <Text style={[type.body, { color: theme.protein, fontWeight: '700', marginTop: 2 }]}>
                {computedDecomp.serving.kcal === null ? 'Calories unknown' : `${Math.round(computedDecomp.serving.kcal)} kcal`} · estimate
              </Text>
              <Text style={[type.micro, { color: theme.textMuted, marginTop: 2 }]}>
                Protein: {computedDecomp.serving.protein_g?.toFixed(1) ?? 'unknown'}g · Carbs: {computedDecomp.serving.carbs_g?.toFixed(1) ?? 'unknown'}g · Fat: {computedDecomp.serving.fat_g?.toFixed(1) ?? 'unknown'}g · Fiber: {computedDecomp.serving.fiber_g?.toFixed(1) ?? 'unknown'}g
              </Text>
              <Text style={[type.micro, { color: theme.textFaint, marginTop: 4 }]}>
                Raw mass: {computedDecomp.rawMassGrams}g → Cooked yield: {Math.round(computedDecomp.cookedYieldGrams)}g
              </Text>
            </View>
          )}

          {/* Action Buttons */}
          <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.md }}>
            <Pressable
              accessibilityRole="button"
              disabled={savingDecomp || !computedDecomp}
              onPress={handleLogDecomposed}
              style={[styles.actionBtn, { flex: 1, backgroundColor: theme.protein, borderColor: theme.protein }]}
            >
              <Text style={[type.body, { color: '#fff', fontWeight: '600' }]}>Log to Today</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={savingDecomp || !computedDecomp}
              onPress={handleSaveCustomFood}
              style={[styles.actionBtn, { flex: 1, backgroundColor: theme.bg, borderColor: theme.border }]}
            >
              <Text style={[type.body, { color: theme.text, fontWeight: '600' }]}>Save to Foods</Text>
            </Pressable>
          </View>
        </View>
      )}

      <Text style={[type.micro, { color: theme.textFaint, marginTop: space.xl, lineHeight: 17 }]}>
        IFCT 2017: ICMR-NIN, used with permission. USDA FoodData Central: U.S. public domain.
        Open Food Facts barcode data: ODbL 1.0. Nut AI Indian Dish Knowledge Base.
      </Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  retry: { minHeight: MIN_TAP_TARGET, alignSelf: 'flex-start', marginTop: space.sm, paddingHorizontal: space.lg, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  input: {
    marginTop: space.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 16,
    minHeight: 48,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  compositeCard: {
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
  },
  actionBtn: {
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  decomposeContainer: {
    marginTop: space.lg,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  smallInput: {
    marginTop: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 14,
    minHeight: 38,
  },
  chip: {
    paddingHorizontal: space.sm,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  nutritionBox: {
    marginTop: space.md,
    padding: space.sm,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
})

function sourceLabel(source: string | undefined): string {
  if (source === 'ifct') return 'IFCT 2017 · ICMR-NIN'
  if (source === 'recipe') return 'HOUSEHOLD RECIPE'
  if (source === 'userfood') return 'YOUR FOOD'
  if (source === 'off') return 'OPEN FOOD FACTS · ODbL 1.0'
  if (source === 'indian_dish_kb') return 'INDIAN DISH KB'
  return 'USDA FOODDATA CENTRAL'
}
