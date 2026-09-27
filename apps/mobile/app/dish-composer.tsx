import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { StyleSheet, Text, View, TextInput, ScrollView, Pressable, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../src/theme/ThemeProvider'
import { radius, space, type } from '../src/theme/tokens'
import { openNutritionDb, openIfctDb, openUserDb } from '../src/db/expo-adapter'

import type { DbAdapter } from '@nutai/db-adapter'

import { encodeFoodReview } from '../src/data/food-review'
import { per100Snapshot } from '../src/data/dish-snapshot'
import { resolveByText } from '@nutai/resolver'

type DishDef = any
type Component = { id: string, name: string, foodId: string | null, grams: number, protein_g: number|null, carbs_g: number|null, fat_g: number|null, kcal: number|null, searchResults?: any[] }

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
  const [fatGrams, setFatGrams] = useState('14')
  
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
           recipeTemplate: JSON.parse(row.recipe_template_json || '{}')
        }
        if (alive) setDish(parsed)
        
        // Extract components
        const comps: Component[] = []
        if (parsed.recipeTemplate.ingredientSlots) {
          for (const slot of parsed.recipeTemplate.ingredientSlots) {
            const foodId = slot.nutritionMapping?.canonicalFoodId || null
            const name = slot.label
            const grams = 50 // default
            let nutrient = { kcal: null as number|null, protein_g: null as number|null, carbs_g: null as number|null, fat_g: null as number|null }
            
            if (foodId) {
              const res = await ifctDb.get<any>('SELECT * FROM foods WHERE source_id = ?', [foodId.replace('ifct:', '')])
              if (res) {
                 nutrient = { kcal: res.energy_kcal, protein_g: res.protein_g, carbs_g: res.carb_g, fat_g: res.fat_g }
              }
            }
            comps.push({ id: Math.random().toString(), name, foodId, grams, ...nutrient })
          }
        }
        if (alive) {
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
    // For testing, just add a dummy empty ingredient
    setComponents([...components, { id: Math.random().toString(), name: 'New Ingredient', foodId: null, grams: 0, kcal: null, protein_g: null, carbs_g: null, fat_g: null }])
  }

  const removeComponent = (id: string) => {
    setComponents(components.filter(c => c.id !== id))
  }

  
  const updateName = (id: string, text: string) => {
    setComponents(components.map(c => c.id === id ? { ...c, name: text, foodId: null, kcal: null, protein_g: null, carbs_g: null, fat_g: null, searchResults: [] } : c))
  }

  const searchIngredient = async (id: string, query: string) => {
    if (!db) return;
    const c = components.find(x => x.id === id);
    if (!c) return;
    try {
      const res = await resolveByText(db, { canonicalFoodKey: query, observedBrand: null, prepFacet: null, modelCategory: null, estimatedGrams: c.grams || 100 }, { ifctDb: ifctDb || undefined })
      const candidates = res.outcome.kind === 'auto_accept' ? [res.outcome.match] : (res.outcome.kind === 'disambiguate' ? res.outcome.candidates : []);
      setComponents(components.map(x => x.id === id ? { ...x, searchResults: candidates } : x))
    } catch {}
  }

  const selectCandidate = (id: string, candidate: any) => {
    setComponents(components.map(x => x.id === id ? { 
      ...x, 
      foodId: candidate.foodId, 
      name: candidate.name, 
      kcal: candidate.energyKcal, 
      protein_g: candidate.proteinG, 
      carbs_g: candidate.carbG, 
      fat_g: candidate.fatG, 
      searchResults: [] 
    } : x))
  }

  const updateGrams = (id: string, text: string) => {
    setComponents(components.map(c => c.id === id ? { ...c, grams: parseFloat(text) || 0 } : c))
  }

  const totalRawMass = components.reduce((s, c) => s + c.grams, 0)
  const totalFat = parseFloat(fatGrams) || 0
  const cookedYield = totalRawMass + totalFat // Simple estimate
  
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
  
  const portionKcal = hasUnknowns ? null : totalKcal * multiplier
  const portionP = hasUnknowns ? null : totalP * multiplier
  const portionC = hasUnknowns ? null : totalC * multiplier
  const portionF = hasUnknowns ? null : totalF * multiplier

    const logDish = async () => {
    if (hasUnknowns) return alert("Resolve all ingredients first")
    if (!(portionG > 0)) return alert("Enter a valid portion weight")
    
    // Create/update the Household Variant in dish_definitions
    const isEditingHousehold = dish?.recordStatus === 'HOUSEHOLD'
    const newId = isEditingHousehold ? params.dishId : dish?.id + '_household_' + Date.now()
    const searchRowId = isEditingHousehold ? dish.searchRowId : Math.floor(Math.random() * 1000000)
    const canonicalName = isEditingHousehold ? dish.canonicalName : dish?.canonicalName + ' (My Version)'
    const parentDishId = isEditingHousehold ? dish.parentDishId : dish?.id
    
    const recipeTemplate = {
      ...dish?.recipeTemplate,
      ingredientSlots: components.map(c => ({
        label: c.name,
        nutritionMapping: { canonicalFoodId: c.foodId }
      }))
    }
    
    // WEB-003: save the household variant to the WRITABLE user DB, not the
    // read-only nutrition corpus. On web the corpus is deserialized with
    // SQLITE_DESERIALIZE_READONLY, so every save used to fail silently and the
    // user's "My Version" dish was never persisted.
    if (!userDb) {
      alert('Database is still loading — please try again in a moment.')
      return
    }
    try {
      await ensureUserDishTable(userDb)
      await userDb.run(
        'INSERT OR REPLACE INTO dish_definitions (id, search_rowid, canonical_name, category, family, parent_dish_id, recipe_template_json, portion_model_json, record_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [newId, searchRowId, canonicalName, dish?.category || '', dish?.family || '', parentDishId, JSON.stringify(recipeTemplate), '{}', 'HOUSEHOLD']
      )
    } catch (e) {
      console.error('Failed to save household variant:', e)
      alert('Could not save your version of this dish. ' + String(e))
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
        <Pressable onPress={() => router.back()} style={[s.btn, { borderColor: t.border, marginTop: space.md }]}>
          <Text style={{ color: t.text, textAlign: 'center' }}>Back</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <ScrollView style={[s.container, { backgroundColor: t.bg, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={s.headerRow}>
        <Text style={[type.title, { color: t.text }]}>Compose: {dish?.canonicalName}</Text>
        <Pressable onPress={() => router.back()} hitSlop={space.md}>
          <Text style={[type.body, { color: t.textMuted }]}>Cancel</Text>
        </Pressable>
      </View>
      
      {dish?.recordStatus === 'CURATED' ? (
        <Text style={[s.alert, { color: t.protein }]}>✓ Curated Recipe. You can still modify to a household variant.</Text>
      ) : (
        <Text style={[s.alert, { color: t.safety }]}>Draft Recipe. Review ingredients and quantities before logging.</Text>
      )}

      {components.map((c) => (
        <View key={c.id} style={[s.row, { borderColor: t.border, flexDirection: 'column', alignItems: 'stretch' }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
               <TextInput style={[type.body, { color: t.text, padding: 0, margin: 0, fontWeight: 'bold' }]} value={c.name} onChangeText={t => updateName(c.id, t)} placeholder="Ingredient Name" placeholderTextColor={t.textMuted} />
               {c.foodId ? <Text style={[type.micro, { color: t.protein }]}>Resolved: {c.foodId}</Text> : <Text style={[type.micro, { color: t.safety }]}>Unresolved Ingredient</Text>}
               <Text style={[type.caption, { color: t.textMuted }]}>
                 {c.kcal !== null ? `${Math.round(c.kcal * (c.grams/100))} kcal · ${Math.round((c.protein_g||0)*(c.grams/100))}g P` : 'Unknown nutrition'}
               </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TextInput style={[s.input, { color: t.text, borderColor: t.border }]} value={String(c.grams)} onChangeText={t => updateGrams(c.id, t)} keyboardType="numeric" />
              <Text style={{ color: t.text, marginLeft: 4 }}>g</Text>
              <Pressable onPress={() => removeComponent(c.id)} style={{ marginLeft: space.md }}><Text style={{ color: t.safety }}>✕</Text></Pressable>
            </View>
          </View>
          
          {!c.foodId && (
            <View style={{ marginTop: space.sm }}>
               <Pressable onPress={() => searchIngredient(c.id, c.name)} style={[s.btn, { borderColor: t.protein, paddingVertical: 4 }]}><Text style={{ color: t.protein, textAlign: 'center' }}>Search Database</Text></Pressable>
               {c.searchResults && c.searchResults.map((res: any) => (
                  <Pressable key={res.foodId} onPress={() => selectCandidate(c.id, res)} style={{ padding: space.sm, borderBottomWidth: 1, borderColor: t.border }}>
                     <Text style={{ color: t.text }}>{res.name}</Text>
                     <Text style={[type.micro, { color: t.textMuted }]}>{res.energyKcal} kcal / 100g</Text>
                  </Pressable>
               ))}
            </View>
          )}
        </View>
      ))}

      <Pressable onPress={addIngredient} style={[s.btn, { borderColor: t.border }]}><Text style={{ color: t.text }}>+ Add Ingredient</Text></Pressable>

      <View style={[s.row, { borderColor: t.border }]}>
        <Text style={[type.body, { color: t.text, flex: 1 }]}>Cooking Fat (g)</Text>
        <TextInput style={[s.input, { color: t.text, borderColor: t.border }]} value={fatGrams} onChangeText={setFatGrams} keyboardType="numeric" />
      </View>
      <View style={[s.row, { borderColor: t.border }]}>
        <Text style={[type.body, { color: t.text, flex: 1 }]}>Final Portion (g)</Text>
        <TextInput style={[s.input, { color: t.text, borderColor: t.border }]} value={portion} onChangeText={setPortion} keyboardType="numeric" />
      </View>

      <View style={[s.summary, { backgroundColor: t.bgSunken, borderColor: t.border }]}>
        <Text style={[type.title, { color: t.text }]}>Nutrition ({portionG}g)</Text>
        {hasUnknowns ? (
          <Text style={[type.body, { color: t.safety }]}>Resolve ingredients to calculate.</Text>
        ) : (
          <View>
            <Text style={[type.body, { color: t.protein, fontWeight: 'bold' }]}>{Math.round(portionKcal||0)} kcal</Text>
            <Text style={[type.caption, { color: t.textMuted }]}>P: {Math.round(portionP||0)}g · C: {Math.round(portionC||0)}g · F: {Math.round(portionF||0)}g</Text>
          </View>
        )}
      </View>

      <Pressable onPress={logDish} style={[s.saveBtn, { backgroundColor: hasUnknowns ? t.bgElevated : t.text, borderColor: t.border }]}>
        <Text style={{ color: hasUnknowns ? t.textMuted : t.bg, fontWeight: 'bold', textAlign: 'center' }}>Log Household Variant</Text>
      </Pressable>
    </ScrollView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space.md },
  alert: { padding: space.md, fontWeight: 'bold' },
  row: { flexDirection: 'row', padding: space.md, borderBottomWidth: 1, alignItems: 'center' },
  input: { borderWidth: 1, borderRadius: 4, width: 60, textAlign: 'center', paddingVertical: 4 },
  btn: { margin: space.md, padding: space.md, borderWidth: 1, borderRadius: radius.md, alignItems: 'center' },
  summary: { margin: space.md, padding: space.md, borderWidth: 1, borderRadius: radius.md },
  saveBtn: { margin: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1 }
})
