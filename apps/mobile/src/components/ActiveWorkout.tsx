import { router, usePathname } from 'expo-router'
import { useEffect, useState } from 'react'
import { AppState, View } from 'react-native'
import { activeWorkout, type Workout } from '@nutai/training'
import { db } from '../data/repo'
import { Button } from './Screen'
export function ActiveWorkoutCard(){const path=usePathname();const [workout,setWorkout]=useState<Workout|null>(null);const [now,setNow]=useState(Date.now())
  useEffect(()=>{let alive=true;const refresh=()=>{setNow(Date.now());void db().then(activeWorkout).then(w=>{if(alive)setWorkout(w)}).catch(()=>{})};refresh();const timer=setInterval(refresh,1000);const sub=AppState.addEventListener('change',refresh);return()=>{alive=false;clearInterval(timer);sub.remove()}},[path])
  if(!workout||path==='/workout')return null
  const rest=Math.max(0,Math.ceil(((workout.rest_until??0)-now)/1000))
  return <View style={{position:'absolute',bottom:92,left:20,right:20}}><Button label={`Resume ${workout.name} · ${Math.floor((now-workout.started_at)/60000)} min${rest?` · Rest ${rest}s`:''}`} onPress={()=>router.push({pathname:'/workout',params:{id:workout.id}} as never)}/></View>
}
