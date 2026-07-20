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

export type DayMemoInitialUploadStatusV2 =
  | 'not_started'
  | 'prepared'
  | 'uploading'
  | 'partially_completed'
  | 'completed'
  | 'recovery_required'

export interface DayMemoInitialUploadEntryV2 {
  status: DayMemoUploadEntryStatus
  operationId: string | null
  preparedUpdatedAt: string
  baseRevision: number
  remoteRevision: number | null
  remoteChangeSequence: number | null
  errorCode: DayMemoSyncErrorCode | null
}

export interface DayMemoRemoteBaselineV2 {
  date: string
  remoteRevision: number
  remoteChangeSequence: number
  remoteUpdatedAt: string
  baselineLocalUpdatedAt: string | null
  deletedAt: string | null
}

export interface DayMemoPendingOperationV2 {
  kind: 'upsert'
  date: string
  operationId: string
  baseRevision: number
  preparedLocalUpdatedAt: string
  preparedAt: string
  status: 'prepared' | 'sending' | 'response_unknown' | 'conflict' | 'recovery_required'
}

export type DayMemoRemoteBaselineV3 = DayMemoRemoteBaselineV2

export interface DayMemoLocalDeleteIntentV3 {
  date: string
  baselineRevision: number
  baselineChangeSequence: number
  deletedLocalUpdatedAt: string
  createdAt: string
  status: 'intent_recorded' | 'preview_ready' | 'prepared' | 'sending' | 'conflict' | 'response_unknown' | 'recovery_required'
}

export interface DayMemoLocalDeleteIntentV4 extends DayMemoLocalDeleteIntentV3 {
  operationId: string
}

export type DayMemoPendingOperationV3 =
  | DayMemoPendingOperationV2
  | {
    kind: 'delete'
    date: string
    operationId: string
    baseRevision: number
    preparedAt: string
    clientDeletedAt: string
    status: 'prepared' | 'sending' | 'response_unknown' | 'conflict' | 'recovery_required'
  }

export type DayMemoBaselineStatusV2 =
  | 'not_confirmed'
  | 'confirming'
  | 'confirmed'
  | 'mismatch'
  | 'remote_empty'
  | 'recovery_required'

export interface DayMemoSyncMetadataV2 {
  version: 2
  workspaceId: string
  initialUpload: {
    status: DayMemoInitialUploadStatusV2
    preparedAt: string | null
    completedAt: string | null
    targetDates: string[]
    entries: Record<string, DayMemoInitialUploadEntryV2>
  }
  baselines: Record<string, DayMemoRemoteBaselineV2>
  lastPulledChangeSequence: number
  baselineStatus: DayMemoBaselineStatusV2
  baselineConfirmedAt: string | null
  pendingOperation: DayMemoPendingOperationV2 | null
  pushBlock: null | { reason: DayMemoPushBlockReason; blockedAt: string }
  lastSuccessfulSyncAt: string | null
  migration: {
    sourceVersion: 1 | 2
    status: 'completed'
    migratedAt: string
  }
}

export interface DayMemoSyncMetadataV3 {
  version: 3
  workspaceId: string
  initialUpload: DayMemoSyncMetadataV2['initialUpload']
  baselines: Record<string, DayMemoRemoteBaselineV3>
  localDeleteIntents: Record<string, DayMemoLocalDeleteIntentV3>
  lastPulledChangeSequence: number
  baselineStatus: DayMemoBaselineStatusV2
  baselineConfirmedAt: string | null
  pendingOperation: DayMemoPendingOperationV3 | null
  pushBlock: DayMemoSyncMetadataV2['pushBlock']
  lastSuccessfulSyncAt: string | null
  migration: {
    sourceVersion: 1 | 2 | 3
    status: 'completed'
    migratedAt: string
  }
}

export interface DayMemoSyncMetadataV4 {
  version: 4
  workspaceId: string
  initialUpload: DayMemoSyncMetadataV2['initialUpload']
  baselines: Record<string, DayMemoRemoteBaselineV3>
  localDeleteIntents: Record<string, DayMemoLocalDeleteIntentV4>
  lastPulledChangeSequence: number
  baselineStatus: DayMemoBaselineStatusV2
  baselineConfirmedAt: string | null
  pendingOperation: DayMemoPendingOperationV3 | null
  pushBlock: DayMemoSyncMetadataV2['pushBlock']
  lastSuccessfulSyncAt: string | null
  migration: {
    sourceVersion: 1 | 2 | 3 | 4
    status: 'completed'
    migratedAt: string
  }
}

export type DayMemoSyncMetadata = DayMemoSyncMetadataV1 | DayMemoSyncMetadataV2 | DayMemoSyncMetadataV3 | DayMemoSyncMetadataV4

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
