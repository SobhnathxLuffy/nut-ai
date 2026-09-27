import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { StyleSheet, Text, View, TextInput, ScrollView, Pressable, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../src/theme/ThemeProvider'
import { radius, space, type, MIN_TAP_TARGET } from '../src/theme/tokens'
import { openNutritionDb, openUserDb } from '../src/db/expo-adapter'
import type { DbAdapter } from '@nutai/db-adapter'

type DishRow = { id: string, name: string, category: string, status: string, aliases: string }

export default function IndianDishesScreen() {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ date?: string }>()
  
  const [db, setDb] = useState<DbAdapter | null>(null)
  const [userDb, setUserDb] = useState<DbAdapter | null>(null)
  const [query, setQuery] = useState('')
  const [dishes, setDishes] = useState<DishRow[]>([])
  const [filter, setFilter] = useState<'ALL' | 'CURATED' | 'DRAFT_CURATED' | 'HOUSEHOLD'>('ALL')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    // WEB-003: household variants the user saved live in the writable user DB
    // and must appear alongside the curated corpus entries.
    Promise.all([openNutritionDb(), openUserDb()]).then(([h, u]) => {
      if (alive) { setDb(h); setUserDb(u); setLoading(false) }
    }).catch(e => {
      if (alive) { setError(e.message); setLoading(false) }
    })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!db || !userDb) return
    let alive = true
    const search = async () => {
      let sql = `
        SELECT d.id, d.canonical_name as name, d.category, d.record_status as status,
               COALESCE((SELECT GROUP_CONCAT(alias, ', ') FROM dish_aliases WHERE dish_id = d.id), '') as aliases
        FROM dish_definitions d
      `
      const args: any[] = []
      
      const conditions: string[] = []
      if (filter !== 'ALL') {
        conditions.push('d.record_status = ?')
        args.push(filter)
      }
      
      if (query.trim().length >= 2) {
        conditions.push('(d.canonical_name LIKE ? OR d.id IN (SELECT dish_id FROM dish_aliases WHERE alias LIKE ?))')
        args.push(`%${query.trim()}%`, `%${query.trim()}%`)
      }
      
      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ')
      }
      // P1-8: the corpus holds 362 dish identities and the old LIMIT 100 made
      // 262 of them unreachable in this browser. 500 keeps a defensive ceiling
      // (corpus + household variants) without hiding anything.
      sql += ' ORDER BY d.canonical_name LIMIT 500'
      
      try {
        const rows = await db.all<any>(sql, args)
        // WEB-003: merge in the user's own household variants. The user DB has
        // no dish_aliases table, so its copy of the query is alias-free.
        let userRows: any[] = []
        try {
          const userConditions: string[] = []
          const userArgs: any[] = []
          if (filter !== 'ALL') {
            userConditions.push('d.record_status = ?')
            userArgs.push(filter)
          }
          if (query.trim().length >= 2) {
            userConditions.push('d.canonical_name LIKE ?')
            userArgs.push(`%${query.trim()}%`)
          }
          const where = userConditions.length > 0 ? ' WHERE ' + userConditions.join(' AND ') : ''
          userRows = await userDb.all<any>(
            `SELECT d.id, d.canonical_name as name, d.category, d.record_status as status, '' as aliases FROM dish_definitions d${where} ORDER BY d.canonical_name LIMIT 500`,
            userArgs
          )
        } catch (userErr) {
          // Fresh installs may not have the table yet — the list is still valid.
          console.warn('User dish query skipped:', userErr)
        }
        const seen = new Set<string>()
        const merged: DishRow[] = []
        for (const row of [...rows, ...userRows]) {
          if (seen.has(row.id)) continue
          seen.add(row.id)
          merged.push(row)
        }
        merged.sort((a, b) => String(a.name).localeCompare(String(b.name)))
        if (alive) {
          setError(null)
          setDishes(merged.slice(0, 500))
        }
      } catch (e) {
        console.error('IndianDishes query error:', e)
        if (alive) setError(String(e))
      }
    }
    const timer = setTimeout(search, 200)
    return () => { alive = false; clearTimeout(timer) }
  }, [db, userDb, query, filter])

  const openDish = (dish: DishRow) => {
    router.push({ pathname: '/dish-composer', params: { dishId: dish.id, date: params.date } } as never)
  }

  return (
    <View style={[s.container, { backgroundColor: t.bg, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={s.headerRow}>
        <Text style={[type.title, { color: t.text }]}>Indian Dishes</Text>
        <Pressable onPress={() => router.back()} hitSlop={space.md}>
          <Text style={[type.body, { color: t.textMuted }]}>Done</Text>
        </Pressable>
      </View>
      
      {error && <Text style={{ color: t.safety, padding: space.md }}>{error}</Text>}
      
      <View style={s.filterRow}>
        {['ALL', 'CURATED', 'DRAFT_CURATED', 'HOUSEHOLD'].map(f => (
          <Pressable 
            key={f} 
            onPress={() => setFilter(f as any)}
            style={[s.filterBtn, { backgroundColor: filter === f ? t.protein : t.bgSunken, borderColor: filter === f ? t.protein : t.border }]}
          >
            <Text style={[type.micro, { color: filter === f ? '#fff' : t.text }]}>
              {f === 'DRAFT_CURATED' ? 'Draft' : f === 'CURATED' ? 'Curated' : f === 'HOUSEHOLD' ? 'My Version' : 'All'}
            </Text>
          </Pressable>
        ))}
      </View>
      
      <TextInput
        style={[s.input, { color: t.text, borderColor: t.border, backgroundColor: t.bgSunken }]}
        value={query}
        onChangeText={setQuery}
        placeholder="Search 362 identities (e.g. litti, idli)"
        placeholderTextColor={t.textFaint}
      />
      
      <Text style={{ color: t.textMuted, paddingHorizontal: space.md, marginTop: space.xs }}>Showing {dishes.length} dishes</Text>
      
      {loading ? <ActivityIndicator style={{ marginTop: space.lg }} /> : (
        <ScrollView style={s.scroll}>
          {dishes.map(d => (
            <Pressable key={d.id} onPress={() => openDish(d)} style={[s.row, { borderColor: t.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[type.body, { color: t.text }]}>{d.name}</Text>
                {d.aliases ? <Text style={[type.caption, { color: t.textMuted }]}>Also known as: {d.aliases}</Text> : null}
                <Text style={[type.micro, { color: d.status === 'CURATED' ? t.protein : d.status === 'HOUSEHOLD' ? "#3b82f6" : t.safety, marginTop: space.xs }]}>
                  {d.status === 'CURATED' ? '✓ CURATED RECIPE' : d.status === 'HOUSEHOLD' ? '🏠 MY VERSION' : 'DRAFT / NEEDS REVIEW'} · {d.category}
                </Text>
              </View>
            </Pressable>
          ))}
          {dishes.length === 0 && query.length >= 2 && (
            <Text style={[type.body, { color: t.textMuted, textAlign: 'center', marginTop: space.xl }]}>No dishes found.</Text>
          )}
        </ScrollView>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space.md },
  filterRow: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.md, marginBottom: space.sm },
  filterBtn: { paddingHorizontal: space.md, paddingVertical: space.xs, borderRadius: radius.pill, borderWidth: 1 },
  input: { marginHorizontal: space.md, paddingHorizontal: space.md, paddingVertical: space.md, borderRadius: radius.md, borderWidth: 1, minHeight: 48 },
  scroll: { flex: 1, paddingHorizontal: space.md, marginTop: space.md },
  row: { paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: MIN_TAP_TARGET, justifyContent: 'center' }
})
