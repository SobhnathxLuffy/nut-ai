import { useLocalSearchParams } from 'expo-router'
import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { View } from 'react-native'
import { EquipmentInput } from '@nutai/core-schema'
import {
  listEquipment,
  saveEquipment,
  calculatePlates,
  type Equipment,
  type Plate,
  type Loading,
} from '@nutai/training'
import { db } from '../src/data/repo'
import { Screen, Card, Label, Button, Field, Row, useAction } from '../src/components/Screen'

const KINDS = [
  'plate',
  'barbell',
  'dumbbell',
  'ez_bar',
  'trap_bar',
  'kettlebell',
  'machine',
  'cable',
  'band',
  'bench',
] as const

export default function EquipmentScreen() {
  const params = useLocalSearchParams<{ target?: string }>()
  const [items, setItems] = useState<Equipment[]>([])
  const [targetWeight, setTargetWeight] = useState<string>(params.target ?? '')
  const [selectedBarId, setSelectedBarId] = useState<number | null>(null)
  const [isDumbbellPair, setIsDumbbellPair] = useState<boolean>(false)

  // Add equipment form state
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<(typeof KINDS)[number]>('plate')
  const [weightKg, setWeightKg] = useState('20')
  const [count, setCount] = useState('2')

  const refresh = useCallback(async () => {
    const h = await db()
    const list = await listEquipment(h)
    setItems(list)
    if (selectedBarId === null) {
      const defaultBar = list.find((i) =>
        ['barbell', 'ez_bar', 'trap_bar', 'dumbbell'].includes(i.kind),
      )
      if (defaultBar) setSelectedBarId(defaultBar.id)
    }
  }, [selectedBarId])

  const action = useAction(refresh)
  useFocusEffect(
    useCallback(() => {
      void action.run(refresh)
    }, [refresh]),
  )

  // Bars available
  const bars = items.filter((i) =>
    ['barbell', 'dumbbell', 'ez_bar', 'trap_bar'].includes(i.kind),
  )
  const selectedBar =
    items.find((i) => i.id === selectedBarId) ??
    bars[0] ?? { weight_kg: 20, count: 1, kind: 'barbell', name: 'Standard Barbell' }

  // Plates available
  const plates: Plate[] = items
    .filter((i) => i.kind === 'plate')
    .map((p) => ({ weight_kg: p.weight_kg, count: p.count }))

  // Plate calculation
  const targetNum = Number(targetWeight)
  let calcResult: { lower: Loading | null; upper: Loading | null; exact: Loading | null } | null =
    null
  let calcError = ''

  if (Number.isFinite(targetNum) && targetNum > 0 && selectedBar) {
    try {
      calcResult = calculatePlates(
        targetNum,
        { weight_kg: selectedBar.weight_kg, count: selectedBar.count },
        plates,
        isDumbbellPair ? 2 : 1,
      )
    } catch (e) {
      calcError = e instanceof Error ? e.message : String(e)
    }
  }

  const handleAdd = async () => {
    const w = Number(weightKg)
    const c = Number(count)
    if (!name.trim()) throw new Error('Enter an equipment name')
    if (!Number.isFinite(w) || w < 0) throw new Error('Enter a valid weight in kg')
    if (!Number.isInteger(c) || c < 1) throw new Error('Count must be at least 1')

    const input = {
      name: name.trim(),
      kind,
      weight_kg: w,
      count: c,
    }
    EquipmentInput.parse(input)
    const h = await db()
    await saveEquipment(h, input)
    setName('')
    setShowAdd(false)
  }

  const handleSeedDefaults = async () => {
    const h = await db()
    const defaults = [
      { name: 'Olympic Barbell', kind: 'barbell' as const, weight_kg: 20, count: 1 },
      { name: '20kg Plate', kind: 'plate' as const, weight_kg: 20, count: 4 },
      { name: '15kg Plate', kind: 'plate' as const, weight_kg: 15, count: 2 },
      { name: '10kg Plate', kind: 'plate' as const, weight_kg: 10, count: 4 },
      { name: '5kg Plate', kind: 'plate' as const, weight_kg: 5, count: 4 },
      { name: '2.5kg Plate', kind: 'plate' as const, weight_kg: 2.5, count: 4 },
      { name: '1.25kg Plate', kind: 'plate' as const, weight_kg: 1.25, count: 4 },
      { name: 'Adjustable Dumbbell Handle', kind: 'dumbbell' as const, weight_kg: 2.5, count: 2 },
    ]
    for (const d of defaults) {
      await saveEquipment(h, d)
    }
  }

  const handleDelete = async (id: number) => {
    const h = await db()
    await h.run(
      'UPDATE equipment_inventory SET deleted_at = ?, sync_state = ? WHERE id = ?',
      [Date.now(), 'local', id],
    )
    await refresh()
  }

  return (
    <Screen title="Equipment & Plates" back>
      <Label muted>
        Calculate symmetric plate loadings from your actual inventory. Works 100% offline.
      </Label>
      {action.feedback}

      <Card>
        <Label>Plate Loading Calculator</Label>
        <Field
          label="Target Load (kg)"
          keyboardType="decimal-pad"
          value={targetWeight}
          onChangeText={setTargetWeight}
          placeholder="e.g. 80"
        />

        {bars.length > 0 && (
          <View style={{ gap: 6 }}>
            <Label muted>Choose bar / handle:</Label>
            <Row>
              {bars.map((b) => (
                <Button
                  key={b.id}
                  label={`${b.name} (${b.weight_kg}kg)`}
                  selected={b.id === selectedBarId}
                  onPress={() => {
                    setSelectedBarId(b.id)
                    if (b.kind === 'dumbbell') setIsDumbbellPair(true)
                    else setIsDumbbellPair(false)
                  }}
                />
              ))}
            </Row>
          </View>
        )}

        {selectedBar?.kind === 'dumbbell' && (
          <Row>
            <Button
              label={isDumbbellPair ? 'Pair (2 handles)' : 'Single (1 handle)'}
              selected={isDumbbellPair}
              onPress={() => setIsDumbbellPair(!isDumbbellPair)}
            />
          </Row>
        )}

        {!!calcError && <Label>{calcError}</Label>}

        {calcResult && (
          <View style={{ gap: 10, marginTop: 8 }}>
            {calcResult.exact ? (
              <View style={{ padding: 12, borderRadius: 12, backgroundColor: '#10b98120' }}>
                <Label>Exact Match: {calcResult.exact.load_kg} kg</Label>
                <Label muted>
                  Per side: {formatPlates(calcResult.exact.per_side)}
                </Label>
                <Label muted>Total plates: {calcResult.exact.total_plates}</Label>
              </View>
            ) : (
              <>
                <Label muted>No exact plate combination for {targetNum} kg.</Label>
                {calcResult.lower && (
                  <View style={{ padding: 10, borderRadius: 10, backgroundColor: '#f59e0b20' }}>
                    <Label>Nearest lower: {calcResult.lower.load_kg} kg ({calcResult.lower.delta_kg} kg)</Label>
                    <Label muted>Per side: {formatPlates(calcResult.lower.per_side)}</Label>
                  </View>
                )}
                {calcResult.upper && (
                  <View style={{ padding: 10, borderRadius: 10, backgroundColor: '#3b82f620' }}>
                    <Label>Nearest upper: {calcResult.upper.load_kg} kg (+{calcResult.upper.delta_kg} kg)</Label>
                    <Label muted>Per side: {formatPlates(calcResult.upper.per_side)}</Label>
                  </View>
                )}
              </>
            )}
          </View>
        )}
      </Card>

      <Row>
        <Button
          label={showAdd ? 'Close Add Form' : 'Add Equipment'}
          selected={showAdd}
          onPress={() => setShowAdd(!showAdd)}
        />
        {items.length === 0 && (
          <Button
            label="Seed Standard Gym Equipment"
            onPress={() => void action.run(handleSeedDefaults)}
          />
        )}
      </Row>

      {showAdd && (
        <Card>
          <Label>Add Equipment to Inventory</Label>
          <Field label="Equipment Name" value={name} onChangeText={setName} placeholder="e.g. 20kg Bumper Plate" />
          <Label muted>Category:</Label>
          <Row>
            {KINDS.map((k) => (
              <Button
                key={k}
                label={k.replace('_', ' ')}
                selected={kind === k}
                onPress={() => setKind(k)}
              />
            ))}
          </Row>
          <Row>
            <View style={{ flex: 1 }}>
              <Field
                label="Weight (kg)"
                keyboardType="decimal-pad"
                value={weightKg}
                onChangeText={setWeightKg}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Quantity / Count"
                keyboardType="number-pad"
                value={count}
                onChangeText={setCount}
              />
            </View>
          </Row>
          <Button label="Save to Inventory" selected onPress={() => void action.run(handleAdd)} />
        </Card>
      )}

      <Label>Your Inventory ({items.length} items)</Label>
      {!items.length && (
        <Label muted>No equipment recorded yet. Add items or seed standard equipment.</Label>
      )}
      {items.map((item) => (
        <Card key={item.id}>
          <Row>
            <View style={{ flex: 1 }}>
              <Label>{item.name}</Label>
              <Label muted>
                {item.kind.replace('_', ' ')} · {item.weight_kg} kg each · count: {item.count}
              </Label>
            </View>
            <Button label="Delete" onPress={() => void action.run(() => handleDelete(item.id))} />
          </Row>
        </Card>
      ))}
    </Screen>
  )
}

function formatPlates(plates: Plate[]): string {
  if (!plates.length) return 'None (bare bar)'
  return plates.map((p) => `${p.count}x ${p.weight_kg}kg`).join(', ')
}
