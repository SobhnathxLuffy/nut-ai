import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { activeWorkout, startWorkout, workoutHistory, listRoutines, listPrograms, launchRoutine, scheduledRoutine, type Workout, type Routine, type Program } from '@nutai/training'
import { ProgramInput } from '@nutai/core-schema'
import { db, localDate } from '../../src/data/repo'
import { Screen, Card, Label, Button, Row, useAction } from '../../src/components/Screen'
export default function Train(){const [active,setActive]=useState<Workout|null>(null);const [history,setHistory]=useState<Workout[]>([]);const [routines,setRoutines]=useState<Routine[]>([]);const [programs,setPrograms]=useState<Program[]>([])
 const refresh=useCallback(async()=>{const h=await db();setActive(await activeWorkout(h));setHistory(await workoutHistory(h));setRoutines(await listRoutines(h));setPrograms(await listPrograms(h))},[]);const action=useAction(refresh)
 useFocusEffect(useCallback(()=>{void action.run(refresh)},[refresh]))
 const open=(id:number)=>router.push({pathname:'/workout',params:{id}} as never)
 return <Screen title="Train"><Label muted>Your workout journal works offline. Every set is saved on this device.</Label>{action.feedback}
   <Button selected label={active?`Resume ${active.name}`:'Start quick workout'} onPress={()=>{void action.run(async()=>open(active?.id??await startWorkout(await db(),localDate(Date.now()))))}}/>
   <Row><Button label="Exercise library" onPress={()=>router.push('/search?scope=exercise' as never)}/><Button label="Equipment & plates" onPress={()=>router.push('/equipment' as never)}/><Button label="Create routine" onPress={()=>router.push('/routines' as never)}/></Row>
   <Label>Routines</Label>{!routines.length&&<Label muted>Create a reusable workout or save one from your history.</Label>}{routines.map(r=><Card key={r.id}><Label>{r.name}</Label><Row><Button label="Start routine" disabled={!!active} onPress={()=>{void action.run(async()=>open(await launchRoutine(await db(),r.id,localDate(Date.now()))))}}/><Button label="Edit routine" onPress={()=>router.push({pathname:'/routines',params:{id:r.id}} as never)}/></Row></Card>)}
   <Button label="Programs & schedule" onPress={()=>router.push('/programs' as never)}/>{programs.map(p=>{const plan=ProgramInput.parse(JSON.parse(p.definition_json));const id=scheduledRoutine(plan,localDate(Date.now()));return <Card key={p.id}><Label>{p.name} · {plan.weeks} weeks</Label><Label muted>{id?`Today: ${routines.find(r=>r.id===id)?.name??'Routine'}`:'No routine scheduled today'}</Label>{id&&<Button label="Start scheduled workout" disabled={!!active} onPress={()=>{void action.run(async()=>open(await launchRoutine(await db(),id,localDate(Date.now()))))}}/>}</Card>})}
   <Label>Workout history</Label>{!history.length&&<Label muted>Completed workouts appear here.</Label>}{history.map(w=><Card key={w.id}><Label>{w.local_date} · {w.name}</Label><Button label="View workout" onPress={()=>open(w.id)}/></Card>)}
 </Screen>
}
