import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { StyleSheet, Text, View, TextInput, FlatList, Pressable, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../src/theme/ThemeProvider'
import { radius, space, type, MIN_TAP_TARGET } from '../src/theme/tokens'
import { openNutritionDb, openUserDb } from '../src/db/expo-adapter'
import type { DbAdapter } from '@nutai/db-adapter'

type DishRow = { id: string, name: string, category: string, status: string, aliases: string }

// P2-6: dish rows showed raw snake-case codes like "street_food_snack".
const prettyCategory = (category: string): string =>
  category.replaceAll('_', ' ').replace(/(^|[\s-])\S/g, (ch) => ch.toUpperCase())

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
        } catch {
          // P3-U13: fresh installs may not have the table yet — the list is
          // still valid. This is an EXPECTED path, so it stays silent (the
          // genuine query-failure path below still reports loudly).
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
        <Text accessibilityRole="header" style={[type.title, { color: t.text }]}>Indian Dishes</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={space.md}>
          <Text style={[type.body, { color: t.textMuted }]}>Done</Text>
        </Pressable>
      </View>
      
      {error && <Text style={{ color: t.safety, padding: space.md }}>{error}</Text>}
      
      <View style={s.filterRow}>
        {['ALL', 'CURATED', 'DRAFT_CURATED', 'HOUSEHOLD'].map(f => (
          <Pressable
            key={f}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === f }}
            // eslint-disable-next-line no-restricted-syntax -- filter chips render from a local id list typed loosely for the map
            onPress={() => setFilter(f as any)}
            style={[s.filterBtn, { backgroundColor: filter === f ? t.protein : t.bgSunken, borderColor: filter === f ? t.protein : t.border }]}
          >
            <Text style={[type.caption, { color: filter === f ? t.bg : t.text }]}>
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
        accessibilityLabel="Search dishes"
      />
      
      <Text style={{ color: t.textMuted, paddingHorizontal: space.md, marginTop: space.xs }}>Showing {dishes.length} {dishes.length === 1 ? 'dish' : 'dishes'}</Text>
      
      {loading ? <ActivityIndicator style={{ marginTop: space.lg }} /> : (
        // P2-23 (QA Wave 4): up to 500 dish rows used to mount at once inside
        // a plain ScrollView — slow open and high memory on web and low-end
        // Android. FlatList keeps only the visible rows alive.
        <FlatList
          style={s.scroll}
          data={dishes}
          keyExtractor={(item) => item.id}
          initialNumToRender={12}
          renderItem={({ item }) => (
            <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.name}`} onPress={() => openDish(item)} style={[s.row, { borderColor: t.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[type.body, { color: t.text }]}>{item.name}</Text>
                {item.aliases ? <Text style={[type.caption, { color: t.textMuted }]}>Also known as: {item.aliases}</Text> : null}
                <Text style={[type.caption, { color: item.status === 'CURATED' ? t.proteinText : item.status === 'HOUSEHOLD' ? t.proteinText : t.safety, marginTop: space.xs }]}>
                  {item.status === 'CURATED' ? 'CURATED RECIPE' : item.status === 'HOUSEHOLD' ? 'MY VERSION' : 'DRAFT / NEEDS REVIEW'} \u00b7 {prettyCategory(item.category)}
                </Text>
              </View>
            </Pressable>
          )}
          ListEmptyComponent={
            query.trim().length >= 2 ? (
              <Text style={[type.body, { color: t.textMuted, textAlign: 'center', marginTop: space.xl }]}>
                No dishes match \u201c{query.trim()}\u201d. Try a shorter prefix like \u201cidli\u201d, or clear the search to browse all {filter === 'ALL' ? '362' : ''} identities.
              </Text>
            ) : filter === 'HOUSEHOLD' ? (
              <Text style={[type.body, { color: t.textMuted, textAlign: 'center', marginTop: space.xl, lineHeight: 22 }]}>
                You have not saved any household versions yet.{'\n'}
                Open any dish and use \u201cLog household variant\u201d to keep your own ingredients and portions.
              </Text>
            ) : filter === 'DRAFT_CURATED' ? (
              <Text style={[type.body, { color: t.textMuted, textAlign: 'center', marginTop: space.xl }]}>
                No draft dishes right now. Drafts appear here while a curated recipe is still under review.
              </Text>
            ) : null
          }
        />
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
