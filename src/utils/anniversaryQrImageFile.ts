import type { AnniversaryShippingQrImage } from '../types/inventory'
import { isAnniversaryQrStoragePath } from './anniversaryQrImage'

export const ANNIVERSARY_QR_BUCKET = 'hooto-day-anniversary-qr'
export const ANNIVERSARY_QR_MAX_BYTES = 5 * 1024 * 1024
export const ANNIVERSARY_QR_MIN_EDGE = 320
export const ANNIVERSARY_QR_MAX_EDGE = 1600

export type AnniversaryQrFileDetails = {
  mimeType: AnniversaryShippingQrImage['mimeType']
  width: number
  height: number
  sizeBytes: number
}

export type AnniversaryQrFileValidation =
  | { ok: true; details: AnniversaryQrFileDetails }
  | { ok: false; reason: 'empty' | 'mime' | 'size' | 'decode' | 'dimensions' }

const allowedMimeTypes = new Set<AnniversaryShippingQrImage['mimeType']>([
  'image/png',
  'image/jpeg',
])

export function validateAnniversaryQrDimensions(width: number, height: number): boolean {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) &&
    width >= ANNIVERSARY_QR_MIN_EDGE && height >= ANNIVERSARY_QR_MIN_EDGE &&
    Math.max(width, height) <= ANNIVERSARY_QR_MAX_EDGE
}

export function createAnniversaryQrStoragePath(input: {
  workspaceId: string
  shipmentId: string
  objectId: string
  mimeType: AnniversaryShippingQrImage['mimeType']
}): string | null {
  const extension = input.mimeType === 'image/png' ? 'png' : 'jpg'
  const path = `${input.workspaceId}/anniversary-qr/${input.shipmentId}/${input.objectId}.${extension}`
  return isAnniversaryQrStoragePath(path, input.mimeType, input.shipmentId) ? path : null
}

export async function decodeAnniversaryQrImage(blob: Blob): Promise<{ width: number; height: number } | null> {
  const objectUrl = URL.createObjectURL(blob)
  try {
    const image = new Image()
    const decoded = new Promise<{ width: number; height: number } | null>((resolve) => {
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
      image.onerror = () => resolve(null)
    })
    image.src = objectUrl
    return await decoded
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export async function validateAnniversaryQrFile(file: File): Promise<AnniversaryQrFileValidation> {
  if (file.size <= 0) return { ok: false, reason: 'empty' }
  if (!allowedMimeTypes.has(file.type as AnniversaryShippingQrImage['mimeType'])) {
    return { ok: false, reason: 'mime' }
  }
  if (file.size > ANNIVERSARY_QR_MAX_BYTES) return { ok: false, reason: 'size' }
  const dimensions = await decodeAnniversaryQrImage(file)
  if (!dimensions) return { ok: false, reason: 'decode' }
  if (!validateAnniversaryQrDimensions(dimensions.width, dimensions.height)) {
    return { ok: false, reason: 'dimensions' }
  }
  return {
    ok: true,
    details: {
      mimeType: file.type as AnniversaryShippingQrImage['mimeType'],
      width: dimensions.width,
      height: dimensions.height,
      sizeBytes: file.size,
    },
  }
}

export async function validateDownloadedAnniversaryQrImage(
  blob: Blob,
  reference: AnniversaryShippingQrImage,
): Promise<boolean> {
  if (blob.size <= 0 || blob.size !== reference.sizeBytes || blob.type !== reference.mimeType) return false
  const dimensions = await decodeAnniversaryQrImage(blob)
  return Boolean(dimensions &&
    dimensions.width === reference.width &&
    dimensions.height === reference.height)
}
