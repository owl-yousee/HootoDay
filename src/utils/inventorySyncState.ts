import type { InventorySyncBaseline, InventorySyncSnapshot } from '../types/inventorySync'
import { inventoryContentFingerprint } from './inventorySyncSnapshot'

export type InventorySyncConflictSummary = {
  localOnly: number
  remoteOnly: number
  bothSame: number
  conflicts: number
}

export function isInventorySnapshotEmpty(snapshot: InventorySyncSnapshot): boolean {
  return snapshot.products.length === 0 &&
    snapshot.inventoryMovements.length === 0 &&
    snapshot.eventSalesRecords.length === 0 &&
    snapshot.boothSalesRecords.length === 0 &&
    snapshot.boothWarehouseSalesRecords.length === 0 &&
    snapshot.anniversaryCampaigns.length === 0 &&
    snapshot.anniversaryShipments.length === 0
}

type GroupMap = Map<string, string>

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).sort().join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function logicalGroups(snapshot: InventorySyncSnapshot): GroupMap {
  const groups = new Map<string, unknown>()
  snapshot.products.forEach((record) => groups.set(`product:${record.id}`, record))
  const movementsFor = (field: 'eventSalesRecordId' | 'boothSalesRecordId' | 'boothWarehouseSalesRecordId', id: string) =>
    snapshot.inventoryMovements.filter((record) => record[field] === id)
  snapshot.eventSalesRecords.forEach((record) =>
    groups.set(`event:${record.id}`, { record, movements: movementsFor('eventSalesRecordId', record.id) }))
  snapshot.boothSalesRecords.forEach((record) =>
    groups.set(`booth:${record.id}`, { record, movements: movementsFor('boothSalesRecordId', record.id) }))
  snapshot.boothWarehouseSalesRecords.forEach((record) =>
    groups.set(`warehouse:${record.id}`, { record, movements: movementsFor('boothWarehouseSalesRecordId', record.id) }))
  snapshot.inventoryMovements
    .filter((record) => !record.eventSalesRecordId && !record.boothSalesRecordId && !record.boothWarehouseSalesRecordId)
    .forEach((record) => groups.set(`movement:${record.id}`, record))
  snapshot.anniversaryCampaigns.forEach((record) => groups.set(`campaign:${record.id}`, record))
  snapshot.anniversaryShipments.forEach((record) => groups.set(`shipment:${record.id}`, record))
  return new Map([...groups].map(([key, value]) => [key, canonical(value)]))
}

export function classifyInventorySyncConflicts(
  baseline: InventorySyncBaseline,
  local: InventorySyncSnapshot,
  remote: InventorySyncSnapshot,
): InventorySyncConflictSummary {
  const baseGroups = logicalGroups(baseline.snapshot)
  const localGroups = logicalGroups(local)
  const remoteGroups = logicalGroups(remote)
  const keys = new Set([...baseGroups.keys(), ...localGroups.keys(), ...remoteGroups.keys()])
  const summary: InventorySyncConflictSummary = { localOnly: 0, remoteOnly: 0, bothSame: 0, conflicts: 0 }
  for (const key of keys) {
    const base = baseGroups.get(key)
    const localValue = localGroups.get(key)
    const remoteValue = remoteGroups.get(key)
    const localChanged = localValue !== base
    const remoteChanged = remoteValue !== base
    if (localChanged && remoteChanged) {
      if (localValue === remoteValue) summary.bothSame += 1
      else summary.conflicts += 1
    } else if (localChanged) summary.localOnly += 1
    else if (remoteChanged) summary.remoteOnly += 1
  }
  return summary
}

export function inventoryRemoteMatchesBaseline(
  baseline: InventorySyncBaseline,
  remote: InventorySyncSnapshot,
): boolean {
  return baseline.revision === remote.revision &&
    baseline.contentFingerprint === inventoryContentFingerprint(remote)
}
