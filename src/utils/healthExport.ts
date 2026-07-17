import { bodyPartConditionLabels, conditionLevelLabels } from '../data/conditionOptions'
import { getExerciseDisplayName } from '../data/exerciseTypes'
import type {
  DailyHealthExportRecord,
  HealthExportData,
  HealthExportDateRange,
  HealthExportFormat,
  HealthExportPeriod,
  MonthlyBestExportRecord,
} from '../types/export'
import { addLocalDays, formatDateKeyJa, formatMonthKeyJa, fromDateKey, toDateKey } from './date'
import { formatExerciseDuration } from './exerciseMetrics'
import { calculateSleepSummary, formatDurationMinutes } from './sleepMetrics'

export const MAX_EXPORT_RANGE_DAYS = 366

export interface ExportDateRangeResult {
  range: HealthExportDateRange | null
  error: string | null
}

export interface HealthExportContentInput {
  range: HealthExportDateRange
  records: DailyHealthExportRecord[]
  monthlyBests: MonthlyBestExportRecord[]
  generatedDate: string
}

function countInclusiveDays(startDate: string, endDate: string): number {
  const start = fromDateKey(startDate)
  const end = fromDateKey(endDate)
  if (!start || !end) return 0
  return Math.round((Date.UTC(end.getFullYear(), end.getMonth(), end.getDate())
    - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 86_400_000) + 1
}

export function getExportDateRange(
  period: HealthExportPeriod,
  baseDate: string,
  customStartDate: string,
  customEndDate: string,
): ExportDateRangeResult {
  const base = fromDateKey(baseDate)
  if (!base) return { range: null, error: '基準日を正しく入力してください。' }

  let startDate = baseDate
  let endDate = baseDate
  if (period === 'week') startDate = addLocalDays(baseDate, -6) ?? ''
  if (period === 'halfMonth') startDate = addLocalDays(baseDate, -14) ?? ''
  if (period === 'month') {
    startDate = toDateKey(new Date(base.getFullYear(), base.getMonth(), 1))
    endDate = toDateKey(new Date(base.getFullYear(), base.getMonth() + 1, 0))
  }
  if (period === 'custom') {
    if (!fromDateKey(customStartDate)) return { range: null, error: '開始日を正しく入力してください。' }
    if (!fromDateKey(customEndDate)) return { range: null, error: '終了日を正しく入力してください。' }
    startDate = customStartDate
    endDate = customEndDate
  }

  if (startDate > endDate) return { range: null, error: '開始日は終了日以前にしてください。' }
  if (countInclusiveDays(startDate, endDate) > MAX_EXPORT_RANGE_DAYS) {
    return { range: null, error: '出力期間は両端を含めて366日以内にしてください。' }
  }
  return { range: { startDate, endDate }, error: null }
}

function inRange(date: string, range: HealthExportDateRange): boolean {
  return date >= range.startDate && date <= range.endDate
}

function makeMap<T extends { date: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.date, item]))
}

export function collectDailyExportRecords(
  data: HealthExportData,
  range: HealthExportDateRange,
): DailyHealthExportRecord[] {
  const memoMap = makeMap(data.dayMemos)
  const achievementMap = makeMap(data.dailyAchievements)
  const weightMap = makeMap(data.weightRecords)
  const sleepMap = makeMap(data.sleepRecords)
  const mealMap = makeMap(data.mealRecords)
  const conditionMap = makeMap(data.conditionRecords)
  const exercisesByDate = new Map<string, typeof data.exerciseSessions>()
  for (const session of data.exerciseSessions) {
    const current = exercisesByDate.get(session.date) ?? []
    exercisesByDate.set(session.date, [...current, session])
  }

  const dates = new Set<string>()
  for (const items of [
    data.dayMemos,
    data.dailyAchievements,
    data.weightRecords,
    data.sleepRecords,
    data.mealRecords,
    data.exerciseSessions,
    data.conditionRecords,
  ]) {
    for (const item of items) if (inRange(item.date, range)) dates.add(item.date)
  }

  return [...dates].sort().map((date) => ({
    date,
    dayMemo: memoMap.get(date) ?? null,
    achievement: achievementMap.get(date) ?? null,
    weight: weightMap.get(date) ?? null,
    sleep: sleepMap.get(date) ?? null,
    meal: mealMap.get(date) ?? null,
    exercises: [...(exercisesByDate.get(date) ?? [])]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    condition: conditionMap.get(date) ?? null,
  }))
}

function monthsInRange(range: HealthExportDateRange): string[] {
  const start = fromDateKey(range.startDate)
  const end = fromDateKey(range.endDate)
  if (!start || !end) return []
  const months: string[] = []
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
  const last = new Date(end.getFullYear(), end.getMonth(), 1)
  while (cursor <= last) {
    months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`)
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return months
}

export function getMonthlyBestAchievementsForRange(
  data: HealthExportData,
  range: HealthExportDateRange,
): MonthlyBestExportRecord[] {
  const allowedMonths = new Set(monthsInRange(range))
  const achievementMap = makeMap(data.dailyAchievements)
  return data.monthlyAchievementSelections
    .filter((selection) => allowedMonths.has(selection.month))
    .map((selection) => {
      const achievement = achievementMap.get(selection.selectedDate)
      if (!achievement || !achievement.date.startsWith(`${selection.month}-`)) return null
      return { month: selection.month, selectedDate: selection.selectedDate, text: achievement.text }
    })
    .filter((item): item is MonthlyBestExportRecord => item !== null)
    .sort((left, right) => left.month.localeCompare(right.month))
}

function weekdayShort(dateKey: string): string {
  const date = fromDateKey(dateKey)
  return date ? ['日', '月', '火', '水', '木', '金', '土'][date.getDay()] : ''
}

function formatDateHeading(dateKey: string): string {
  return `${formatDateKeyJa(dateKey)}（${weekdayShort(dateKey)}）`
}

function formatClock(value: string): string {
  return value.replace(/^0(?=\d:)/, '')
}

function formatSleep(record: DailyHealthExportRecord['sleep']) {
  if (!record) return null
  const calculated = calculateSleepSummary(record.bedtime, record.wakeTime, record.awakenings).summary
  const sleepMinutes = calculated?.sleepMinutes ?? record.sleepMinutes
  const awakeMinutes = calculated?.awakeMinutes ?? record.awakeMinutes
  return { sleepMinutes, awakeMinutes, count: record.awakenings.length }
}

function txtSection(title: string, lines: string[]): string {
  return `【${title}】\n${lines.join('\n')}`
}

function buildTxtDay(record: DailyHealthExportRecord): string {
  const sections: string[] = []
  if (record.achievement) sections.push(txtSection('今日のできたこと', [record.achievement.text]))
  if (record.dayMemo) sections.push(txtSection('日記・メモ', [record.dayMemo.content]))
  if (record.weight) {
    const lines = [`${record.weight.weightKg.toFixed(1)} kg`]
    if (record.weight.memo) lines.push(`メモ：${record.weight.memo}`)
    sections.push(txtSection('体重', lines))
  }
  if (record.sleep) {
    const summary = formatSleep(record.sleep)
    const lines = [`就寝：${formatClock(record.sleep.bedtime)}`, `起床：${formatClock(record.sleep.wakeTime)}`]
    if (summary) {
      lines.push(`実睡眠：${formatDurationMinutes(summary.sleepMinutes)}`)
      if (summary.count > 0 || summary.awakeMinutes > 0) lines.push(`途中覚醒：${summary.count}回・${formatDurationMinutes(summary.awakeMinutes)}`)
    }
    if (record.sleep.memo) lines.push(`メモ：${record.sleep.memo}`)
    sections.push(txtSection('睡眠', lines))
  }
  if (record.meal) {
    const lines: string[] = []
    if (record.meal.breakfast) lines.push(`朝食：${record.meal.breakfast}`)
    if (record.meal.lunch) lines.push(`昼食：${record.meal.lunch}`)
    if (record.meal.dinner) lines.push(`夕食：${record.meal.dinner}`)
    if (record.meal.snacks) lines.push(`間食：${record.meal.snacks}`)
    if (lines.length > 0) sections.push(txtSection('食事', lines))
  }
  if (record.exercises.length > 0) {
    const blocks = record.exercises.map((session, index) => {
      const lines = [`${index + 1}. ${getExerciseDisplayName(session.exerciseType, session.customName)}`, `   時間：${formatExerciseDuration(session.durationMinutes)}`]
      if (session.averageHeartRate !== null) lines.push(`   心拍数：${session.averageHeartRate} bpm`)
      lines.push(`   METs：${session.mets}`)
      if (session.estimatedCaloriesKcal !== null) lines.push(`   推定消費：${session.estimatedCaloriesKcal} kcal`)
      if (session.memo) lines.push(`   メモ：${session.memo}`)
      return lines.join('\n')
    })
    sections.push(txtSection('運動', blocks))
  }
  if (record.condition) {
    const lines: string[] = []
    if (record.condition.overallCondition !== 'unset') lines.push(`全体：${conditionLevelLabels[record.condition.overallCondition]}`)
    if (record.condition.kneeCondition !== 'unset') lines.push(`膝：${bodyPartConditionLabels[record.condition.kneeCondition]}`)
    if (record.condition.lowerBackCondition !== 'unset') lines.push(`腰：${bodyPartConditionLabels[record.condition.lowerBackCondition]}`)
    if (record.condition.menstrualNote) lines.push(`生理・周期メモ：${record.condition.menstrualNote}`)
    if (record.condition.concerns) lines.push(`気になること：${record.condition.concerns}`)
    if (record.condition.memo) lines.push(`メモ：${record.condition.memo}`)
    if (lines.length > 0) sections.push(txtSection('体調', lines))
  }
  return `==============================\n${formatDateHeading(record.date)}\n==============================\n\n${sections.join('\n\n')}`
}

export function generateHealthExportText(input: HealthExportContentInput): string {
  if (input.records.length === 0 && input.monthlyBests.length === 0) return ''
  const header = `HootoDay 記録\n期間：${formatDateKeyJa(input.range.startDate)} ～ ${formatDateKeyJa(input.range.endDate)}`
  const days = input.records.map(buildTxtDay)
  const bests = input.monthlyBests.map((best) => (
    `【${formatMonthKeyJa(best.month)}のいちばん頑張ったこと】\n${formatDateKeyJa(best.selectedDate)}\n${best.text}`
  ))
  return [header, ...days, ...bests].join('\n\n------------------------------\n\n')
}

function markdownSection(title: string, content: string): string {
  return `### ${title}\n\n${content}`
}

function markdownField(label: string, value: string): string {
  return `- ${label}: ${value}`
}

function buildMarkdownDay(record: DailyHealthExportRecord): string {
  const sections: string[] = []
  if (record.achievement) sections.push(markdownSection('今日のできたこと', record.achievement.text))
  if (record.dayMemo) sections.push(markdownSection('日記・メモ', record.dayMemo.content))
  if (record.weight) {
    const lines = [markdownField('体重', `${record.weight.weightKg.toFixed(1)} kg`)]
    if (record.weight.memo) lines.push(markdownField('メモ', record.weight.memo))
    sections.push(markdownSection('体重', lines.join('\n')))
  }
  if (record.sleep) {
    const summary = formatSleep(record.sleep)
    const lines = [markdownField('就寝', formatClock(record.sleep.bedtime)), markdownField('起床', formatClock(record.sleep.wakeTime))]
    if (summary) {
      lines.push(markdownField('実睡眠', formatDurationMinutes(summary.sleepMinutes)))
      if (summary.count > 0 || summary.awakeMinutes > 0) lines.push(markdownField('途中覚醒', `${summary.count}回・${formatDurationMinutes(summary.awakeMinutes)}`))
    }
    if (record.sleep.memo) lines.push(markdownField('メモ', record.sleep.memo))
    sections.push(markdownSection('睡眠', lines.join('\n')))
  }
  if (record.meal) {
    const lines: string[] = []
    if (record.meal.breakfast) lines.push(markdownField('朝食', record.meal.breakfast))
    if (record.meal.lunch) lines.push(markdownField('昼食', record.meal.lunch))
    if (record.meal.dinner) lines.push(markdownField('夕食', record.meal.dinner))
    if (record.meal.snacks) lines.push(markdownField('間食', record.meal.snacks))
    if (lines.length > 0) sections.push(markdownSection('食事', lines.join('\n')))
  }
  if (record.exercises.length > 0) {
    const blocks = record.exercises.map((session, index) => {
      const lines = [markdownField('時間', formatExerciseDuration(session.durationMinutes))]
      if (session.averageHeartRate !== null) lines.push(markdownField('心拍数', `${session.averageHeartRate} bpm`))
      lines.push(markdownField('METs', String(session.mets)))
      if (session.estimatedCaloriesKcal !== null) lines.push(markdownField('推定消費', `${session.estimatedCaloriesKcal} kcal`))
      if (session.memo) lines.push(markdownField('メモ', session.memo))
      return `#### ${index + 1}. ${getExerciseDisplayName(session.exerciseType, session.customName)}\n\n${lines.join('\n')}`
    })
    sections.push(markdownSection('運動', blocks.join('\n\n')))
  }
  if (record.condition) {
    const lines: string[] = []
    if (record.condition.overallCondition !== 'unset') lines.push(markdownField('全体', conditionLevelLabels[record.condition.overallCondition]))
    if (record.condition.kneeCondition !== 'unset') lines.push(markdownField('膝', bodyPartConditionLabels[record.condition.kneeCondition]))
    if (record.condition.lowerBackCondition !== 'unset') lines.push(markdownField('腰', bodyPartConditionLabels[record.condition.lowerBackCondition]))
    if (record.condition.menstrualNote) lines.push(markdownField('生理・周期メモ', record.condition.menstrualNote))
    if (record.condition.concerns) lines.push(markdownField('気になること', record.condition.concerns))
    if (record.condition.memo) lines.push(markdownField('メモ', record.condition.memo))
    if (lines.length > 0) sections.push(markdownSection('体調', lines.join('\n')))
  }
  return `## ${formatDateHeading(record.date)}\n\n${sections.join('\n\n')}`
}

export function generateHealthExportMarkdown(input: HealthExportContentInput): string {
  if (input.records.length === 0 && input.monthlyBests.length === 0) return ''
  const header = `# HootoDay 記録\n\n- 期間: ${formatDateKeyJa(input.range.startDate)} ～ ${formatDateKeyJa(input.range.endDate)}\n- 出力日: ${formatDateKeyJa(input.generatedDate)}`
  const days = input.records.map(buildMarkdownDay)
  const bests = input.monthlyBests.map((best) => (
    `## ${formatMonthKeyJa(best.month)}のいちばん頑張ったこと\n\n- 選択日: ${best.selectedDate}\n- 内容: ${best.text}`
  ))
  return [header, ...days, ...bests].join('\n\n---\n\n')
}

export function buildExportFilename(range: HealthExportDateRange, format: HealthExportFormat): string {
  const dates = range.startDate === range.endDate ? range.startDate : `${range.startDate}_${range.endDate}`
  return `HootoDay_${dates}.${format === 'markdown' ? 'md' : 'txt'}`
}
