import { router, usePathname } from 'expo-router'
import { useEffect, useState } from 'react'
import { AppState, View } from 'react-native'
import { activeWorkout, type Workout } from '@nutai/training'
import { db } from '../data/repo'
import { Button } from './Screen'
export function ActiveWorkoutCard(){const path=usePathname();const [workout,setWorkout]=useState<Workout|null>(null);const [now,setNow]=useState(Date.now())
 useEffect(()=>{
  let alive=true
  const readDb=()=>{void db().then(activeWorkout).then(w=>{if(alive)setWorkout(w)}).catch(()=>{})}
  readDb()
  // P2-22 (QA Wave 4): this used to run the FULL-DATABASE activeWorkout query
  // every second for the whole app session — the heaviest runtime pattern in
  // the app. The 1s tick now only advances the display clock (a pure state
  // update); the DB is re-read ONLY while a rest timer is actually running
  // (rest_until decides the card's own countdown) or on app foreground.
  const timer=setInterval(()=>setNow(Date.now()),1000)
  let dbTimer: ReturnType<typeof setInterval>|null=null
  const armDbPolling=()=>{
    const resting=!!workout&&(workout.rest_until??0)>Date.now()
    if(resting&&!dbTimer){dbTimer=setInterval(readDb,1000)}
    else if(!resting&&dbTimer){clearInterval(dbTimer);dbTimer=null}
  }
  armDbPolling()
  // Re-evaluate the poll arm after each clock tick (rest expiry must stop it)
  // without re-running the effect.
  const guard=setInterval(armDbPolling,1000)
  const sub=AppState.addEventListener('change',()=>{setNow(Date.now());readDb()})
  return()=>{alive=false;clearInterval(timer);clearInterval(guard);if(dbTimer)clearInterval(dbTimer);sub.remove()}
 },[path,workout?.rest_until])
 if(!workout||path==='/workout')return null
 const rest=Math.max(0,Math.ceil(((workout.rest_until??0)-now)/1000))
 return <View style={{position:'absolute',bottom:92,left:20,right:20}}><Button label={`Resume ${workout.name} · ${Math.floor((now-workout.started_at)/60000)} min${rest?` · Rest ${rest}s`:''}`} onPress={()=>router.push({pathname:'/workout',params:{id:workout.id}} as never)}/></View>
}
