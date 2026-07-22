import type { DayMemo } from '../types/dayMemo'
import type {
  DayMemoPullComparison,
  DayMemoPullPreviewItem,
  DayMemoPullPreviewSummary,
  DayMemoSyncMetadataV5,
} from '../types/dayMemoSync'
import { fromDateKey } from './date'
import type { RemoteDayMemoRecord } from './dayMemoSyncPull'
import {
  classifyDayMemoNormalDifference,
  type DayMemoNormalDifferenceClassification,
} from '../hooks/useDayMemoNormalDifferenceRecoveryPlan'

export interface DayMemoPullPreviewBuildResult {
  items: DayMemoPullPreviewItem[]
  summary: DayMemoPullPreviewSummary
  remoteRecords: RemoteDayMemoRecord[]
  classifications: Record<string, DayMemoNormalDifferenceClassification>
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIsoDateTime(value: unknown): value is string {
  return typeof value === 'string'
    && ISO_DATE_TIME_PATTERN.test(value)
    && !Number.isNaN(Date.parse(value))
}

function isValidDayMemo(value: unknown, expectedDate?: string): value is DayMemo {
  if (!isRecord(value)) return false
  const keys = Object.keys(value).sort()
  return JSON.stringify(keys) === JSON.stringify(['content', 'date', 'updatedAt'])
    && typeof value.date === 'string'
    && DATE_PATTERN.test(value.date)
    && Boolean(fromDateKey(value.date))
    && (expectedDate === undefined || value.date === expectedDate)
    && typeof value.content === 'string'
    && value.content.length >= 1
    && value.content.length <= 2000
    && value.content === value.content.trim()
    && isIsoDateTime(value.updatedAt)
}

function comparisonForClassification(
  classification: DayMemoNormalDifferenceClassification,
  remote: RemoteDayMemoRecord | null,
  local: DayMemo | null,
): DayMemoPullComparison {
  if (classification === 'exact_match_baseline_confirmed'
    || classification === 'exact_match_baseline_missing') return 'same'
  if (classification === 'local_only') return 'local_only'
  if (classification === 'remote_only_active') return 'remote_only'
  if (remote?.deletedAt !== null && remote !== null) {
    return local ? 'remote_tombstone_local_exists' : 'remote_tombstone_local_missing'
  }
  return 'different'
}

export function buildDayMemoPullPreview(
  remoteRecords: RemoteDayMemoRecord[],
  localMemos: DayMemo[],
  metadata: DayMemoSyncMetadataV5 | null,
): DayMemoPullPreviewBuildResult | null {
  if (!localMemos.every((memo) => isValidDayMemo(memo))) return null
  const localByDate = new Map<string, DayMemo>()
  for (const memo of localMemos) {
    if (localByDate.has(memo.date)) return null
    localByDate.set(memo.date, memo)
  }

  const remoteByDate = new Map(remoteRecords.map((record) => [record.entityId, record]))
  if (remoteByDate.size !== remoteRecords.length) return null
  const dates = [...new Set([
    ...localByDate.keys(),
    ...remoteByDate.keys(),
    ...Object.keys(metadata?.baselines ?? {}),
  ])].sort()
  const classifications = new Map(dates.map((date) => {
    const local = localByDate.get(date) ?? null
    const remote = remoteByDate.get(date) ?? null
    return [date, classifyDayMemoNormalDifference(local, remote, metadata?.baselines[date] ?? null)] as const
  }))
  const items: DayMemoPullPreviewItem[] = dates.map((date) => {
    const local = localByDate.get(date) ?? null
    const remote = remoteByDate.get(date) ?? null
    const comparison = comparisonForClassification(classifications.get(date)!, remote, local)
    return {
      date,
      comparison,
      remoteRevision: remote?.revision ?? null,
      remoteChangeSequence: remote?.changeSequence ?? null,
      remoteUpdatedAt: remote
        ? remote.deletedAt === null ? remote.payload?.updatedAt ?? null : remote.serverUpdatedAt
        : null,
      remoteDeletedAt: remote?.deletedAt ?? null,
      tombstone: remote?.deletedAt !== null && remote !== null,
    }
  })

  const count = (comparison: DayMemoPullComparison) => items.filter((item) => item.comparison === comparison).length
  const unresolvedTombstoneCount = remoteRecords.filter((record) => record.deletedAt !== null
    && classifications.get(record.entityId) !== 'exact_match_baseline_confirmed').length
  return {
    items,
    classifications: Object.fromEntries(classifications),
    summary: {
      remoteActiveCount: remoteRecords.filter((record) => record.deletedAt === null).length,
      remoteTombstoneCount: remoteRecords.filter((record) => record.deletedAt !== null).length,
      unresolvedTombstoneCount,
      remoteOnlyCount: count('remote_only'),
      localOnlyCount: count('local_only'),
      sameCount: count('same'),
      differentCount: count('different'),
      remoteTombstoneLocalExistsCount: count('remote_tombstone_local_exists'),
      remoteTombstoneLocalMissingCount: count('remote_tombstone_local_missing'),
      maxChangeSequence: remoteRecords.at(-1)?.changeSequence ?? 0,
    },
    remoteRecords,
  }
}
