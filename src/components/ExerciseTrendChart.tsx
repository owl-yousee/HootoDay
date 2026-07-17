import type { ExerciseTrendPoint } from '../utils/exerciseSummary'

interface ExerciseTrendChartProps {
  points: ExerciseTrendPoint[]
  periodLabel: string
}

export function ExerciseTrendChart({ points, periodLabel }: ExerciseTrendChartProps) {
  const maximum = Math.max(0, ...points.map((point) => point.totalMinutes))
  if (maximum === 0) return <p className="exercise-summary-empty-chart">この期間にグラフ表示できる運動記録はありません</p>
  const width = 720
  const height = 260
  const left = 48
  const right = 16
  const top = 18
  const bottom = 48
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const slot = plotWidth / Math.max(points.length, 1)
  const barWidth = Math.max(3, Math.min(34, slot * 0.62))
  const labelStep = Math.max(1, Math.ceil(points.length / 8))

  return (
    <div className="exercise-trend-chart" role="img" aria-label={`${periodLabel}の日別または月別運動時間の棒グラフ`}>
      <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true" preserveAspectRatio="none">
        {[0, 0.5, 1].map((ratio) => {
          const y = top + plotHeight * ratio
          const value = Math.round(maximum * (1 - ratio))
          return <g key={ratio}><line className="exercise-chart-grid" x1={left} x2={width - right} y1={y} y2={y} /><text className="exercise-chart-axis-label" x={left - 8} y={y + 4} textAnchor="end">{value}</text></g>
        })}
        {points.map((point, index) => {
          const barHeight = point.totalMinutes === 0 ? 0 : Math.max(2, (point.totalMinutes / maximum) * plotHeight)
          const x = left + slot * index + (slot - barWidth) / 2
          const y = top + plotHeight - barHeight
          return <g key={point.key}>
            <title>{point.accessibleLabel}</title>
            <rect className="exercise-chart-bar" x={x} y={y} width={barWidth} height={barHeight} rx="3" />
            {(index % labelStep === 0 || index === points.length - 1) && <text className="exercise-chart-label" x={x + barWidth / 2} y={height - 20} textAnchor="middle">{point.label}</text>}
          </g>
        })}
        <text className="exercise-chart-unit" x="8" y="14">分</text>
      </svg>
      <ul className="exercise-trend-values" aria-label="運動時間グラフの数値一覧">
        {points.filter((point) => point.totalMinutes > 0).map((point) => <li key={point.key}><span>{point.label}</span><strong>{point.totalMinutes}分</strong></li>)}
      </ul>
    </div>
  )
}
