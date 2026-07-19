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
