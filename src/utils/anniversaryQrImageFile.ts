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

export type PreparedAnniversaryQrFile = AnniversaryQrFileDetails & {
  file: File
  wasResized: boolean
  originalWidth: number
  originalHeight: number
}

export type AnniversaryQrFileValidation =
  | { ok: true; prepared: PreparedAnniversaryQrFile }
  | {
      ok: false
      reason: 'empty_file' | 'empty_mime' | 'unsupported_mime' | 'file_too_large' |
        'decode_failed' | 'object_url_failed' | 'dimensions_too_small' |
        'canvas_failed' | 'canvas_context_failed' | 'canvas_draw_failed' |
        'canvas_encode_failed' | 'resized_file_invalid'
    }

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

type ImageDecodeResult =
  | { ok: true; width: number; height: number }
  | { ok: false; reason: 'decode_failed' | 'object_url_failed' }

async function decodeAnniversaryQrImageResult(blob: Blob): Promise<ImageDecodeResult> {
  let objectUrl: string
  try {
    objectUrl = URL.createObjectURL(blob)
  } catch {
    return { ok: false, reason: 'object_url_failed' }
  }
  try {
    const image = new Image()
    const decoded = new Promise<ImageDecodeResult>((resolve) => {
      image.onload = () => resolve({
        ok: true,
        width: image.naturalWidth,
        height: image.naturalHeight,
      })
      image.onerror = () => resolve({ ok: false, reason: 'decode_failed' })
    })
    try {
      image.src = objectUrl
    } catch {
      return { ok: false, reason: 'decode_failed' }
    }
    return await decoded
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export async function decodeAnniversaryQrImage(blob: Blob): Promise<{ width: number; height: number } | null> {
  const result = await decodeAnniversaryQrImageResult(blob)
  return result.ok ? { width: result.width, height: result.height } : null
}

function calculateResizedDimensions(width: number, height: number): { width: number; height: number } {
  const scale = ANNIVERSARY_QR_MAX_EDGE / Math.max(width, height)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

async function resizeAnniversaryQrFile(
  file: File,
  originalWidth: number,
  originalHeight: number,
): Promise<AnniversaryQrFileValidation> {
  let objectUrl: string
  try {
    objectUrl = URL.createObjectURL(file)
  } catch {
    return { ok: false, reason: 'object_url_failed' }
  }
  try {
    const image = new Image()
    const loaded = await new Promise<boolean>((resolve) => {
      image.onload = () => resolve(true)
      image.onerror = () => resolve(false)
      try {
        image.src = objectUrl
      } catch {
        resolve(false)
      }
    })
    if (!loaded) return { ok: false, reason: 'decode_failed' }

    const dimensions = calculateResizedDimensions(originalWidth, originalHeight)
    let canvas: HTMLCanvasElement
    try {
      canvas = document.createElement('canvas')
      canvas.width = dimensions.width
      canvas.height = dimensions.height
    } catch {
      return { ok: false, reason: 'canvas_failed' }
    }
    const context = canvas.getContext('2d')
    if (!context) return { ok: false, reason: 'canvas_context_failed' }
    context.imageSmoothingEnabled = true
    if ('imageSmoothingQuality' in context) context.imageSmoothingQuality = 'high'
    try {
      context.drawImage(image, 0, 0, dimensions.width, dimensions.height)
    } catch {
      return { ok: false, reason: 'canvas_draw_failed' }
    }
    const blob = await new Promise<Blob | null>((resolve) => {
      try {
        canvas.toBlob(
          resolve,
          file.type,
          file.type === 'image/jpeg' ? 0.92 : undefined,
        )
      } catch {
        resolve(null)
      }
    })
    if (!blob) return { ok: false, reason: 'canvas_encode_failed' }
    const resizedFile = new File(
      [blob],
      file.type === 'image/png' ? 'anniversary-qr-resized.png' : 'anniversary-qr-resized.jpg',
      { type: file.type, lastModified: Date.now() },
    )
    const decoded = await decodeAnniversaryQrImageResult(resizedFile)
    if (!decoded.ok ||
      resizedFile.size <= 0 ||
      resizedFile.size > ANNIVERSARY_QR_MAX_BYTES ||
      resizedFile.type !== file.type ||
      decoded.width !== dimensions.width ||
      decoded.height !== dimensions.height ||
      !validateAnniversaryQrDimensions(decoded.width, decoded.height)) {
      return { ok: false, reason: 'resized_file_invalid' }
    }
    return {
      ok: true,
      prepared: {
        file: resizedFile,
        mimeType: file.type as AnniversaryShippingQrImage['mimeType'],
        width: decoded.width,
        height: decoded.height,
        sizeBytes: resizedFile.size,
        wasResized: true,
        originalWidth,
        originalHeight,
      },
    }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export async function validateAnniversaryQrFile(file: File): Promise<AnniversaryQrFileValidation> {
  if (file.size <= 0) return { ok: false, reason: 'empty_file' }
  if (!file.type) return { ok: false, reason: 'empty_mime' }
  if (!allowedMimeTypes.has(file.type as AnniversaryShippingQrImage['mimeType'])) {
    return { ok: false, reason: 'unsupported_mime' }
  }
  if (file.size > ANNIVERSARY_QR_MAX_BYTES) return { ok: false, reason: 'file_too_large' }
  const decoded = await decodeAnniversaryQrImageResult(file)
  if (!decoded.ok) return decoded
  if (decoded.width < ANNIVERSARY_QR_MIN_EDGE || decoded.height < ANNIVERSARY_QR_MIN_EDGE) {
    return { ok: false, reason: 'dimensions_too_small' }
  }
  if (Math.max(decoded.width, decoded.height) > ANNIVERSARY_QR_MAX_EDGE) {
    return resizeAnniversaryQrFile(file, decoded.width, decoded.height)
  }
  return {
    ok: true,
    prepared: {
      file,
      mimeType: file.type as AnniversaryShippingQrImage['mimeType'],
      width: decoded.width,
      height: decoded.height,
      sizeBytes: file.size,
      wasResized: false,
      originalWidth: decoded.width,
      originalHeight: decoded.height,
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
