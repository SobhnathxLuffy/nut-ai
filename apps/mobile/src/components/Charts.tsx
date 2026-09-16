import { chartExtent, normalizeChartPoints } from '@nutai/analytics'
import { useMemo, useState } from 'react'
import { Text, View } from 'react-native'
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg'
import { useTheme } from '../theme/ThemeProvider'
import { radius, space, type } from '../theme/tokens'

export interface ChartDatum {
  x: number | null | undefined
  y: number | null | undefined
  id?: string | number
  label?: string
}

export interface LineSeries {
  key: string
  label: string
  color: string
  points: readonly ChartDatum[]
  dashed?: boolean
}

const HEIGHT = 188
const PAD = { left: 10, right: 10, top: 14, bottom: 18 }

function pathFor(
  points: ReturnType<typeof normalizeChartPoints>,
  extent: NonNullable<ReturnType<typeof chartExtent>>,
  width: number,
): string {
  const innerW = Math.max(1, width - PAD.left - PAD.right)
  const innerH = HEIGHT - PAD.top - PAD.bottom
  return points.map((point, index) => {
    const x = PAD.left + (point.x - extent.minX) / (extent.maxX - extent.minX) * innerW
    const y = PAD.top + (extent.maxY - point.y) / (extent.maxY - extent.minY) * innerH
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
  }).join(' ')
}

export function LineChart({
  series,
  emptyText = 'No data in this period.',
  formatValue = (value) => String(Math.round(value)),
}: {
  series: readonly LineSeries[]
  emptyText?: string
  formatValue?: (value: number) => string
}) {
  const theme = useTheme()
  const [width, setWidth] = useState(0)
  const [selected, setSelected] = useState<{ series: string; value: number; label?: string } | null>(null)
  const normalized = useMemo(() => series.map((item) => ({
    ...item,
    points: normalizeChartPoints(item.points, 300),
    labels: new Map(item.points.filter((point) => point.id != null).map((point) => [point.id, point.label])),
  })), [series])
  const all = normalized.flatMap((item) => item.points)
  const extent = chartExtent(all)

  if (!extent) return <Text style={[type.caption, { color: theme.textMuted }]}>{emptyText}</Text>
  const innerW = Math.max(1, width - PAD.left - PAD.right)
  const innerH = HEIGHT - PAD.top - PAD.bottom
  const pointPosition = (x: number, y: number) => ({
    x: PAD.left + (x - extent.minX) / (extent.maxX - extent.minX) * innerW,
    y: PAD.top + (extent.maxY - y) / (extent.maxY - extent.minY) * innerH,
  })

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={`${series.map((item) => item.label).join(' and ')} chart with ${all.length} points`}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{ minHeight: HEIGHT + 42 }}
    >
      {width > 0 ? (
        <Svg width={width} height={HEIGHT}>
          {[0, 0.5, 1].map((fraction) => (
            <Line
              key={fraction}
              x1={PAD.left}
              x2={width - PAD.right}
              y1={PAD.top + innerH * fraction}
              y2={PAD.top + innerH * fraction}
              stroke={theme.border}
              strokeWidth={1}
            />
          ))}
          {normalized.map((item) => item.points.length > 1 ? (
            <Path
              key={item.key}
              d={pathFor(item.points, extent, width)}
              fill="none"
              stroke={item.color}
              strokeWidth={2.5}
              strokeDasharray={item.dashed ? '5 5' : undefined}
            />
          ) : null)}
          {normalized.flatMap((item) => item.points.map((point) => {
            const position = pointPosition(point.x, point.y)
            return (
              <Circle
                key={`${item.key}:${point.x}:${String(point.id ?? '')}`}
                cx={position.x}
                cy={position.y}
                r={item.points.length === 1 ? 5 : 3}
                fill={item.color}
                onPress={() => setSelected({
                  series: item.label,
                  value: point.y,
                  label: point.id == null ? undefined : item.labels.get(point.id),
                })}
              />
            )
          }))}
        </Svg>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
        {normalized.map((item) => (
          <View key={item.key} style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <View style={{ width: 12, height: 3, borderRadius: 2, backgroundColor: item.color }} />
            <Text style={[type.caption, { color: theme.textMuted }]}>{item.label}</Text>
          </View>
        ))}
      </View>
      {selected ? (
        <View style={{ marginTop: space.sm, padding: space.sm, borderRadius: radius.sm, backgroundColor: theme.bgSunken }}>
          <Text style={[type.caption, { color: theme.text }]}>
            {selected.label ? `${selected.label} · ` : ''}{selected.series}: {formatValue(selected.value)}
          </Text>
        </View>
      ) : null}
    </View>
  )
}

export function BarChart({
  points,
  color,
  emptyText = 'No data in this period.',
  formatValue = (value) => String(Math.round(value)),
}: {
  points: readonly ChartDatum[]
  color: string
  emptyText?: string
  formatValue?: (value: number) => string
}) {
  const theme = useTheme()
  const [width, setWidth] = useState(0)
  const [selected, setSelected] = useState<ChartDatum | null>(null)
  const safe = useMemo(() => normalizeChartPoints(points, 120), [points])
  const labels = useMemo(() => new Map(points.filter((point) => point.id != null).map((point) => [point.id, point.label])), [points])
  if (safe.length === 0) return <Text style={[type.caption, { color: theme.textMuted }]}>{emptyText}</Text>
  const max = Math.max(1, ...safe.map((point) => point.y))
  const innerW = Math.max(1, width - PAD.left - PAD.right)
  const barSpace = innerW / safe.length
  const barWidth = Math.max(2, Math.min(24, barSpace * 0.72))

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={`Bar chart with ${safe.length} points`}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{ minHeight: HEIGHT + 22 }}
    >
      {width > 0 ? (
        <Svg width={width} height={HEIGHT}>
          {safe.map((point, index) => {
            const height = point.y / max * (HEIGHT - PAD.top - PAD.bottom)
            return (
              <Rect
                key={`${point.x}:${String(point.id ?? index)}`}
                x={PAD.left + index * barSpace + (barSpace - barWidth) / 2}
                y={HEIGHT - PAD.bottom - height}
                width={barWidth}
                height={Math.max(point.y === 0 ? 1 : 2, height)}
                rx={2}
                fill={color}
                onPress={() => setSelected({ ...point, label: point.id == null ? undefined : labels.get(point.id) })}
              />
            )
          })}
        </Svg>
      ) : null}
      {selected?.y != null && Number.isFinite(selected.y) ? (
        <Text style={[type.caption, { color: theme.textMuted }]}>
          {selected.label ? `${selected.label} · ` : ''}{formatValue(selected.y)}
        </Text>
      ) : null}
    </View>
  )
}
