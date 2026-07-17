import type { SleepRecord } from '../types/health'
import { formatDateKeyJa } from '../utils/date'
import { formatDurationMinutes } from '../utils/sleepMetrics'

interface SleepChartProps {
  records: SleepRecord[]
  periodLabel: string
}

const WIDTH = 760
const HEIGHT = 300
const PADDING = { top: 24, right: 28, bottom: 46, left: 62 }

function shortDate(dateKey: string): string {
  const [, month, day] = dateKey.split('-')
  return `${Number(month)}/${Number(day)}`
}

export function SleepChart({ records, periodLabel }: SleepChartProps) {
  if (records.length === 0) return <div className="sleep-chart-empty">この期間の睡眠記録はありません</div>

  const values = records.map((record) => record.sleepMinutes)
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  const span = rawMax - rawMin
  const paddingMinutes = span === 0 ? 30 : Math.max(20, span * 0.15)
  const minY = Math.max(0, rawMin - paddingMinutes)
  const maxY = rawMax + paddingMinutes
  const chartWidth = WIDTH - PADDING.left - PADDING.right
  const chartHeight = HEIGHT - PADDING.top - PADDING.bottom
  const xFor = (index: number) => records.length === 1 ? PADDING.left + chartWidth / 2 : PADDING.left + (index / (records.length - 1)) * chartWidth
  const yFor = (minutes: number) => PADDING.top + ((maxY - minutes) / (maxY - minY)) * chartHeight
  const points = records.map((record, index) => ({ record, x: xFor(index), y: yFor(record.sleepMinutes) }))
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  const labelStep = Math.max(1, Math.ceil(records.length / 6))
  const yTicks = Array.from({ length: 5 }, (_, index) => maxY - ((maxY - minY) * index) / 4)

  return (
    <svg className="sleep-chart-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${periodLabel}の実睡眠時間の推移。記録${records.length}件。`}>
      <title>{periodLabel}の実睡眠時間の推移</title>
      {yTicks.map((tick, index) => {
        const y = yFor(tick)
        return <g key={index}><line className="sleep-chart-grid-line" x1={PADDING.left} x2={WIDTH - PADDING.right} y1={y} y2={y} /><text className="sleep-chart-axis-label" x={PADDING.left - 8} y={y + 4} textAnchor="end">{formatDurationMinutes(Math.round(tick))}</text></g>
      })}
      {records.length > 1 && <path className="sleep-chart-line" d={path} fill="none" />}
      {points.map((point, index) => (
        <g key={point.record.date}>
          <circle className={`sleep-chart-point${index === points.length - 1 ? ' is-latest' : ''}`} cx={point.x} cy={point.y} r={index === points.length - 1 ? 5.5 : 4}><title>{formatDateKeyJa(point.record.date)}、{formatDurationMinutes(point.record.sleepMinutes)}</title></circle>
          {(index % labelStep === 0 || index === points.length - 1) && <text className="sleep-chart-axis-label" x={point.x} y={HEIGHT - 17} textAnchor="middle">{shortDate(point.record.date)}</text>}
        </g>
      ))}
    </svg>
  )
}
