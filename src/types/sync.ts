export type SyncDeviceRole = 'parent' | 'child'
export type SyncWorkspaceRole = 'owner' | 'member'
export type SyncPairingStatus = 'unpaired' | 'owner' | 'member'

export interface SyncConnection {
  version: 1
  workspaceId: string | null
  deviceId: string
  deviceRole: SyncDeviceRole | null
  workspaceRole: SyncWorkspaceRole | null
  pairingStatus: SyncPairingStatus
  pairedAt: string | null
}
