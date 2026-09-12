import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { TrackingType } from '@nutai/core-schema'
import { addExercise, createExercise, listEquipment, listExercises, replaceExercise, type Exercise } from '@nutai/training'
import { rankSearch } from '@nutai/search'
import { db } from '../src/data/repo'
import { Screen, Button, Card, Field, Label, Row, useAction } from '../src/components/Screen'

export default function SearchScreen(){
  const params=useLocalSearchParams<{scope?:string;workoutId?:string;replace?:string}>()
  const [query,setQuery]=useState('');const [exercises,setExercises]=useState<Exercise[]>([]);const [owned,setOwned]=useState<string[]>([]);const [filterOwned,setFilterOwned]=useState(false)
  const [custom,setCustom]=useState(false);const [tracking,setTracking]=useState<TrackingType>('weight_reps');const [muscle,setMuscle]=useState('');const [aliases,setAliases]=useState('');const [equipment,setEquipment]=useState('')
  const refresh=useCallback(async()=>{const h=await db();setExercises(await listExercises(h));setOwned((await listEquipment(h)).map(e=>e.kind))},[]);const action=useAction(refresh)
  useFocusEffect(useCallback(()=>{void action.run(refresh)},[refresh]))
  const results=useMemo(()=>rankSearch(exercises.map(e=>({id:String(e.id),type:'exercise' as const,label:e.name,aliases:e.aliases,source:e.is_custom?'user':'builtin',provenance:e.source,custom:!!e.is_custom,equipment:e.equipment,muscles:e.primary_muscles,tracking_type:e.tracking_type})),{query,locale:'en-IN',scopes:['exercise'],limit:50,allowEmpty:true,filters:filterOwned?{equipment:owned}:{}}).results,[query,exercises,filterOwned,owned])
  async function select(id:number){if(!params.workoutId)return;const h=await db();if(params.replace)await replaceExercise(h,Number(params.replace),id);else await addExercise(h,Number(params.workoutId),id);router.back()}
  return <Screen title={params.workoutId?'Choose an exercise':'Exercise library'} back>
    {!params.workoutId&&<Row><Button label="Search food" onPress={()=>router.push('/food-search')}/><Button label="Recipes" onPress={()=>router.push('/recipes')}/></Row>}
    <Label muted>{exercises.length} exercises · available offline</Label><Field label="Search exercises or aliases" value={query} onChangeText={setQuery} autoCorrect={false}/>
    <Row><Button label={filterOwned?'Using owned equipment':'Filter by owned equipment'} selected={filterOwned} onPress={()=>setFilterOwned(!filterOwned)}/><Button label={custom?'Hide custom exercise':'Create custom exercise'} onPress={()=>setCustom(!custom)}/></Row>{action.feedback}
    {custom&&<Card><Label>Create your exercise</Label><Field label="Exercise name" value={query} onChangeText={setQuery}/><Row>{TrackingType.options.map(t=><Button key={t} label={t.replaceAll('_',' + ')} selected={t===tracking} onPress={()=>setTracking(t)}/>)}</Row>
      <Field label="Primary muscle" value={muscle} onChangeText={setMuscle}/><Field label="Aliases (comma separated)" value={aliases} onChangeText={setAliases}/><Field label="Equipment types (comma separated, optional)" value={equipment} onChangeText={setEquipment}/>
      <Button label="Save custom exercise" disabled={action.busy} onPress={()=>{void action.run(async()=>{const id=await createExercise(await db(),{name:query,tracking_type:tracking,primary_muscles:[muscle.trim()],aliases:aliases.split(',').map(s=>s.trim()).filter(Boolean),equipment:equipment.split(',').map(s=>s.trim()).filter(Boolean)});if(params.workoutId)await select(id);else setCustom(false)})}}/>
    </Card>}
    {!results.length&&<Label muted>No matching exercise. Adjust the filter or create your own.</Label>}
    {results.map(e=><Card key={e.id}><Label>{e.label}</Label><Label muted>{e.tracking_type?.replaceAll('_',' + ')} · {e.muscles?.join(', ')} · {e.equipment?.join(', ')||'bodyweight'} · {e.custom?'Custom':'Built-in'}</Label>
      {!!params.workoutId&&<Button label={`Add ${e.label}`} disabled={action.busy} onPress={()=>{void action.run(()=>select(Number(e.id)))}}/>}
    </Card>)}
  </Screen>
}
