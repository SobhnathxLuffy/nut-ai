import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { StyleSheet, Text, View, TextInput, ScrollView, Pressable, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../src/theme/tokens'
import { openNutritionDb, openIfctDb, openUserDb } from '../src/db/expo-adapter'
import { showToast } from '../src/components/toast-store'

import type { DbAdapter } from '@nutai/db-adapter'
import { COOKING_FAT_OPTIONS, COOKING_METHOD_OPTIONS, resolveCookedYieldGrams } from '@nutai/indian-dishes'
import {
  searchIngredientOptions,
  createIngredientFood,
  type IngredientOption,
} from '../src/data/ingredient-options'

import { encodeFoodReview } from '../src/data/food-review'
import { per100Snapshot } from '../src/data/dish-snapshot'
import { dishIngredientBreakdown } from '../src/data/dish-ingredients'
import { ChipRow } from '../src/components/ChipRow'
import { NewIngredientForm } from '../src/components/NewIngredientForm'
import { Icon } from '../src/components/Icon'

type DishDef = any
interface Component { id: string, name: string, foodId: string | null, resolvedName: string | null, source: string, grams: number, protein_g: number|null, carbs_g: number|null, fat_g: number|null, kcal: number|null }

// WEB-003: household variants are persisted in the writable user DB. The table
// mirrors the corpus schema columns this screen reads and writes.
async function ensureUserDishTable(u: DbAdapter): Promise<void> {
  await u.run(
    `CREATE TABLE IF NOT EXISTS dish_definitions (
      id TEXT PRIMARY KEY NOT NULL,
      search_rowid INTEGER,
      canonical_name TEXT,
      category TEXT,
      family TEXT,
      parent_dish_id TEXT,
      recipe_template_json TEXT,
      portion_model_json TEXT,
      record_status TEXT
    )`
  )
}

interface NutrientFetch { name: string | null, kcal: number | null, protein_g: number | null, carbs_g: number | null, fat_g: number | null }

async function fetchFoodNutrients(
  nutritionDb: DbAdapter,
  ifctDb: DbAdapter | null,
  userDb: DbAdapter | null,
  foodId: string,
): Promise<NutrientFetch | null> {
  if (foodId.startsWith('ifct:') && ifctDb) {
    const row = await ifctDb.get<any>('SELECT name, energy_kcal, protein_g, fat_g, carb_g FROM foods WHERE source_id = ?', [foodId.slice(5)])
    return row ? { name: row.name, kcal: row.energy_kcal, protein_g: row.protein_g, carbs_g: row.carb_g, fat_g: row.fat_g } : null
  }
  if (foodId.startsWith('usda:') && nutritionDb) {
    const row = await nutritionDb.get<any>("SELECT name, energy_kcal, protein_g, fat_g, carb_g FROM foods WHERE source_id = ? AND source LIKE 'fdc_%'", [foodId.slice(5)])
    return row ? { name: row.name, kcal: row.energy_kcal, protein_g: row.protein_g, carbs_g: row.carb_g, fat_g: row.fat_g } : null
  }
  if (foodId.startsWith('userfood:') && userDb) {
    const row = await userDb.get<any>('SELECT name, energy_kcal, protein_g, fat_g, carb_g FROM user_foods WHERE uuid = ? AND deleted_at IS NULL', [foodId.slice('userfood:'.length)])
    return row ? { name: row.name, kcal: row.energy_kcal, protein_g: row.protein_g, carbs_g: row.carb_g, fat_g: row.fat_g } : null
  }
  return null
}

let componentKeySeq = 0
function nextComponentKey(): string {
  componentKeySeq += 1
  return `c${componentKeySeq}`
}

export default function DishComposerScreen() {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ dishId?: string, newDishName?: string, date?: string }>()

  const [db, setDb] = useState<DbAdapter | null>(null)
  const [ifctDb, setIfctDb] = useState<DbAdapter | null>(null)
  const [userDb, setUserDb] = useState<DbAdapter | null>(null)
  const [dish, setDish] = useState<DishDef | null>(null)
  const [components, setComponents] = useState<Component[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [portion, setPortion] = useState('150')
  // FAT SELECTOR IS THE RECIPE'S FAT — never a second silent serving of it.
  // Initial state is overwritten by the dish load effect: a dish with its own
  // fat ingredient preselects that oil with the recipe's grams; a dish
  // without one opens at "No Added Oil / Dry Roasted" (0 g). The old
  // hardcoded mustard-14g default double-counted every dish whose template
  // already carried frying oil / tadka fat (Samosa, Sambar, Poha, Chole
  // Bhature, …) — ~100-130 kcal of invisible fat per serving.
  const [fatOptionId, setFatOptionId] = useState<string>('no-added-oil')
  const [fatGrams, setFatGrams] = useState<string>('0')
  const [cookingMethod, setCookingMethod] = useState('curried')
  const [fatNutrients, setFatNutrients] = useState<NutrientFetch | null>(null)
  // VERIFIED-YIELD RULE: a curated dish carries a verified cooked yield
  // (e.g. roti 0.88). Using it keeps the composer arithmetic IDENTICAL to the
  // curated per-100 g numbers shown in search — generic method multipliers
  // are only a fallback for dishes without one.
  const [recipeYield, setRecipeYield] = useState<number | null>(null)
  const [useRecipeYield, setUseRecipeYield] = useState(true)

  // Ingredient search across user foods + IFCT + USDA, plus the create-new
  // flow for ingredients no database knows — now owned PER COMPONENT by
  // <IngredientResolver> (QA P2-21): one shared query state used to make
  // every unresolved component's box type into the same query, duplicate the
  // same result list, and attach taps to the wrong row.

  useEffect(() => {
    let alive = true
    // WEB-003: the user DB is the writable store. Household variants are user
    // data and must never be written into the read-only nutrition corpus.
    Promise.all([openNutritionDb(), openIfctDb(), openUserDb()]).then(async ([h, ih, u]) => {
      if (!alive) return
      await ensureUserDishTable(u)
      if (alive) { setDb(h); setIfctDb(ih); setUserDb(u) }
    }).catch(e => {
      if (alive) { setError(String(e)); setLoading(false) }
    })
    return () => { alive = false }
  }, [])

  const newComponent = (name: string, foodId: string | null, source: string, grams: number): Component => ({
    id: nextComponentKey(), name, foodId, resolvedName: null, source, grams, kcal: null, protein_g: null, carbs_g: null, fat_g: null,
  })

  useEffect(() => {
    if (!db || !ifctDb || !userDb) return
    let alive = true
    const load = async () => {
      try {
        if (!params.dishId && params.newDishName) {
           if (alive) {
              setDish({
                 id: 'new_dish_' + Date.now(),
                 searchRowId: Math.floor(Math.random() * 1000000),
                 parentDishId: null,
                 category: 'Custom',
                 family: '',
                 canonicalName: params.newDishName,
                 recordStatus: 'HOUSEHOLD',
                 recipeTemplate: { ingredientSlots: [] }
              })
              setComponents([])
              setLoading(false)
           }
           return
        }

        // WEB-003: household variants live in the user DB; the corpus is
        // read-only and only holds curated/draft definitions.
        const row = (await userDb.get<any>('SELECT * FROM dish_definitions WHERE id = ?', [params.dishId as string]))
          ?? (await db.get<any>('SELECT * FROM dish_definitions WHERE id = ?', [params.dishId as string]))
        if (!row) throw new Error('Dish not found')
        const parsed = {
           id: row.id,
           searchRowId: row.search_rowid,
           parentDishId: row.parent_dish_id,
           category: row.category,
           family: row.family,
           canonicalName: row.canonical_name,
           recordStatus: row.record_status,
           recipeTemplate: JSON.parse(row.recipe_template_json || '{}'),
           yieldModel: JSON.parse(row.yield_model_json || '{}'),
           portionModel: JSON.parse(row.portion_model_json || '{}')
        }
        if (alive) setDish(parsed)

        // Portion + yield come from the reviewed record, not flat defaults:
        // a roti opens at its verified 40 g standard portion with the verified
        // 0.88 cooked yield, not 150 g / 'curried'.
        const verifiedYield = typeof parsed.yieldModel?.verifiedNumericYield === 'number' && parsed.yieldModel.verifiedNumericYield > 0
          ? parsed.yieldModel.verifiedNumericYield
          : null
        if (alive && verifiedYield != null) {
          setRecipeYield(verifiedYield)
          setUseRecipeYield(true)
        } else if (alive) {
          setRecipeYield(null)
        }

        // Build components from the saved template. The template's own slots
        // win. (P2-11: the name-derived "ingredientSuggestions" fallback was
        // deleted — the mechanism was provably inert for the all-CURATED
        // corpus and never produced a single suggestion.)
        const slots: any[] = parsed.recipeTemplate.ingredientSlots ?? []

        // FRACTION -> GRAMS: verified slot ranges are mass fractions of the
        // raw batch. dishIngredientBreakdown converts them to the SAME
        // per-serving grams the deterministic engine uses — mid(range)/SUM(mids)
        // x (standardPortionGrams / verifiedNumericYield). A roti opens with
        // 1.1 g ghee, never the old flat 50 g fallback.
        const breakdown = dishIngredientBreakdown(row, true)

        const comps: Component[] = []
        // REFLECTIVE FAT DEFAULT. Priority order:
        //   1. A fat_variable slot whose mapped food the selector represents
        //      (ghee, mustard, sunflower, groundnut, butter) FOLDS into the
        //      selector — the slot becomes the preselected option with the
        //      fraction-derived grams and is NOT rendered twice.
        //   2. Otherwise a household variant's explicitly saved fat
        //      (template.addedFat) is restored exactly as saved.
        //   3. Otherwise the selector opens at No Added Oil (0 g) — the
        //      recipe's own named fat rows are the single source of truth.
        let fatDefaultApplied = false
        for (const slot of slots) {
            const foodId = slot.nutritionMapping?.canonicalFoodId || null
            const line = breakdown.lines.find((candidate) => candidate.label === slot.label)
            // FOLDING RULE: a fat_variable slot whose mapped food the Cooking
            // Fat / Oil selector represents (ghee, mustard, sunflower,
            // groundnut, butter) is NOT rendered twice. It becomes the
            // selector's preselected option with the fraction-derived grams.
            if (line?.foldedIntoFat && breakdown.fatFold) {
              const option = COOKING_FAT_OPTIONS.find((f) => f.optionId === breakdown.fatFold!.optionId)
              if (option) {
                if (alive) {
                  setFatOptionId(option.optionId)
                  setFatGrams(String(Math.round(breakdown.fatFold.grams * 10) / 10))
                }
                fatDefaultApplied = true
                continue
              }
            }
            const grams = line && line.grams > 0
              ? line.grams
              : (typeof slot.amountPrior?.grams === 'number' && slot.amountPrior.grams > 0 ? slot.amountPrior.grams : 30)
            const comp = newComponent(line?.display ?? slot.label, foodId, foodId ? foodId.split(':')[0] : '', grams)
            if (foodId) {
              const nutrients = await fetchFoodNutrients(db, ifctDb, userDb, foodId)
              if (nutrients) {
                comp.resolvedName = nutrients.name
                comp.kcal = nutrients.kcal
                comp.protein_g = nutrients.protein_g
                comp.carbs_g = nutrients.carbs_g
                comp.fat_g = nutrients.fat_g
              }
            }
            comps.push(comp)
        }
        if (alive) {
          if (breakdown.standardPortionGrams != null) setPortion(String(breakdown.standardPortionGrams))
          if (!fatDefaultApplied) {
            // Reflect the recipe: restore an explicitly saved household fat,
            // else open with no added fat. Never a silent 14 g.
            const savedFat = parsed.recipeTemplate?.addedFat
            const savedOption = savedFat?.foodId
              ? COOKING_FAT_OPTIONS.find((f) => f.foodId === savedFat.foodId)
              : null
            if (savedOption) {
              setFatOptionId(savedOption.optionId)
              setFatGrams(String(Math.round((savedFat.grams ?? savedOption.defaultGrams) * 10) / 10))
            } else {
              setFatOptionId('no-added-oil')
              setFatGrams('0')
            }
          }
          setComponents(comps)
          setLoading(false)
        }
      } catch (e) {
        if (alive) { setError(String(e)); setLoading(false) }
      }
    }
    load()
    return () => { alive = false }
  }, [db, ifctDb, userDb, params.dishId])

  const addIngredient = () => {
    setComponents([...components, newComponent('New Ingredient', null, '', 100)])
  }

  const removeComponent = (id: string) => {
    setComponents(components.filter(c => c.id !== id))
  }

  const updateName = (id: string, text: string) => {
    setComponents(components.map(c => c.id === id ? { ...c, name: text, foodId: null, resolvedName: null, kcal: null, protein_g: null, carbs_g: null, fat_g: null } : c))
  }

  const updateGrams = (id: string, text: string) => {
    setComponents(components.map(c => c.id === id ? { ...c, grams: parseFloat(text) || 0 } : c))
  }

  const attachCandidate = (id: string, option: IngredientOption, nutrients: NutrientFetch | null) => {
    setComponents(components.map(c => c.id === id ? {
      ...c,
      foodId: option.foodId,
      name: option.label,
      resolvedName: nutrients?.name ?? option.label,
      kcal: nutrients?.kcal ?? option.kcalPer100g,
      protein_g: nutrients?.protein_g ?? null,
      carbs_g: nutrients?.carbs_g ?? null,
      fat_g: nutrients?.fat_g ?? null,
    } : c))
  }

  const fatOption = COOKING_FAT_OPTIONS.find((f) => f.optionId === fatOptionId) ?? COOKING_FAT_OPTIONS[0]
  const fatG = fatOption.foodId ? parseFloat(fatGrams) || 0 : 0

  // The selected fat's nutrient row (per-100 g) — fetched like any ingredient.
  useEffect(() => {
    if (!db || !fatOption?.foodId) {
      setFatNutrients(null)
      return
    }
    let alive = true
    fetchFoodNutrients(db, ifctDb, userDb, fatOption.foodId).then((n) => {
      if (alive) setFatNutrients(n)
    })
    return () => { alive = false }
  }, [db, ifctDb, userDb, fatOptionId])

  const totalRawMass = components.reduce((s, c) => s + c.grams, 0) + fatG
  // Same yield model the decomposer uses — water-adding methods scale the pot
  // up, moisture-loss methods shrink it, deep frying absorbs extra oil. When
  // the dish carries a verified recipe yield (curated records do), it governs
  // instead so the composer reproduces the curated numbers exactly.
  const effectiveYieldMultiplier = useRecipeYield && recipeYield != null ? recipeYield : null
  const cookedYield = totalRawMass > 0
    ? (effectiveYieldMultiplier != null
        ? totalRawMass * effectiveYieldMultiplier
        // eslint-disable-next-line no-restricted-syntax -- cookingMethod arrives as free text and is funnelled through the yield engine's union
        : resolveCookedYieldGrams(totalRawMass, fatG, cookingMethod as any).cookedYieldGrams)
    : 0

  const portionG = parseFloat(portion) || 150
  const multiplier = cookedYield > 0 ? portionG / cookedYield : 0

  let totalKcal = 0; let totalP = 0; let totalC = 0; let totalF = 0;
  let hasUnknowns = false
  for (const c of components) {
     if (c.kcal === null) hasUnknowns = true
     else {
       totalKcal += c.kcal * (c.grams/100)
       totalP += (c.protein_g||0) * (c.grams/100)
       totalC += (c.carbs_g||0) * (c.grams/100)
       totalF += (c.fat_g||0) * (c.grams/100)
     }
  }
  // The cooking fat's nutrients are part of the dish. Previously the fat only
  // added MASS here — its calories silently vanished from the total.
  if (fatOption.foodId) {
    if (fatNutrients && fatNutrients.kcal != null) {
      totalKcal += fatNutrients.kcal * (fatG / 100)
      totalP += (fatNutrients.protein_g || 0) * (fatG / 100)
      totalC += (fatNutrients.carbs_g || 0) * (fatG / 100)
      totalF += (fatNutrients.fat_g || 0) * (fatG / 100)
    } else {
      hasUnknowns = true
    }
  }

  const portionKcal = hasUnknowns ? null : totalKcal * multiplier
  const portionP = hasUnknowns ? null : totalP * multiplier
  const portionC = hasUnknowns ? null : totalC * multiplier
  const portionF = hasUnknowns ? null : totalF * multiplier

    const logDish = async () => {
    // UI/UX report §10.1 (Wave 1b): reversible validation and save failures
    // are toasts — the review data is untouched and the user simply retries.
    if (hasUnknowns) return showToast({ message: 'Resolve all ingredients first — every component needs a nutrition match before the dish can be logged.', tone: 'error' })
    if (!(portionG > 0)) return showToast({ message: 'Enter a valid portion weight — the final portion must be greater than zero grams.', tone: 'error' })

    // Create/update the Household Variant in dish_definitions
    const isEditingHousehold = dish?.recordStatus === 'HOUSEHOLD'
    const newId = isEditingHousehold ? params.dishId : dish?.id + '_household_' + Date.now()
    const searchRowId = isEditingHousehold ? dish.searchRowId : Math.floor(Math.random() * 1000000)
    const canonicalName = isEditingHousehold ? dish.canonicalName : dish?.canonicalName + ' (My Version)'
    const parentDishId = isEditingHousehold ? dish.parentDishId : dish?.id

    // Persist the user's CONFIRMED grams, fat, method, and portion so the
    // household variant can be re-computed (and re-found in search) later —
    // not just logged once.
    const recipeTemplate = {
      ...dish?.recipeTemplate,
      ingredientSlots: components.map(c => ({
        label: c.name,
        nutritionMapping: { canonicalFoodId: c.foodId },
        amountPrior: { kind: 'HOUSEHOLD_MEASURED', grams: c.grams, verified: true },
      })),
      addedFat: fatOption.foodId ? { foodId: fatOption.foodId, grams: fatG } : null,
      cookingMethod,
    }

    // WEB-003: save the household variant to the WRITABLE user DB, not the
    // read-only nutrition corpus. On web the corpus is deserialized with
    // SQLITE_DESERIALIZE_READONLY, so every save used to fail silently and the
    // user's "My Version" dish was never persisted.
    if (!userDb) {
      showToast({ message: 'Database is still loading — try again in a moment.', tone: 'error' })
      return
    }
    try {
      await ensureUserDishTable(userDb)
      await userDb.run(
        'INSERT OR REPLACE INTO dish_definitions (id, search_rowid, canonical_name, category, family, parent_dish_id, recipe_template_json, portion_model_json, record_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [newId, searchRowId, canonicalName, dish?.category || '', dish?.family || '', parentDishId, JSON.stringify(recipeTemplate), JSON.stringify({ standardPortionGrams: portionG, standardPortionStatus: 'verified', assumptionClass: 'HOUSEHOLD' }), 'HOUSEHOLD']
      )
    } catch (e) {
      console.error('Failed to save household variant:', e)
      showToast({ message: `Could not save your version of this dish: ${String(e)}`, tone: 'error' })
      return
    }

    const selection = {
        foodId: null,
        matchedFoodSource: 'household_variant',
        displayName: canonicalName,
        grams: portionG,
        gramPathway: 'decomposed_recipe',
        portionSource: 'user_decomposition',
        // P0-1: nutrientSnapshot is PER-100 g — food-review renders value × grams/100.
        // Sending the portion total here double-scaled every household-variant log.
        nutrientSnapshot: per100Snapshot({ kcal: portionKcal, protein_g: portionP, carbs_g: portionC, fat_g: portionF }, portionG)
    }
    router.push({ pathname: '/food-review', params: { payload: encodeFoodReview({ selection, date: params.date || '' }) } } as never)
  }

  if (loading) return <View style={s.container}><ActivityIndicator /></View>

  if (error) {
    return (
      <View style={[s.container, { backgroundColor: t.bg, paddingTop: insets.top, paddingBottom: insets.bottom, padding: space.md }]}>
        <Text style={[type.body, { color: t.safety }]}>{error}</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={[s.btn, { borderColor: t.border, marginTop: space.md }]}>
          <Text style={{ color: t.text, textAlign: 'center' }}>Back</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <ScrollView style={[s.container, { backgroundColor: t.bg, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={s.headerRow}>
        <Text accessibilityRole="header" style={[type.title, { color: t.text }]}>Compose: {dish?.canonicalName}</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={space.md}>
          <Text style={[type.body, { color: t.textMuted }]}>Cancel</Text>
        </Pressable>
      </View>

      {dish?.recordStatus === 'CURATED' ? (
        <Text style={[s.alert, { color: t.protein }]}>Curated recipe — you can still modify to a household variant.</Text>
      ) : (
        <Text style={[s.alert, { color: t.safety }]}>Draft Recipe. Review ingredients and quantities before logging.</Text>
      )}

      {components.map((c) => (
        <View key={c.id} style={[s.row, { borderColor: t.border, flexDirection: 'column', alignItems: 'stretch' }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
               <TextInput style={[type.body, { color: t.text, padding: 0, margin: 0, fontWeight: 'bold' }]} value={c.name} onChangeText={t => updateName(c.id, t)} placeholder="Ingredient Name" placeholderTextColor={t.textMuted} />
               {/* P1-9: show the resolved food's NAME — a raw source id like
                   ifct:A019 tells the user nothing about the ingredient. */}
               {c.foodId ? <Text style={[type.caption, { color: t.protein }]} numberOfLines={2}>Resolved: {c.resolvedName ?? c.foodId}</Text> : <Text style={[type.caption, { color: t.safety }]}>Unresolved Ingredient</Text>}
               <Text style={[type.caption, { color: t.textMuted }]}>
                 {c.kcal !== null ? `${Math.round(c.kcal * (c.grams/100))} kcal · ${Math.round((c.protein_g||0)*(c.grams/100))}g P` : 'Unknown nutrition'}
               </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TextInput style={[s.input, { color: t.text, borderColor: t.border }]} value={String(c.grams)} onChangeText={t => updateGrams(c.id, t)} keyboardType="numeric" accessibilityLabel={`Grams of ${c.name}`} />
              <Text style={{ color: t.text, marginLeft: 4 }}>g</Text>
              {/* UI/UX report Table 12.1 (Wave 1b): the unicode ✕ remove glyph
                  joins the icon set — one close affordance across the app. */}
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${c.name}`} onPress={() => removeComponent(c.id)} style={{ marginLeft: space.md }}><Icon name="close" size={18} color={t.safety}/></Pressable>
            </View>
          </View>

          {!c.foodId && (
            <IngredientResolver
              component={c}
              db={db}
              ifctDb={ifctDb}
              userDb={userDb}
              onResolve={(option, nutrients) => attachCandidate(c.id, option, nutrients)}
            />
          )}
        </View>
      ))}

      <Pressable accessibilityRole="button" onPress={addIngredient} style={[s.btn, { borderColor: t.border }]}><Text style={{ color: t.text }}>+ Add Ingredient</Text></Pressable>

      <Text style={[type.caption, { color: t.text, fontWeight: '600', marginHorizontal: space.md }]}>Cooking Fat / Oil</Text>
      <ChipRow
        items={COOKING_FAT_OPTIONS}
        keyOf={(item) => item.optionId}
        label={(item) => item.label}
        a11yLabel={(item) => `Select ${item.label}`}
        isActive={(item) => fatOptionId === item.optionId}
        onPress={(item) => { setFatOptionId(item.optionId); setFatGrams(String(item.defaultGrams)) }}
        innerStyle={{ marginHorizontal: space.md }}
        chipStyle={s.chip}
      />
      {fatOption.foodId ? (
        <View style={[s.row, { borderColor: t.border }]}>
          <Text style={[type.body, { color: t.text, flex: 1 }]}>Fat used (g)</Text>
          <TextInput style={[s.input, { color: t.text, borderColor: t.border }]} value={fatGrams} onChangeText={setFatGrams} keyboardType="numeric" accessibilityLabel="Grams of cooking fat" />
        </View>
      ) : null}

      <Text style={[type.caption, { color: t.text, fontWeight: '600', marginHorizontal: space.md }]}>Cooking Method & Yield</Text>
      {recipeYield != null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Use verified recipe yield ${recipeYield}`}
          onPress={() => setUseRecipeYield(true)}
          style={[s.chip, { backgroundColor: useRecipeYield ? t.protein : t.bg, borderColor: t.border, alignSelf: 'flex-start', marginHorizontal: space.md, marginTop: space.xs }]}
        >
          <Text style={[type.caption, { color: useRecipeYield ? t.bg : t.text, fontWeight: '700' }]}>
            Verified recipe yield ×{recipeYield} (matches curated numbers)
          </Text>
        </Pressable>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: space.xs }}>
        <View style={{ flexDirection: 'row', gap: space.xs, marginHorizontal: space.md }}>
          {COOKING_METHOD_OPTIONS.map((item) => {
            const active = useRecipeYield === false && cookingMethod === item.method
            return (
              <Pressable
                key={item.method}
                accessibilityRole="button"
                accessibilityLabel={`Select ${item.label}`}
                accessibilityState={{ selected: active }}
                onPress={() => { setCookingMethod(item.method); setUseRecipeYield(false) }}
                style={[s.chip, { backgroundColor: active ? t.protein : t.bg, borderColor: t.border }]}
              >
                <Text style={[type.caption, { color: active ? t.bg : t.text }]}>{item.label}</Text>
              </Pressable>
            )
          })}
        </View>
      </ScrollView>

      <View style={[s.row, { borderColor: t.border }]}>
        <Text style={[type.body, { color: t.text, flex: 1 }]}>Final Portion (g)</Text>
        <TextInput style={[s.input, { color: t.text, borderColor: t.border }]} value={portion} onChangeText={setPortion} keyboardType="numeric" accessibilityLabel="Final portion grams" />
      </View>

      <View style={[s.summary, { backgroundColor: t.bgSunken, borderColor: t.border }]}>
        <Text style={[type.title, { color: t.text }]}>Nutrition ({portionG}g)</Text>
        {hasUnknowns ? (
          <Text style={[type.body, { color: t.safety }]}>Resolve ingredients to calculate.</Text>
        ) : (
          <View>
            <Text style={[type.body, { color: t.protein, fontWeight: 'bold' }]}>{Math.round(portionKcal||0)} kcal</Text>
            <Text style={[type.caption, { color: t.textMuted }]}>P: {Math.round(portionP||0)}g · C: {Math.round(portionC||0)}g · F: {Math.round(portionF||0)}g</Text>
            <Text style={[type.caption, { color: t.textFaint, marginTop: 2 }]}>Raw {Math.round(totalRawMass)}g → cooked yield {Math.round(cookedYield)}g</Text>
          </View>
        )}
      </View>

      <Pressable accessibilityRole="button" accessibilityLabel="Log household variant" onPress={logDish} style={[s.saveBtn, { backgroundColor: hasUnknowns ? t.bgElevated : t.text, borderColor: t.border }]}>
        <Text style={{ color: hasUnknowns ? t.textMuted : t.bg, fontWeight: 'bold', textAlign: 'center' }}>Log household variant</Text>
      </Pressable>
    </ScrollView>
  )
}

/**
 * QA P2-21: ONE resolver per unresolved component, holding its own query,
 * results, and create-form state. The previous single shared
 * ingredientQuery/ingredientResults pair made every unresolved ingredient's
 * box type into the same query at once, rendered the same result list under
 * all of them, and attached a tapped result to only one row while the others
 * stayed stuck.
 */
function IngredientResolver({
  component,
  db,
  ifctDb,
  userDb,
  onResolve,
}: {
  component: Component
  db: DbAdapter | null
  ifctDb: DbAdapter | null
  userDb: DbAdapter | null
  onResolve: (option: IngredientOption, nutrients: NutrientFetch | null) => void
}) {
  const t = useTheme()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<IngredientOption[]>([])
  const [searching, setSearching] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [newIngredient, setNewIngredient] = useState({ name: '', kcal: '', protein: '', carbs: '', fat: '' })
  const [creating, setCreating] = useState(false)

  // Live multi-corpus ingredient search while typing (debounced, per box).
  useEffect(() => {
    if (!db) return
    const term = query.trim()
    if (term.length < 2) {
      setResults([])
      setSearching(false)
      return
    }
    let alive = true
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const options = await searchIngredientOptions(db, ifctDb ?? undefined, userDb ?? undefined, term)
        if (alive) {
          setResults(options)
          setSearching(false)
        }
      } catch {
        if (alive) setSearching(false)
      }
    }, 250)
    return () => { alive = false; clearTimeout(timer) }
  }, [query, db, ifctDb, userDb])

  const resolve = async (option: IngredientOption) => {
    if (!db) return
    const nutrients = await fetchFoodNutrients(db, ifctDb, userDb, option.foodId)
    onResolve(option, nutrients)
    setQuery('')
    setResults([])
  }

  async function handleCreate() {
    if (!userDb || creating) return
    const name = newIngredient.name.trim()
    const kcal = parseFloat(newIngredient.kcal)
    const protein = parseFloat(newIngredient.protein) || 0
    const carbs = parseFloat(newIngredient.carbs) || 0
    const fat = parseFloat(newIngredient.fat) || 0
    if (!name || !Number.isFinite(kcal) || kcal < 0) {
      showToast({ message: 'Give the ingredient a name and its kcal per 100 g.', tone: 'error' })
      return
    }
    setCreating(true)
    try {
      const food = await createIngredientFood(userDb, { name, kcal, protein_g: protein, carbs_g: carbs, fat_g: fat }, Date.now())
      onResolve(
        { foodId: `userfood:${food.uuid}`, label: food.name, source: 'userfood', kcalPer100g: food.calories },
        { name: food.name, kcal: food.calories, protein_g: food.protein_g, carbs_g: food.carbs_g, fat_g: food.fat_g },
      )
      setNewIngredient({ name: '', kcal: '', protein: '', carbs: '', fat: '' })
      setShowCreate(false)
      setQuery('')
      setResults([])
    } catch (e) {
      showToast({ message: `Could not save the ingredient: ${String(e)}`, tone: 'error' })
    } finally {
      setCreating(false)
    }
  }

  return (
    <View style={{ marginTop: space.sm }}>
      <Text style={[type.caption, { color: t.textMuted }]}>Search your foods, IFCT and USDA — results appear as you type.</Text>
      <TextInput
        value={query}
        onChangeText={(text) => { setQuery(text); setShowCreate(false) }}
        placeholder="Search ingredient databases"
        placeholderTextColor={t.textMuted}
        autoCorrect={false}
        autoCapitalize="none"
        style={[s.searchInput, { color: t.text, borderColor: t.border }]}
        accessibilityLabel={`Search databases for ${component.name}`}
      />
      {searching && <ActivityIndicator style={{ marginTop: 4 }} color={t.textFaint} />}
      {results.map((res) => (
        <Pressable key={res.foodId} accessibilityRole="button" accessibilityLabel={`Select ${res.label}`} onPress={() => void resolve(res)} style={{ padding: space.sm, borderBottomWidth: 1, borderColor: t.border, minHeight: MIN_TAP_TARGET, justifyContent: 'center' }}>
          <Text style={{ color: t.text }}>{res.label}</Text>
          <Text style={[type.caption, { color: t.textMuted }]}>
            {res.source === 'ifct' ? 'IFCT 2017' : res.source === 'userfood' ? 'Your foods' : 'USDA'}
            {res.kcalPer100g != null ? ` · ${Math.round(res.kcalPer100g)} kcal/100g` : ''}
          </Text>
        </Pressable>
      ))}
      {query.trim().length >= 2 && !searching && results.length === 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Create ${query.trim()} as a custom ingredient`}
          onPress={() => { setNewIngredient((prev) => ({ ...prev, name: query.trim() })); setShowCreate(true) }}
          style={[s.btn, { borderColor: t.protein, paddingVertical: 8 }]}
        >
          <Text style={{ color: t.protein, textAlign: 'center' }}>+ Create “{query.trim()}” as a custom ingredient</Text>
        </Pressable>
      )}
      {showCreate && (
        <NewIngredientForm
          value={newIngredient}
          onChange={setNewIngredient}
          onSave={() => void handleCreate()}
          saving={creating}
          containerStyle={[s.summary, { backgroundColor: t.bgSunken, borderColor: t.border, marginTop: space.sm }]}
          nameInputStyle={s.searchInput}
          macroInputStyle={s.input}
        />
      )}
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space.md },
  alert: { padding: space.md, fontWeight: 'bold' },
  row: { flexDirection: 'row', padding: space.md, borderBottomWidth: 1, alignItems: 'center' },
  input: { borderWidth: 1, borderRadius: radius.sm, width: 60, textAlign: 'center', paddingVertical: space.xs, minHeight: MIN_TAP_TARGET },
  searchInput: { borderWidth: 1, borderRadius: radius.sm, paddingVertical: space.xs, paddingHorizontal: 8, marginTop: 4, minHeight: MIN_TAP_TARGET },
  chip: { paddingHorizontal: space.sm, paddingVertical: 6, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, minHeight: MIN_TAP_TARGET, justifyContent: 'center' },
  btn: { margin: space.md, padding: space.md, borderWidth: 1, borderRadius: radius.md, alignItems: 'center' },
  summary: { margin: space.md, padding: space.md, borderWidth: 1, borderRadius: radius.md },
  saveBtn: { margin: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1 }
})
