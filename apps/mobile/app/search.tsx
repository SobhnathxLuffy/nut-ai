import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, BackHandler, View } from 'react-native'
import { TrackingType } from '@nutai/core-schema'
import { addExercise, createExercise, isExerciseInWorkout, listEquipment, listExercises, replaceExercise } from '@nutai/training'
import { rankSearch, type SearchEntity } from '@nutai/search'
import { db } from '../src/data/repo'
import { setPendingRoutineExercises } from '../src/data/routine-draft'
import { Screen, Button, Card, Field, Label, Row, useAction } from '../src/components/Screen'

let cachedBuiltinDocs: SearchEntity[] | null = null
let cachedOwned: string[] | null = null

export default function SearchScreen(){
  const params=useLocalSearchParams<{
    scope?: string
    workoutId?: string
    replace?: string
    routineId?: string
    programId?: string
    mode?: 'browse' | 'single' | 'multi'
    initialSelected?: string
  }>()

  const mode = params.mode ?? (params.routineId ? 'multi' : (params.workoutId || params.replace) ? 'single' : 'browse')
  const isSelectionMode = mode !== 'browse'

  const [query,setQuery]=useState('')
  const [filterOwned,setFilterOwned]=useState(false)
  const [custom,setCustom]=useState(false)
  const [customName,setCustomName]=useState('')
  const [tracking,setTracking]=useState<TrackingType>('weight_reps')
  const [muscle,setMuscle]=useState('')
  const [aliases,setAliases]=useState('')
  const [equipment,setEquipment]=useState('')
  const [loadError,setLoadError]=useState<string|null>(null)

  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => {
    if (params.initialSelected) {
      return new Set(params.initialSelected.split(',').map(Number).filter(Boolean))
    }
    return new Set()
  })

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (custom) {
        setCustom(false)
        return true
      }
      router.back()
      return true
    })
    return () => sub.remove()
  }, [custom])

  const [searchDocs, setSearchDocs] = useState<SearchEntity[]>(cachedBuiltinDocs || [])
  const [owned, setOwned] = useState<string[]>(cachedOwned || [])
  const [initialLoading,setInitialLoading]=useState(!cachedBuiltinDocs)

  const refresh=useCallback(async()=>{
    setLoadError(null)
    try {
      const h=await db()
      if (!cachedBuiltinDocs || cachedBuiltinDocs.length === 0) {
        setInitialLoading(true)
        await new Promise(r => setTimeout(r, 10))
        const all = await listExercises(h)
        const builtins = all.filter(e => !e.is_custom).map(e=>({id:String(e.id),type:'exercise' as const,label:e.name,aliases:e.aliases,source:'builtin' as const,provenance:e.source,custom:false,equipment:e.equipment,muscles:e.primary_muscles,tracking_type:e.tracking_type}))
        cachedBuiltinDocs = builtins
      }
      const customs = (await h.all<any>('SELECT * FROM exercises WHERE is_custom=1 AND deleted_at IS NULL ORDER BY name')).map(r=>({
        id: String(r.id),
        type: 'exercise' as const,
        label: String(r.name),
        aliases: JSON.parse(String(r.aliases_json || '[]')),
        source: 'user' as const,
        provenance: String(r.source || 'user'),
        custom: true,
        equipment: JSON.parse(String(r.equipment_json || '[]')),
        muscles: JSON.parse(String(r.primary_muscles_json || '[]')),
        tracking_type: r.tracking_type as TrackingType
      }))
      const eq = (await listEquipment(h)).map(e=>e.kind)
      cachedOwned = eq
      const combined = [...customs, ...cachedBuiltinDocs]
      setSearchDocs(combined)
      setOwned(eq)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setInitialLoading(false)
    }
  },[])
  const action=useAction()

  useFocusEffect(useCallback(()=>{
    void action.run(refresh)
  },[refresh]))

  const results = useMemo(() => {
    if (!searchDocs || searchDocs.length === 0) return []
    if (!query.trim()) {
      let filtered = searchDocs
      if (filterOwned && owned.length > 0) {
        filtered = filtered.filter(e => !e.equipment || !e.equipment.some(eq => !owned.includes(eq)))
      }
      return filtered.slice(0, 50).map(e => ({ ...e, score: 0, matched_tokens: [] })) as any[]
    }
    return rankSearch(searchDocs, {
      query,
      locale:'en-IN',
      scopes:['exercise'],
      limit:50,
      allowEmpty:true,
      filters: filterOwned ? {equipment:owned} : {}
    }).results
  }, [query, searchDocs, filterOwned, owned])

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const confirmMultiSelect = () => {
    if (selectedIds.size === 0) return
    setPendingRoutineExercises(Array.from(selectedIds))
    router.back()
  }

  async function select(id:number){
    if(mode !== 'single') return
    const h=await db()
    if(params.replace){
      await replaceExercise(h, Number(params.replace), id)
      router.back()
    } else if(params.workoutId){
      const isDup = await isExerciseInWorkout(h, Number(params.workoutId), id)
      if(isDup){
        const exerciseName = searchDocs.find(d => Number(d.id) === id)?.label ?? 'This exercise'
        Alert.alert(
          'Exercise Already Added',
          `"${exerciseName}" is already in this workout. Would you like to add it again?`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Add Again',
              onPress: () => {
                void action.run(async () => {
                  const dbHandle = await db()
                  await addExercise(dbHandle, Number(params.workoutId), id)
                  router.back()
                })
              },
            },
          ],
        )
        return
      }
      await addExercise(h, Number(params.workoutId), id)
      router.back()
    }
  }

  const screenTitle = mode === 'multi'
    ? 'Select exercises'
    : mode === 'single'
      ? (params.replace ? 'Replace exercise' : 'Choose an exercise')
      : 'Exercise library'

  return <View style={{ flex: 1 }}>
    <Screen title={screenTitle} back={true} backLabel={isSelectionMode ? 'Cancel' : 'Back'}>
      {!isSelectionMode&&<Row><Button label="Search food" onPress={()=>router.push('/food-search')}/><Button label="Recipes" onPress={()=>router.push('/recipes')}/></Row>}

      {initialLoading ? <Label muted>Loading exercises...</Label> : <Label muted>{searchDocs.length} exercises · available offline</Label>}

      {!!loadError && (
        <Card>
          <Label>Failed to load exercises: {loadError}</Label>
          <Button label="Retry" selected onPress={() => void action.run(refresh)} />
        </Card>
      )}

      <Field label="Search exercises or aliases" value={query} onChangeText={setQuery} autoCorrect={false}/>

      <Row><Button label={filterOwned?'Using owned equipment':'Filter by owned equipment'} selected={filterOwned} onPress={()=>setFilterOwned(!filterOwned)}/><Button label={custom?'Hide custom exercise':'Create custom exercise'} onPress={()=>setCustom(!custom)}/></Row>{action.feedback}

      {custom&&<Card><Label>Create your exercise</Label><Field label="Exercise name" value={customName} onChangeText={setCustomName}/><Row>{TrackingType.options.map(t=><Button key={t} label={t.replaceAll('_',' + ')} selected={t===tracking} onPress={()=>setTracking(t)}/>)}</Row>
        <Field label="Primary muscle" value={muscle} onChangeText={setMuscle}/><Field label="Aliases (comma separated)" value={aliases} onChangeText={setAliases}/><Field label="Equipment types (comma separated, optional)" value={equipment} onChangeText={setEquipment}/>
        <Button label="Save custom exercise" disabled={action.busy} onPress={()=>{void action.run(async()=>{
          const h=await db()
          const finalName = customName.trim() || 'Custom exercise'
          const id=await createExercise(h,{name:finalName,tracking_type:tracking,primary_muscles:[muscle.trim()],aliases:aliases.split(',').map(s=>s.trim()).filter(Boolean),equipment:equipment.split(',').map(s=>s.trim()).filter(Boolean)})
          if(mode === 'multi'){
            setSelectedIds(prev => new Set([...prev, id]))
            setCustom(false)
            setCustomName('')
            await refresh()
          } else if(mode === 'single'){
            await select(id)
          } else {
            setCustom(false)
            setCustomName('')
            setQuery(finalName)
            await refresh()
          }
        })}}/>
      </Card>}

      {!initialLoading && !results.length && <Label muted>No matching exercise. Adjust the filter or create your own.</Label>}

      {results.map(e=>{
        const numId = Number(e.id)
        const isSelected = selectedIds.has(numId)
        return (
          <Card key={e.id}>
            <Label>{e.label}</Label>
            <Label muted>{e.tracking_type?.replaceAll('_',' + ')} · {e.muscles?.join(', ')} · {e.equipment?.join(', ')||'bodyweight'} · {e.custom?'Custom':'Built-in'}</Label>
            {mode === 'multi' && (
              <Button
                label={isSelected ? '✓ Selected' : '+ Select'}
                selected={isSelected}
                onPress={() => toggleSelect(numId)}
              />
            )}
            {mode === 'single' && (
              <Button
                label={params.replace ? `Replace with ${e.label}` : `Add ${e.label}`}
                disabled={action.busy}
                onPress={() => { void action.run(() => select(numId)) }}
              />
            )}
            {mode === 'browse' && (
              <Button
                label={`View ${e.label}`}
                onPress={() => router.push({ pathname: '/exercise-detail', params: { id: e.id } } as never)}
              />
            )}
          </Card>
        )
      })}
    </Screen>

    {mode === 'multi' && (
      <View style={{ position: 'absolute', bottom: 24, left: 20, right: 20 }}>
        <Button
          label={selectedIds.size > 0 ? `Add ${selectedIds.size} exercise${selectedIds.size > 1 ? 's' : ''}` : 'Select exercises'}
          selected={selectedIds.size > 0}
          disabled={selectedIds.size === 0 || action.busy}
          onPress={confirmMultiSelect}
        />
      </View>
    )}
  </View>
}
