import { useState } from 'react'
import type { HealthProfile, WeightRecord } from '../types/health'
import { formatDateKeyJa } from '../utils/date'
import {
  calculateAverageWeight,
  calculateBeautyWeight,
  calculateBmi,
  calculateStandardWeight,
  calculateWeightDifference,
  filterWeightRecordsByRange,
  getBmiLabel,
  getLatestWeightRecord,
  getPreviousWeightRecord,
  getWeightRange,
  type WeightPeriod,
} from '../utils/weightMetrics'
import { getLocalTodayKey } from '../utils/healthProfile'
import { WeightChart } from './WeightChart'

interface WeightDashboardProps {
  records: WeightRecord[]
  profile: HealthProfile | null
  onOpenProfile: () => void
}

const periodOptions: { id: WeightPeriod; label: string }[] = [
  { id: '7d', label: '7日' },
  { id: '30d', label: '30日' },
  { id: '6m', label: '6か月' },
  { id: '1y', label: '1年' },
  { id: 'all', label: '全期間' },
]

function differenceText(value: number | null, prefix: string): string {
  if (value === null) return '比較できません'
  if (value === 0) return `${prefix} ±0.0 kg`
  return `${prefix} ${value > 0 ? '+' : ''}${value.toFixed(1)} kg`
}

function targetDifferenceText(value: number | null): string {
  if (value === null) return '最新体重と比較できません'
  if (value === 0) return '目標体重と同じです'
  return value > 0 ? `目標より ${value.toFixed(1)} kg重い` : `目標より ${Math.abs(value).toFixed(1)} kg軽い`
}

export function WeightDashboard({ records, profile, onOpenProfile }: WeightDashboardProps) {
  const [period, setPeriod] = useState<WeightPeriod>('30d')
  const latest = getLatestWeightRecord(records)
  const previous = getPreviousWeightRecord(records)
  const baseDate = latest?.date ?? getLocalTodayKey()
  const latestWeight = latest?.weightKg ?? null
  const heightCm = profile?.heightCm ?? null
  const targetWeight = profile?.targetWeightKg ?? null
  const bmi = calculateBmi(latestWeight, heightCm)
  const standardWeight = calculateStandardWeight(heightCm)
  const beautyWeight = calculateBeautyWeight(heightCm)
  const selectedRange = getWeightRange(period, baseDate)
  const chartRecords = filterWeightRecordsByRange(records, selectedRange)
  const selectedAverage = calculateAverageWeight(records, selectedRange)
  const chartMin = chartRecords.length ? Math.min(...chartRecords.map((record) => record.weightKg)) : null
  const chartMax = chartRecords.length ? Math.max(...chartRecords.map((record) => record.weightKg)) : null
  const periodChange = chartRecords.length >= 2
    ? calculateWeightDifference(chartRecords.at(-1)?.weightKg ?? null, chartRecords[0].weightKg)
    : null
  const selectedPeriodLabel = periodOptions.find((option) => option.id === period)?.label ?? '30日'

  return (
    <div className="weight-dashboard">
      <div className="weight-summary-heading">
        <div>
          <p className="health-card-kicker">Weight overview</p>
          <h3>体重まとめ</h3>
        </div>
        <div className="weight-summary-controls">
          <p>集計基準：{formatDateKeyJa(baseDate)}</p>
          <div className="weight-period-controls" aria-label="体重まとめの集計期間">
            {periodOptions.map((option) => (
              <button key={option.id} type="button" className={period === option.id ? 'is-active' : ''} aria-pressed={period === option.id} onClick={() => setPeriod(option.id)}>{option.label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="weight-metric-grid">
        <section className="weight-metric-card is-primary">
          <p>最新体重</p>
          {latest ? (
            <>
              <strong>{latest.weightKg.toFixed(1)} <small>kg</small></strong>
              <span>{formatDateKeyJa(latest.date)}</span>
              <span>{previous ? differenceText(calculateWeightDifference(latest.weightKg, previous.weightKg), '前回より') : '前回記録はありません'}</span>
            </>
          ) : <span>体重記録がありません</span>}
        </section>

        <section className="weight-metric-card">
          <p>BMI</p>
          <strong>{bmi === null ? '計算できません' : bmi.toFixed(1)}</strong>
          <span>{getBmiLabel(bmi) ?? '身長と最新体重が必要です'}</span>
        </section>

        <section className="weight-metric-card">
          <p>標準体重</p>
          <strong>{standardWeight === null ? '計算できません' : `${standardWeight.toFixed(1)} kg`}</strong>
          <span>{differenceText(calculateWeightDifference(latestWeight, standardWeight), '最新との差')}</span>
        </section>

        <section className="weight-metric-card">
          <p>美容体重（参考）</p>
          <strong>{beautyWeight === null ? '計算できません' : `${beautyWeight.toFixed(1)} kg`}</strong>
          <span>{differenceText(calculateWeightDifference(latestWeight, beautyWeight), '最新との差')}</span>
        </section>

        <section className="weight-metric-card weight-target-card">
          <p>目標体重</p>
          <strong>{targetWeight === null ? '未設定' : `${targetWeight.toFixed(1)} kg`}</strong>
          <span>{targetWeight === null ? '健康プロフィールで設定できます' : targetDifferenceText(calculateWeightDifference(latestWeight, targetWeight))}</span>
          <button type="button" className="weight-inline-button" onClick={onOpenProfile}>健康プロフィールを編集</button>
        </section>
      </div>

      <section className="weight-chart-section" aria-labelledby="weight-chart-heading">
        <div className="weight-section-heading">
          <div><p className="health-card-kicker">Chart</p><h3 id="weight-chart-heading">体重グラフ</h3></div>
          <p>対象：{selectedPeriodLabel}</p>
        </div>
        <WeightChart records={chartRecords} targetWeightKg={targetWeight} periodLabel={selectedPeriodLabel} />
      </section>

      <section className="weight-average-section" aria-labelledby="weight-average-heading">
        <div className="weight-section-heading">
          <div><p className="health-card-kicker">Period summary</p><h3 id="weight-average-heading">期間集計</h3></div>
          <p>{selectedPeriodLabel}・記録のない日は平均へ含めません</p>
        </div>
        <div className="weight-average-grid">
          <article className="weight-average-card">
            <h4>期間平均</h4>
            {selectedAverage.averageKg === null ? <strong>記録なし</strong> : <strong>{selectedAverage.averageKg.toFixed(1)} <small>kg</small></strong>}
          </article>
          <article className="weight-average-card">
            <h4>最小</h4>
            <strong>{chartMin === null ? '－' : `${chartMin.toFixed(1)} kg`}</strong>
          </article>
          <article className="weight-average-card">
            <h4>最大</h4>
            <strong>{chartMax === null ? '－' : `${chartMax.toFixed(1)} kg`}</strong>
          </article>
          <article className="weight-average-card">
            <h4>期間内増減</h4>
            <strong>{periodChange === null ? '比較できません' : `${periodChange > 0 ? '+' : ''}${periodChange.toFixed(1)} kg`}</strong>
          </article>
          <article className="weight-average-card">
            <h4>記録件数</h4>
            <strong>{selectedAverage.count} <small>件</small></strong>
          </article>
        </div>
      </section>

      <p className="weight-medical-note">表示値は記録とプロフィールから算出した目安で、医療診断ではありません。</p>
    </div>
  )
}
