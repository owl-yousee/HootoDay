import type { DayMemoNormalDifferenceClassification } from '../hooks/useDayMemoNormalDifferenceRecoveryPlan'
import type { DayMemoPullComparison } from '../types/dayMemoSync'

export interface SyncDifferencePresentationItem {
  date: string
  classification: string
  title: string
  typeLabel: string
  nextAction: string
}

const PRESENTATION: Record<DayMemoNormalDifferenceClassification, Omit<SyncDifferencePresentationItem, 'date' | 'classification'>> = {
  exact_match_baseline_confirmed: { title: '差異はありません', typeLabel: '一致', nextAction: 'なし' },
  exact_match_baseline_missing: { title: '内容は一致していますが確認が必要です', typeLabel: '同期情報未確認', nextAction: '安全確認が必要' },
  exact_body_timestamp_mismatch: { title: '内容は一致していますが更新時刻が違います', typeLabel: '更新時刻相違', nextAction: '安全確認が必要' },
  body_mismatch: { title: '内容が違います', typeLabel: '本文相違', nextAction: '内容を比較' },
  local_only: { title: 'このiPhoneにだけあります', typeLabel: 'iPhoneのみ', nextAction: '送信候補を確認' },
  remote_only_active: { title: '同期先にだけあります', typeLabel: '同期先のみ', nextAction: 'このiPhoneへ反映' },
  remote_only_tombstone: { title: '同期先で削除されています', typeLabel: '同期先削除済み', nextAction: '削除内容を確認' },
  active_tombstone_mismatch: { title: '削除状態が一致しません', typeLabel: '削除状態相違', nextAction: '安全確認が必要' },
  revision_lineage_mismatch: { title: '同期履歴が一致しません', typeLabel: '同期履歴相違', nextAction: '安全確認が必要' },
  unknown: { title: '確認できない差異があります', typeLabel: '確認不能', nextAction: '安全確認が必要' },
}

const PULL_TO_CLASSIFICATION: Partial<Record<DayMemoPullComparison, DayMemoNormalDifferenceClassification>> = {
  different: 'body_mismatch',
  local_only: 'local_only',
  remote_only: 'remote_only_active',
  remote_tombstone_local_exists: 'active_tombstone_mismatch',
  remote_tombstone_local_missing: 'remote_only_tombstone',
}

export function presentSyncDifference(date: string, classification: DayMemoNormalDifferenceClassification): SyncDifferencePresentationItem {
  return { date, classification, ...PRESENTATION[classification] }
}

export function presentPullDifference(date: string, comparison: DayMemoPullComparison): SyncDifferencePresentationItem | null {
  const classification = PULL_TO_CLASSIFICATION[comparison]
  return classification ? presentSyncDifference(date, classification) : null
}

export function withCurrentDifferenceAction(items: SyncDifferencePresentationItem[], date: string | null, action: string | null) {
  if (!date || !action) return items
  return items.map((item) => item.date === date ? { ...item, nextAction: action } : item)
}
