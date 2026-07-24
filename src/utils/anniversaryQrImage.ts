import type { AnniversaryShippingQrImage } from '../types/inventory'

const UUID_SEGMENT = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const STORAGE_PATH_PATTERN = new RegExp(
  `^(${UUID_SEGMENT})/anniversary-qr/(${UUID_SEGMENT})/(${UUID_SEGMENT})\\.(png|jpe?g)$`,
  'i',
)

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

const isIsoDate = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value))

const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })

export function isAnniversaryQrStoragePath(
  value: unknown,
  mimeType?: AnniversaryShippingQrImage['mimeType'],
  shipmentId?: string,
): value is string {
  if (typeof value !== 'string' || !value || value.startsWith('/') ||
    value.includes('..') || hasControlCharacter(value) ||
    /^[a-z][a-z0-9+.-]*:/i.test(value)) return false

  const match = STORAGE_PATH_PATTERN.exec(value)
  if (!match) return false
  if (shipmentId && match[2].toLowerCase() !== shipmentId.toLowerCase()) return false
  if (!mimeType) return true
  const extension = match[4].toLowerCase()
  return mimeType === 'image/png' ? extension === 'png' : extension === 'jpg' || extension === 'jpeg'
}

export function anniversaryQrStoragePathMatchesWorkspace(
  storagePath: string,
  workspaceId: string,
): boolean {
  const match = STORAGE_PATH_PATTERN.exec(storagePath)
  return Boolean(match && match[1].toLowerCase() === workspaceId.toLowerCase())
}

export function isAnniversaryShippingQrImage(
  value: unknown,
  shipmentId?: string,
): value is AnniversaryShippingQrImage {
  if (!isObject(value) || (value.mimeType !== 'image/png' && value.mimeType !== 'image/jpeg')) return false
  return isAnniversaryQrStoragePath(value.storagePath, value.mimeType, shipmentId) &&
    isPositiveInteger(value.width) &&
    isPositiveInteger(value.height) &&
    isPositiveInteger(value.sizeBytes) &&
    isIsoDate(value.createdAt) &&
    isIsoDate(value.updatedAt)
}
