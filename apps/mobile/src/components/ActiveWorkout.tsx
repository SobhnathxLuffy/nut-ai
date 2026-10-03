import { router, usePathname } from 'expo-router'
import { useEffect, useState } from 'react'
import { AppState, View } from 'react-native'
import { activeWorkout, onWorkoutsChanged, type Workout } from '@nutai/training'
import { db } from '../data/repo'
import { Button } from './Screen'
export function ActiveWorkoutCard(){const path=usePathname();const [workout,setWorkout]=useState<Workout|null>(null);const [now,setNow]=useState(Date.now())
 useEffect(()=>{
  let alive=true
  let unsubscribe:(()=>void)|null=null
  const readDb=()=>{void db().then(activeWorkout).then(w=>{if(alive)setWorkout(w)}).catch(()=>{})}
  readDb()
  // O8 (Wave 5B, UI/UX report Table 12.1 "1s polling — battery cost for a
  // static pill; event-driven"): the 5s DB poll is GONE. Every write that can
  // change this card (workout started, set completed -> rest_until, rest
  // extended/skipped, workout finished or discarded) goes through
  // @nutai/training's mutate(), which now notifies onWorkoutsChanged
  // subscribers AFTER commit — the card re-reads exactly when the data
  // changed, at zero polling cost. The 1s tick below stays: it is a CLOCK,
  // not a data refresh (the rest countdown and elapsed minutes are computed
  // from rest_until/started_at − Date.now() in render; no DB is involved).
  void db().then(handle=>{if(alive)unsubscribe=onWorkoutsChanged(handle,readDb)}).catch(()=>{})
  // Foreground + path changes still re-read: writes that do NOT go through
  // this repo instance (a backup restore, undo/redo of a workout operation)
  // emit no event — these listeners keep those cases covered, as before.
  const timer=setInterval(()=>setNow(Date.now()),1000)
  const sub=AppState.addEventListener('change',()=>{setNow(Date.now());readDb()})
  return()=>{alive=false;clearInterval(timer);unsubscribe?.();sub.remove()}
 },[path])
 if(!workout||path==='/workout')return null
 const rest=Math.max(0,Math.ceil(((workout.rest_until??0)-now)/1000))
 return <View style={{position:'absolute',bottom:92,left:20,right:20}}><Button label={`Resume ${workout.name} · ${Math.floor((now-workout.started_at)/60000)} min${rest?` · Rest ${rest}s`:''}`} onPress={()=>router.push({pathname:'/workout',params:{id:workout.id}} as never)}/></View>
}
