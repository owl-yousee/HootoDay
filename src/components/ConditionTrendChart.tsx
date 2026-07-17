import { getConditionTone } from '../data/conditionOptions'
import type { ConditionTrendPoint } from '../utils/conditionSummary'

interface ConditionTrendChartProps {
  points: ConditionTrendPoint[]
  periodLabel: string
  targetLabel: string
}

export function ConditionTrendChart({ points, periodLabel, targetLabel }: ConditionTrendChartProps) {
  const maximum = Math.max(0, ...points.map((point) => point.total))
  if (maximum === 0) {
    return <p className="condition-summary-empty-chart">この期間に表示できる{targetLabel}の記録はありません</p>
  }

  const width = 720
  const height = 260
  const left = 42
  const right = 16
  const top = 18
  const bottom = 48
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const slot = plotWidth / Math.max(points.length, 1)
  const barWidth = Math.max(3, Math.min(34, slot * 0.62))
  const labelStep = Math.max(1, Math.ceil(points.length / 8))

  return (
    <div className="condition-trend-chart" role="img" aria-label={`${periodLabel}の${targetLabel}の記録件数グラフ`}>
      <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true" preserveAspectRatio="none">
        {[0, 0.5, 1].map((ratio) => {
          const y = top + plotHeight * ratio
          const value = Math.round(maximum * (1 - ratio))
          return <g key={ratio}><line className="condition-chart-grid" x1={left} x2={width - right} y1={y} y2={y} /><text className="condition-chart-axis-label" x={left - 8} y={y + 4} textAnchor="end">{value}</text></g>
        })}
        {points.map((point, index) => {
          const x = left + slot * index + (slot - barWidth) / 2
          let accumulated = 0
          return <g key={point.key}>
            <title>{point.accessibleLabel}</title>
            {point.segments.map((segment) => {
              const segmentHeight = (segment.count / maximum) * plotHeight
              const y = top + plotHeight - accumulated - segmentHeight
              accumulated += segmentHeight
              return <rect key={segment.value} className={`condition-chart-bar is-${getConditionTone(segment.value)}`} x={x} y={y} width={barWidth} height={Math.max(2, segmentHeight)} rx="2" />
            })}
            {(index % labelStep === 0 || index === points.length - 1) && <text className="condition-chart-label" x={x + barWidth / 2} y={height - 20} textAnchor="middle">{point.label}</text>}
          </g>
        })}
        <text className="condition-chart-unit" x="7" y="14">日</text>
      </svg>
      <ul className="condition-trend-values" aria-label={`${targetLabel}の記録内容一覧`}>
        {points.filter((point) => point.total > 0).map((point) => <li key={point.key}><span>{point.label}</span><strong>{point.segments.map((segment) => `${segment.label} ${segment.count}日`).join(' / ')}</strong></li>)}
      </ul>
    </div>
  )
}
