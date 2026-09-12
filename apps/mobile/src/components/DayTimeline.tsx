import { useCallback, useState } from 'react'
import { Alert } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { timeline, type TimelineEvent } from '@nutai/timeline'
import { getDayStatus, listOperations, type DayCompletion, type OperationRecord } from '@nutai/db-adapter'
import { db, localDate, dayTotals, currentGoal, deleteMeal, undoLastOperation, redoLastOperation, type DayTotals, type CurrentGoal } from '../data/repo'
import { changeDayStatus } from '../data/checkin'
import { copyYesterday, dateOffset, mealSnapshot, repeatSnapshots, saveShortcut } from '../data/shortcuts'
import { Button, Card, Field, Label, Row, useAction } from './Screen'
export function DayTimeline({food=false}:{food?:boolean}) {
  const [date,setDate]=useState(localDate(Date.now()));const [events,setEvents]=useState<TimelineEvent[]>([]);const [status,setStatus]=useState<DayCompletion>('unknown');const [totals,setTotals]=useState<DayTotals|null>(null);const [goal,setGoal]=useState<CurrentGoal|null>(null);const [loaded,setLoaded]=useState(false);const [history,setHistory]=useState<OperationRecord[]>([])
  const refresh=useCallback(async()=>{const h=await db();const [e,s,t,g,o]=await Promise.all([timeline(h,date),getDayStatus(h,date),dayTotals(date),currentGoal(),listOperations(h,{entityType:'day_status',entityId:Number(date.replaceAll('-','')),limit:4})]);setEvents(e);setStatus(s?.completion??'unknown');setTotals(t);setGoal(g);setHistory(o);setLoaded(true)},[date])
  const action=useAction(refresh)
  useFocusEffect(useCallback(()=>{void refresh().catch(e=>Alert.alert('Could not load day',String(e)))},[refresh]))
  const perform=(fn:()=>Promise<unknown>)=>{void action.run(fn)}
  const repeat=(id:number)=>perform(async()=>{const h=await db();await repeatSnapshots(h,[await mealSnapshot(h,id)],date)})
  return <>
    <Row><Button label="Previous day" onPress={()=>setDate(dateOffset(date,-1))}/><Button label="Today" onPress={()=>setDate(localDate(Date.now()))}/><Button label="Next day" onPress={()=>setDate(dateOffset(date,1))}/></Row>
    <Field label="Selected day (YYYY-MM-DD)" value={date} onChangeText={v=>{if(/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v)))setDate(v)}}/>
    <Card><Label>{!loaded?'Loading your day…':totals?.mealCount?`${Math.round(totals.kcal)} kcal logged${goal?` · Target ${goal.targetKcal} kcal`:''}`:'No food entries logged'}</Label>
      {!!totals?.mealCount&&<Label muted>Protein {Math.round(totals.protein_g)} g · Carbs {Math.round(totals.carbs_g)} g · Fat {Math.round(totals.fat_g)} g</Label>}
      {!!totals?.pendingCount&&<Label muted>{totals.pendingCount} entries still need analysis.</Label>}
      <Label muted>Day: {status}. Complete and fasting days count in averages. Partial and unknown days are excluded.</Label>
      <Row>{(['complete','partial','unknown','fasting'] as const).map(s=><Button key={s} selected={s===status} label={`Mark ${s}`} disabled={action.busy} onPress={()=>perform(async()=>changeDayStatus(await db(),{localDate:date,completion:s,provenance:'timeline',now:Date.now()}))}/>)}</Row>
      {history.length>0&&<Label muted>Recent status changes: {history.map(o=>`${JSON.parse(o.new_json??'{}').completion}${o.undone_at?' (undone)':''}`).join(' → ')}</Label>}
    </Card>
    <Row><Button label="Log food" onPress={()=>router.push({pathname:'/food-search',params:{date}} as never)}/><Button label="Add weight" onPress={()=>router.push('/log-weight')}/><Button label="Start workout" onPress={()=>router.push('/(tabs)/train' as never)}/></Row>
    {food&&<Button label="Copy yesterday into this day" disabled={action.busy} onPress={()=>Alert.alert('Copy yesterday?',`Meals will be added to ${date}. Existing entries stay in place. You can undo the entire copy.`,[{text:'Cancel',style:'cancel'},{text:'Add meals',onPress:()=>perform(async()=>copyYesterday(await db(),date))}])}/>}
    {action.feedback}<Row><Button label="Undo last action" onPress={()=>perform(async()=>{const r=await undoLastOperation();if(!r.success)throw new Error(r.error??'Nothing to undo')})}/><Button label="Redo" onPress={()=>perform(async()=>{const r=await redoLastOperation();if(!r.success)throw new Error(r.error??'Nothing to redo')})}/></Row>
    <Label>Daily timeline · available offline</Label>
    {loaded&&events.length===0&&<Card><Label>No entries for this day yet.</Label><Label muted>Use the logging actions above whenever you’re ready.</Label></Card>}
    {events.map(e=><Card key={e.id}><Label>{new Date(e.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · {e.label}</Label><Label muted>{e.detail}</Label>
      {e.type==='meal'&&<Row><Button label="Repeat meal" disabled={action.busy} onPress={()=>repeat(e.entity_id)}/><Button label="Favorite" onPress={()=>perform(async()=>saveShortcut(await db(),e.entity_id,'favorite',e.detail))}/><Button label="Save usual meal" onPress={()=>perform(async()=>saveShortcut(await db(),e.entity_id,'usual',e.detail))}/><Button label="Save meal" onPress={()=>perform(async()=>saveShortcut(await db(),e.entity_id,'saved',e.detail))}/><Button label="Delete meal" onPress={()=>Alert.alert('Delete this meal?','You can restore it with Undo.',[{text:'Cancel',style:'cancel'},{text:'Delete',onPress:()=>perform(()=>deleteMeal(e.entity_id))}])}/></Row>}
      {(e.type==='workout'||e.type==='pr')&&<Button label="Open workout" onPress={()=>router.push({pathname:'/workout',params:{id:e.entity_id}} as never)}/>}</Card>)}
  </>
}
