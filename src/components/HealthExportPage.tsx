import { useMemo, useState } from 'react'
import type { HealthExportData, HealthExportFormat, HealthExportPeriod } from '../types/export'
import { formatDateKeyJa, toDateKey } from '../utils/date'
import {
  buildExportFilename,
  collectDailyExportRecords,
  generateHealthExportMarkdown,
  generateHealthExportText,
  getExportDateRange,
  getMonthlyBestAchievementsForRange,
  MAX_EXPORT_RANGE_DAYS,
} from '../utils/healthExport'

interface HealthExportPageProps {
  initialDate: string
  data: HealthExportData
}

const formatOptions: Array<{ value: HealthExportFormat; label: string }> = [
  { value: 'txt', label: 'TXT' },
  { value: 'markdown', label: 'Markdown' },
]

const periodOptions: Array<{ value: HealthExportPeriod; label: string }> = [
  { value: 'day', label: '1日' },
  { value: 'week', label: '1週間' },
  { value: 'halfMonth', label: '半月' },
  { value: 'month', label: '1か月' },
  { value: 'custom', label: '期間指定' },
]

export function HealthExportPage({ initialDate, data }: HealthExportPageProps) {
  const [format, setFormat] = useState<HealthExportFormat>('markdown')
  const [period, setPeriod] = useState<HealthExportPeriod>('day')
  const [baseDate, setBaseDate] = useState(initialDate)
  const [customStartDate, setCustomStartDate] = useState(initialDate)
  const [customEndDate, setCustomEndDate] = useState(initialDate)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')

  const rangeResult = useMemo(
    () => getExportDateRange(period, baseDate, customStartDate, customEndDate),
    [period, baseDate, customStartDate, customEndDate],
  )
  const records = useMemo(
    () => rangeResult.range ? collectDailyExportRecords(data, rangeResult.range) : [],
    [data, rangeResult.range],
  )
  const monthlyBests = useMemo(
    () => rangeResult.range ? getMonthlyBestAchievementsForRange(data, rangeResult.range) : [],
    [data, rangeResult.range],
  )
  const content = useMemo(() => {
    if (!rangeResult.range) return ''
    const input = {
      range: rangeResult.range,
      records,
      monthlyBests,
      generatedDate: toDateKey(new Date()),
    }
    return format === 'markdown'
      ? generateHealthExportMarkdown(input)
      : generateHealthExportText(input)
  }, [format, monthlyBests, rangeResult.range, records])
  const canExport = Boolean(content && rangeResult.range)
  const error = rangeResult.error ?? actionError
  const preview = content || (rangeResult.error ? '' : '指定期間には出力できる記録がありません')

  const clearMessages = () => {
    setActionError('')
    setNotice('')
  }

  const copyContent = async () => {
    if (!content) return
    clearMessages()
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API is unavailable')
      await navigator.clipboard.writeText(content)
      setNotice('コピーしました')
    } catch {
      setActionError('コピーできませんでした')
    }
  }

  const saveFile = () => {
    if (!content || !rangeResult.range) return
    clearMessages()
    try {
      const type = format === 'markdown' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8'
      const url = URL.createObjectURL(new Blob([content], { type }))
      const link = document.createElement('a')
      link.href = url
      link.download = buildExportFilename(rangeResult.range, format)
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      setNotice('ファイルを保存しました')
    } catch {
      setActionError('ファイルを作成できませんでした')
    }
  }

  return (
    <div className="health-export-page">
      <header className="content-heading export-heading">
        <div>
          <p className="eyebrow">Export</p>
          <h1>出力・バックアップ</h1>
        </div>
        <p className="content-note">記録をTXTまたはMarkdownでまとめて保存できます。</p>
      </header>

      <div className="export-layout">
        <section className="export-settings-card" aria-labelledby="export-settings-title">
          <div className="export-section-heading">
            <div>
              <p className="health-card-kicker">Output settings</p>
              <h2 id="export-settings-title">出力設定</h2>
            </div>
          </div>

          <fieldset className="export-choice-group">
            <legend>出力形式</legend>
            <div className="export-segmented-controls">
              {formatOptions.map((option) => (
                <button key={option.value} type="button" className={format === option.value ? 'is-active' : ''} aria-pressed={format === option.value} onClick={() => { setFormat(option.value); clearMessages() }}>{option.label}</button>
              ))}
            </div>
          </fieldset>

          <fieldset className="export-choice-group">
            <legend>期間</legend>
            <div className="export-period-controls">
              {periodOptions.map((option) => (
                <button key={option.value} type="button" className={period === option.value ? 'is-active' : ''} aria-pressed={period === option.value} onClick={() => { setPeriod(option.value); clearMessages() }}>{option.label}</button>
              ))}
            </div>
          </fieldset>

          <div className="export-date-fields">
            <label className="export-date-field" htmlFor="export-base-date">
              <span>基準日</span>
              <input id="export-base-date" type="date" value={baseDate} aria-invalid={Boolean(rangeResult.error && period !== 'custom')} aria-describedby="export-error export-base-hint" onChange={(event) => { setBaseDate(event.target.value); clearMessages() }} />
              <small id="export-base-hint">1か月では、この日が属するカレンダー月を出力します。</small>
            </label>

            {period === 'custom' && (
              <div className="export-custom-dates">
                <label className="export-date-field" htmlFor="export-start-date">
                  <span>開始日</span>
                  <input id="export-start-date" type="date" value={customStartDate} aria-invalid={Boolean(rangeResult.error)} aria-describedby="export-error export-range-hint" onChange={(event) => { setCustomStartDate(event.target.value); clearMessages() }} />
                </label>
                <label className="export-date-field" htmlFor="export-end-date">
                  <span>終了日</span>
                  <input id="export-end-date" type="date" value={customEndDate} aria-invalid={Boolean(rangeResult.error)} aria-describedby="export-error export-range-hint" onChange={(event) => { setCustomEndDate(event.target.value); clearMessages() }} />
                </label>
              </div>
            )}
            {period === 'custom' && <small id="export-range-hint">期間指定は両端を含めて最大{MAX_EXPORT_RANGE_DAYS}日です。</small>}
          </div>

          {rangeResult.range && (
            <p className="export-range-summary"><span>対象期間</span><strong>{formatDateKeyJa(rangeResult.range.startDate)} ～ {formatDateKeyJa(rangeResult.range.endDate)}</strong></p>
          )}
          {error && <p id="export-error" className="form-error" role="alert">{error}</p>}

          <div className="export-actions">
            <button type="button" className="health-secondary-button" disabled={!canExport} onClick={copyContent}>コピー</button>
            <button type="button" className="health-primary-button" disabled={!canExport} onClick={saveFile}>ファイルに保存</button>
          </div>
          <p className="export-notice" aria-live="polite">{notice}</p>
          <p className="export-privacy-note">出力内容はこの端末内で作成され、外部へ自動送信されません。</p>
        </section>

        <section className="export-preview-card" aria-labelledby="export-preview-title">
          <div className="export-section-heading">
            <div>
              <p className="health-card-kicker">Preview</p>
              <h2 id="export-preview-title">出力プレビュー</h2>
            </div>
            {rangeResult.range && <span className="export-filename">{buildExportFilename(rangeResult.range, format)}</span>}
          </div>
          <pre className={`export-preview${content ? '' : ' is-empty'}`} aria-label="読み取り専用の出力プレビュー" aria-readonly="true"><code>{preview}</code></pre>
        </section>
      </div>

      <aside className="export-future-note">
        <strong>今後のバックアップ機能</strong>
        <p>JSONバックアップ・復元は後日追加予定です。</p>
      </aside>
    </div>
  )
}
