import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, View } from 'react-native'
import { SetKind, SetValues, TRACKING_FIELDS } from '@nutai/core-schema'
import { workoutDetail, saveSet, finishWorkout, reopenWorkout, discardWorkout, updateWorkout, editWorkoutExercise, groupExercises, removeSet, saveRoutine, type WorkoutExercise, type WorkoutSet } from '@nutai/training'
import { db, setting, putSetting, undoLastOperation, redoLastOperation } from '../src/data/repo'
import { Screen, Button, Card, Field, Label, Row, useAction } from '../src/components/Screen'
const FIELD_LABELS:Record<string,string>={load_kg:'Load (kg)',reps:'Reps',duration_s:'Duration (seconds)',distance_m:'Distance (metres)',assistance_kg:'Assistance (kg)',rir:'RIR',rpe:'RPE',tempo:'Tempo'}
export default function WorkoutScreen(){const {id}=useLocalSearchParams<{id:string}>();const [detail,setDetail]=useState<Awaited<ReturnType<typeof workoutDetail>>|null>(null);const [advanced,setAdvanced]=useState(false);const [group,setGroup]=useState<number[]>([]);const [clock,setClock]=useState(Date.now())
 const refresh=useCallback(async()=>{setDetail(await workoutDetail(await db(),Number(id)));setAdvanced(await setting('training.advanced','false')==='true')},[id]);const action=useAction(refresh)
 useFocusEffect(useCallback(()=>{void action.run(refresh)},[refresh]));useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer)},[])
 const run=(fn:()=>Promise<unknown>)=>{void action.run(fn)}
 if(!detail)return <Screen title="Workout" back>{action.feedback}{action.error?null:<Label>Loading saved workout…</Label>}</Screen>
 const {workout:w,exercises}=detail;const active=w.status==='active';const rest=Math.max(0,Math.ceil(((w.rest_until??0)-clock)/1000))
 return <Screen title={w.name} back><Label muted>{w.local_date} · {active?`${Math.floor((clock-w.started_at)/60000)} minutes · saved locally`:'Completed workout'}</Label>{action.feedback}
  {active&&<><Card><Label>{rest?`Rest · ${rest}s remaining`:'Ready for your next set'}</Label><Row><Button label="Rest 90 seconds" onPress={()=>run(async()=>updateWorkout(await db(),w.id,{rest_until:Date.now()+90000}))}/><Button label="Skip rest" onPress={()=>run(async()=>updateWorkout(await db(),w.id,{rest_until:null}))}/></Row></Card>
  <SavedText label="Workout notes" initial={w.notes} save={async text=>updateWorkout(await db(),w.id,{notes:text})}/><SavedText label="Location (optional)" initial={w.location} save={async text=>updateWorkout(await db(),w.id,{location:text})}/>
  <Row><Button label="Add exercise" onPress={()=>router.push({pathname:'/search',params:{scope:'exercise',workoutId:w.id}} as never)}/><Button label={advanced?'Simple mode':'Advanced mode'} onPress={()=>run(async()=>{await putSetting('training.advanced',String(!advanced));setAdvanced(!advanced)})}/></Row></>}
  {!exercises.length&&<Label muted>Add an exercise to begin. Search or create your own.</Label>}
  {exercises.map((e,index)=><Card key={e.id}><Row><Label>{e.superset_group_id?`${String.fromCharCode(65+exercises.filter(x=>x.superset_group_id===e.superset_group_id).findIndex(x=>x.id===e.id))} · `:''}{e.name}</Label>{active&&<Button label={group.includes(e.id)?'Selected for circuit':'Select for circuit'} selected={group.includes(e.id)} onPress={()=>setGroup(group.includes(e.id)?group.filter(i=>i!==e.id):[...group,e.id])}/>}</Row>
    {e.superset_group_id&&<Label muted>Circuit · alternate exercises each round. Rest starts after the final exercise.</Label>}
    <Label muted>Previous: {e.previous?describeSet(e.previous):'No completed session yet'}</Label>
    {active&&<SavedText label={`${e.name} notes`} initial={e.notes} save={async notes=>editWorkoutExercise(await db(),e.id,{notes})}/>}
    {e.sets.map(s=><SetEditor key={s.id} exercise={e} set={s} active={active} advanced={advanced} refresh={refresh}/>)}
    {active&&<><Row><Button label={`Add set to ${e.name}`} disabled={action.busy} onPress={()=>run(async()=>{const prior=e.sets.at(-1)??e.previous;await saveSet(await db(),e.id,prior?SetValues.parse(prior):{}, {completed:false})})}/><Button label="Replace exercise" onPress={()=>router.push({pathname:'/search',params:{scope:'exercise',workoutId:w.id,replace:e.id}} as never)}/></Row>
    <Row><Button label="Move up" disabled={index===0} onPress={()=>run(async()=>{const h=await db();const previous=exercises[index-1]!;await editWorkoutExercise(h,e.id,{sort_order:previous.sort_order});await editWorkoutExercise(h,previous.id,{sort_order:e.sort_order})})}/><Button label="Remove exercise" onPress={()=>run(async()=>editWorkoutExercise(await db(),e.id,{deleted_at:Date.now()}))}/>{e.superset_group_id&&<Button label="Ungroup" onPress={()=>run(async()=>editWorkoutExercise(await db(),e.id,{superset_group_id:null}))}/>}</Row></>}
  </Card>)}
  {group.length>=2&&<Button label="Group selected exercises into circuit" onPress={()=>run(async()=>{await groupExercises(await db(),w.id,group);setGroup([])})}/>}
  <Row><Button label="Undo workout action" onPress={()=>run(async()=>{const r=await undoLastOperation();if(!r.success)throw new Error(r.error??'Nothing to undo')})}/><Button label="Redo workout action" onPress={()=>run(async()=>{const r=await redoLastOperation();if(!r.success)throw new Error(r.error??'Nothing to redo')})}/></Row>
  {active?<><Button label="Finish workout" selected disabled={action.busy} onPress={()=>run(async()=>finishWorkout(await db(),w.id))}/><Button label="Discard workout" onPress={()=>Alert.alert('Discard workout?','The saved workout can be restored with Undo.',[{text:'Cancel',style:'cancel'},{text:'Discard',onPress:()=>run(async()=>{await discardWorkout(await db(),w.id);router.back()})}])}/></>:<Button label="Reopen workout to edit" onPress={()=>run(async()=>reopenWorkout(await db(),w.id))}/>}
  <Button label="Save as routine" onPress={()=>run(async()=>{await saveRoutine(await db(),{name:`${w.name} routine`,exercises:exercises.filter(e=>e.sets.some(s=>s.completed_at)).map(e=>({exercise_id:e.exercise_id,group:e.superset_group_id,sets:e.sets.filter(s=>s.completed_at).map(s=>SetValues.parse(s)),rule:{kind:'manual'}}))});Alert.alert('Routine saved','Open Train to launch or edit it.')})}/>
 </Screen>
}
function describeSet(s:WorkoutSet){return Object.entries(SetValues.parse(s)).filter(([,v])=>v!==null).map(([k,v])=>`${v} ${FIELD_LABELS[k]??k}`).join(' · ')}
function SavedText({label,initial,save}:{label:string;initial:string;save:(v:string)=>Promise<void>}){const [value,setValue]=useState(initial);const [error,setError]=useState('');const queue=useRef(Promise.resolve())
 useEffect(()=>{setValue(initial)},[initial])
 return <><Field label={label} value={value} onChangeText={v=>{setValue(v);queue.current=queue.current.then(()=>save(v)).catch(e=>setError(String(e)))}}/>{!!error&&<Label>{error}</Label>}</>
}
function SetEditor({exercise:e,set:s,active,advanced,refresh}:{exercise:WorkoutExercise;set:WorkoutSet;active:boolean;advanced:boolean;refresh:()=>Promise<void>}){
 const [values,setValues]=useState<Record<string,string>>(Object.fromEntries(Object.entries(SetValues.parse(s)).map(([k,v])=>[k,v===null?'':String(v)])));const [kind,setKind]=useState(s.kind);const [error,setError]=useState('');const queue=useRef(Promise.resolve());const draft=useRef(SetValues.parse(s));const [saving,setSaving]=useState(false)
 useEffect(()=>{setValues(Object.fromEntries(Object.entries(SetValues.parse(s)).map(([k,v])=>[k,v===null?'':String(v)])));draft.current=SetValues.parse(s);setKind(s.kind)},[s.id,s.completed_at,JSON.stringify(SetValues.parse(s))])
 const persist=(next:SetValues,completed=false,nextKind=kind,refreshAfter=false)=>{setSaving(true);queue.current=queue.current.then(async()=>{await saveSet(await db(),e.id,next,{id:s.id,completed,kind:nextKind});if(refreshAfter)await refresh();setError('')}).catch(err=>setError(String(err))).finally(()=>setSaving(false))}
 if(!active)return <Label>Set {s.sort_order+1} · {s.kind} · {describeSet(s)}{s.completed_at?' · done':' · not completed'}</Label>
 const fields=[...TRACKING_FIELDS[e.tracking_type],...(advanced?['rir','rpe','tempo'] as const:[])]
 return <View style={{gap:8,borderLeftWidth:e.superset_group_id?3:0,paddingLeft:e.superset_group_id?12:0}}><Label>Set {s.sort_order+1} · {s.completed_at?'Complete':'Draft'}{saving?' · Saving…':''}</Label>
  {s.planned_json&&<Label muted>Planned: {describeSet({...s,...JSON.parse(s.planned_json)})}</Label>}
  <Row>{fields.map(key=><View key={key} style={{minWidth:105,flex:1}}><Field label={`${FIELD_LABELS[key]} set ${s.sort_order+1}`} keyboardType={key==='tempo'?'default':'decimal-pad'} value={values[key]??''} onChangeText={text=>{setValues(v=>({...v,[key]:text}));const parsed=Number(text);if(key!=='tempo'&&text!==''&&Number.isNaN(parsed))return;const next={...draft.current,[key]:text===''?null:key==='tempo'?text:parsed};if(key==='tempo'&&text&&!/^(\d+|X)-(\d+|X)-(\d+|X)-(\d+|X)$/.test(text))return;draft.current=next;persist(next,!!s.completed_at)}}/></View>)}</Row>
  {advanced&&<Row>{SetKind.options.map(k=><Button key={k} label={k} selected={kind===k} disabled={saving} onPress={()=>{setKind(k);persist(draft.current,!!s.completed_at,k)}}/>)}</Row>}
  <Row><Button label={s.completed_at?'Mark set incomplete':'Complete set'} selected={!!s.completed_at} disabled={saving} onPress={()=>persist(draft.current,!s.completed_at,kind,true)}/><Button label="Duplicate set" disabled={saving} onPress={()=>{setSaving(true);queue.current=queue.current.then(async()=>{await saveSet(await db(),e.id,draft.current,{completed:false,kind});await refresh()}).catch(err=>setError(String(err))).finally(()=>setSaving(false))}}/><Button label="Delete set" disabled={saving} onPress={()=>{setSaving(true);queue.current=queue.current.then(async()=>{await removeSet(await db(),s.id);await refresh()}).catch(err=>setError(String(err))).finally(()=>setSaving(false))}}/>{fields.includes('load_kg')&&<Button label="Plate helper" onPress={()=>router.push({pathname:'/equipment',params:{target:values['load_kg']}} as never)}/>}</Row>{!!error&&<Label>{error}</Label>}
 </View>
}
