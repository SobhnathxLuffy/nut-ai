import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Screen, Button, Card, Label, Row, useAction } from '../../src/components/Screen'
import { DayTimeline } from '../../src/components/DayTimeline'
import { db, localDate } from '../../src/data/repo'
import { listShortcuts, recentFoods, repeatSnapshots, mealSnapshot, removeShortcut, type Shortcut, type RecentFood, type MealSnapshot } from '../../src/data/shortcuts'
export default function Food(){const [shortcuts,setShortcuts]=useState<Shortcut[]>([]);const [recent,setRecent]=useState<RecentFood[]>([]);const [mode,setMode]=useState('Recent')
  const refresh=useCallback(async()=>{const h=await db();setShortcuts(await listShortcuts(h));setRecent(await recentFoods(h,Date.now()))},[]);const action=useAction(refresh)
  useFocusEffect(useCallback(()=>{void action.run(refresh)},[refresh]))
  return <Screen title="Food"><Row><Button label="Search everything" onPress={()=>router.push('/search' as never)}/><Button label="Scan food" onPress={()=>router.push('/camera')}/><Button label="Recipes" onPress={()=>router.push('/recipes')}/><Button label="Custom food" onPress={()=>router.push('/custom-food' as never)}/></Row>
    <Row>{['Recent','Frequent','Favorites','Usual','Saved'].map(v=><Button key={v} label={v} selected={mode===v} onPress={()=>setMode(v)}/>)}</Row>{action.feedback}
    {['Recent','Frequent'].includes(mode)?(mode==='Frequent'?[...recent].sort((a,b)=>b.frequency-a.frequency):recent).slice(0,8).map(r=><Card key={r.id+':'+r.name}><Label>{r.name} · {r.frequency} logs</Label><Button label="Repeat today" onPress={()=>{void action.run(async()=>{const h=await db();await repeatSnapshots(h,[await mealSnapshot(h,r.id)],localDate(Date.now()))})}}/></Card>):shortcuts.filter(s=>s.kind===(mode==='Favorites'?'favorite':mode==='Usual'?'usual':'saved')).map(s=><Card key={s.id}><Label>{s.name}</Label><Row><Button label="Log today" onPress={()=>{void action.run(async()=>repeatSnapshots(await db(),[JSON.parse(s.snapshot_json) as MealSnapshot],localDate(Date.now())))}}/><Button label="Remove shortcut" onPress={()=>{void action.run(async()=>removeShortcut(await db(),s.id))}}/></Row></Card>)}
    <DayTimeline food/>
  </Screen>
}
