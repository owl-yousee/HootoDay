export interface SyncShareTextInput {
  stageId: string
  state: string
  target: string | null
  classification: string | null
  differenceCount: number | null
  baselineStatus: string
  cursor: number | null
  ready: boolean | null
  primaryAction: string | null
  disabledReason?: string | null
  stopReason?: string | null
  differenceItems?: Array<{ date: string; typeLabel: string; nextAction: string }>
}

function display(value: string | null | undefined, fallback = 'なし') {
  return value?.trim() || fallback
}

export function buildSyncShareText(input: SyncShareTextInput): string {
  const lines = [
    'HootoDay同期',
    `stage: ${input.stageId}`,
    `状態: ${input.state}`,
    `対象: ${display(input.target)}`,
    `分類: ${display(input.classification)}`,
    `差異: ${input.differenceCount === null ? '未確認' : `${input.differenceCount}件`}`,
    `baseline: ${input.baselineStatus}`,
    `cursor: ${input.cursor ?? '未確認'}`,
    `ready: ${input.ready === null ? '未確認' : input.ready ? 'はい' : 'いいえ'}`,
    `主操作: ${display(input.primaryAction)}`,
  ]
  if (input.differenceItems?.length) {
    const counts = new Map<string, number>()
    input.differenceItems.forEach((item) => counts.set(item.typeLabel, (counts.get(item.typeLabel) ?? 0) + 1))
    lines.push('内訳:', ...[...counts].map(([label, count]) => `- ${label} ${count}件`))
    lines.push('対象別:', ...input.differenceItems.map((item) => `- ${item.date} / ${item.typeLabel} / ${item.nextAction}`))
  }
  if (!input.primaryAction && input.disabledReason) lines.push(`無効理由: ${input.disabledReason}`)
  if (input.stopReason) lines.push(`理由: ${input.stopReason}`)
  return lines.join('\n')
}
