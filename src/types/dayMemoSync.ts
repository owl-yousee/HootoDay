export type DayMemoInitialUploadStatus =
  | 'not_started'
  | 'prepared'
  | 'uploading'
  | 'partial'
  | 'completed'
  | 'blocked'

export type DayMemoUploadEntryStatus = 'pending' | 'response_unknown' | 'applied' | 'conflict'

export type DayMemoSyncErrorCode =
  | 'authentication_required'
  | 'membership_required'
  | 'remote_not_empty'
  | 'local_changed'
  | 'rpc_failed'
  | 'response_invalid'
  | 'storage_failed'
  | 'metadata_invalid'

export type DayMemoPushBlockReason = 'json_restore' | 'full_reset' | 'remote_not_empty' | 'metadata_invalid'

export interface DayMemoInitialUploadEntryV1 {
  status: DayMemoUploadEntryStatus
  operationId: string | null
  preparedUpdatedAt: string
  baseRevision: 0
  remoteRevision: number | null
  remoteChangeSequence: number | null
  errorCode: DayMemoSyncErrorCode | null
}

export interface DayMemoSyncMetadataV1 {
  version: 1
  workspaceId: string
  initialUploadStatus: DayMemoInitialUploadStatus
  preparedAt: string | null
  completedAt: string | null
  targetDates: string[]
  entries: Record<string, DayMemoInitialUploadEntryV1>
  lastPulledChangeSequence: number
  pushBlock: null | { reason: DayMemoPushBlockReason; blockedAt: string }
  lastSuccessfulSyncAt: string | null
}

export type DayMemoPullPreviewState =
  | 'unavailable'
  | 'idle'
  | 'pulling'
  | 'preview_ready'
  | 'empty_remote'
  | 'tombstones_present'
  | 'incomplete'
  | 'validation_error'
  | 'workspace_mismatch'
  | 'auth_error'
  | 'rpc_error'
  | 'limit_reached'
  | 'recovery_required'

export type DayMemoPullComparison =
  | 'remote_only'
  | 'local_only'
  | 'same'
  | 'different'
  | 'remote_tombstone_local_exists'
  | 'remote_tombstone_local_missing'

export interface DayMemoPullPreviewItem {
  date: string
  comparison: DayMemoPullComparison
  remoteRevision: number | null
  remoteChangeSequence: number | null
  tombstone: boolean
}

export interface DayMemoPullPreviewSummary {
  remoteActiveCount: number
  remoteTombstoneCount: number
  remoteOnlyCount: number
  localOnlyCount: number
  sameCount: number
  differentCount: number
  remoteTombstoneLocalExistsCount: number
  remoteTombstoneLocalMissingCount: number
  maxChangeSequence: number
}

export type DayMemoPullApplyState =
  | 'idle'
  | 'applying'
  | 'completed'
  | 'preview_invalid'
  | 'local_changed'
  | 'connection_changed'
  | 'metadata_invalid'
  | 'backup_failed'
  | 'storage_failed'
  | 'recovery_required'

export interface DayMemoPullApplyResult {
  appliedCount: number
  localTotalCount: number
}
