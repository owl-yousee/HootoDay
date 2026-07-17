import type { WeightRecord } from '../types/health'
import { formatDateKeyJa } from '../utils/date'

interface WeightChartProps {
  records: WeightRecord[]
  targetWeightKg: number | null
  periodLabel: string
}

const WIDTH = 760
const HEIGHT = 300
const PADDING = { top: 24, right: 28, bottom: 46, left: 54 }

function shortDate(dateKey: string): string {
  const [, month, day] = dateKey.split('-')
  return `${Number(month)}/${Number(day)}`
}

export function WeightChart({ records, targetWeightKg, periodLabel }: WeightChartProps) {
  if (records.length === 0) {
    return <div className="weight-chart-empty">この期間の体重記録はありません</div>
  }

  const values = records.map((record) => record.weightKg)
  if (targetWeightKg !== null) values.push(targetWeightKg)
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  const span = rawMax - rawMin
  const paddingKg = span === 0 ? 1.5 : Math.max(1, span * 0.15)
  const minY = rawMin - paddingKg
  const maxY = rawMax + paddingKg
  const chartWidth = WIDTH - PADDING.left - PADDING.right
  const chartHeight = HEIGHT - PADDING.top - PADDING.bottom
  const xFor = (index: number) => records.length === 1
    ? PADDING.left + chartWidth / 2
    : PADDING.left + (index / (records.length - 1)) * chartWidth
  const yFor = (weight: number) => PADDING.top + ((maxY - weight) / (maxY - minY)) * chartHeight
  const points = records.map((record, index) => ({
    record,
    x: xFor(index),
    y: yFor(record.weightKg),
  }))
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  const labelStep = Math.max(1, Math.ceil(records.length / 6))
  const yTicks = Array.from({ length: 5 }, (_, index) => maxY - ((maxY - minY) * index) / 4)

  return (
    <svg
      className="weight-chart-svg"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`${periodLabel}の体重推移。記録${records.length}件。`}
    >
      <title>{periodLabel}の体重推移</title>
      {yTicks.map((tick) => {
        const y = yFor(tick)
        return (
          <g key={tick}>
            <line className="weight-chart-grid-line" x1={PADDING.left} x2={WIDTH - PADDING.right} y1={y} y2={y} />
            <text className="weight-chart-axis-label" x={PADDING.left - 8} y={y + 4} textAnchor="end">{tick.toFixed(1)}</text>
          </g>
        )
      })}
      {targetWeightKg !== null && (
        <g>
          <line className="weight-chart-target-line" x1={PADDING.left} x2={WIDTH - PADDING.right} y1={yFor(targetWeightKg)} y2={yFor(targetWeightKg)} />
          <text className="weight-chart-target-label" x={WIDTH - PADDING.right} y={yFor(targetWeightKg) - 6} textAnchor="end">目標 {targetWeightKg.toFixed(1)} kg</text>
        </g>
      )}
      {records.length > 1 && <path className="weight-chart-line" d={path} fill="none" />}
      {points.map((point, index) => (
        <g key={point.record.date}>
          <circle className={`weight-chart-point${index === points.length - 1 ? ' is-latest' : ''}`} cx={point.x} cy={point.y} r={index === points.length - 1 ? 5.5 : 4}>
            <title>{formatDateKeyJa(point.record.date)}、{point.record.weightKg.toFixed(1)} kg</title>
          </circle>
          {(index % labelStep === 0 || index === points.length - 1) && (
            <text className="weight-chart-axis-label" x={point.x} y={HEIGHT - 17} textAnchor="middle">{shortDate(point.record.date)}</text>
          )}
        </g>
      ))}
      <text className="weight-chart-unit" x={12} y={18}>kg</text>
    </svg>
  )
}
