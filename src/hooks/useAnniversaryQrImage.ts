import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { AnniversaryShipment, AnniversaryShippingQrImage } from '../types/inventory'
import {
  anniversaryQrStoragePathMatchesWorkspace,
  isAnniversaryShippingQrImage,
} from '../utils/anniversaryQrImage'
import {
  ANNIVERSARY_QR_BUCKET,
  createAnniversaryQrStoragePath,
  validateAnniversaryQrFile,
  validateDownloadedAnniversaryQrImage,
  type AnniversaryQrFileDetails,
} from '../utils/anniversaryQrImageFile'
import { createUuidV4 } from '../utils/uuid'

export type AnniversaryQrPreview = AnniversaryQrFileDetails & {
  shipmentId: string
  shipmentUpdatedAt: string
  file: File
  objectUrl: string
}

type DisplayedAnniversaryQr = {
  shipmentId: string
  objectUrl: string
}

type Input = {
  shipments: AnniversaryShipment[]
  isConfigured: boolean
  isSignedIn: boolean
  workspaceId: string | null
  workspaceConnected: boolean
  onSaveReference: (shipment: AnniversaryShipment, expectedShipmentId: string) => string | null
}

const selectionError = {
  empty_file: '空の画像ファイルは登録できません。',
  empty_mime: '画像形式を確認できませんでした。PNGまたはJPEGを選んでください。',
  unsupported_mime: 'この画像形式にはまだ対応していません。PNGまたはJPEGを選んでください。',
  file_too_large: '画像は5MB以下にしてください。',
  decode_failed: '画像を安全に読み込めませんでした。別のPNGまたはJPEGを選んでください。',
  object_url_failed: '選択した画像のプレビューを準備できませんでした。もう一度選んでください。',
  dimensions_too_small: '画像は縦横320px以上にしてください。',
  dimensions_too_large: '画像の最長辺は1600px以下にしてください。',
} as const

export function useAnniversaryQrImage(input: Input) {
  const {
    shipments,
    isConfigured,
    isSignedIn,
    workspaceId,
    workspaceConnected,
    onSaveReference,
  } = input
  const shipmentsRef = useRef(shipments)
  const previewRef = useRef<AnniversaryQrPreview | null>(null)
  const displayRef = useRef<DisplayedAnniversaryQr | null>(null)
  const orphanedPathRef = useRef<string | null>(null)
  const runningRef = useRef(false)
  const selectionAttemptRef = useRef(0)
  const [preview, setPreview] = useState<AnniversaryQrPreview | null>(null)
  const [display, setDisplay] = useState<DisplayedAnniversaryQr | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [errorShipmentId, setErrorShipmentId] = useState<string | null>(null)

  const showError = useCallback((shipmentId: string | null, value: string) => {
    setErrorShipmentId(shipmentId)
    setError(value)
  }, [])
  const clearError = useCallback(() => {
    setError('')
    setErrorShipmentId(null)
  }, [])

  useEffect(() => {
    shipmentsRef.current = shipments
  }, [shipments])
  useEffect(() => {
    previewRef.current = preview
  }, [preview])
  useEffect(() => {
    displayRef.current = display
  }, [display])
  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current.objectUrl)
    if (displayRef.current) URL.revokeObjectURL(displayRef.current.objectUrl)
  }, [])

  const clearPreview = useCallback(() => {
    if (runningRef.current) return
    selectionAttemptRef.current += 1
    setPreview((current) => {
      if (current) URL.revokeObjectURL(current.objectUrl)
      return null
    })
    clearError()
  }, [clearError])

  const clearDisplay = useCallback(() => {
    if (runningRef.current) return
    setDisplay((current) => {
      if (current) URL.revokeObjectURL(current.objectUrl)
      return null
    })
    clearError()
  }, [clearError])

  const selectFile = useCallback(async (shipmentId: string, file: File) => {
    if (runningRef.current) return
    const attempt = ++selectionAttemptRef.current
    setMessage('')
    clearError()
    const shipment = shipmentsRef.current.find((item) => item.id === shipmentId)
    if (!shipment || shipment.shippingQrImage) {
      showError(shipmentId, '現在の発送カードへQR画像を登録できません。画面を確認してください。')
      return
    }
    let result
    try {
      result = await validateAnniversaryQrFile(file)
    } catch {
      if (attempt === selectionAttemptRef.current) {
        showError(shipmentId, '画像選択処理を完了できませんでした。もう一度選んでください。')
      }
      return
    }
    if (attempt !== selectionAttemptRef.current) return
    if (!result.ok) {
      showError(shipmentId, selectionError[result.reason])
      return
    }
    const currentShipment = shipmentsRef.current.find((item) => item.id === shipmentId)
    if (!currentShipment || currentShipment.shippingQrImage ||
      currentShipment.updatedAt !== shipment.updatedAt) {
      showError(shipmentId, '対象の発送カードが変化したため画像選択を停止しました。')
      return
    }
    let objectUrl: string
    try {
      objectUrl = URL.createObjectURL(file)
    } catch {
      showError(shipmentId, selectionError.object_url_failed)
      return
    }
    setPreview((current) => {
      if (current) URL.revokeObjectURL(current.objectUrl)
      return { shipmentId, shipmentUpdatedAt: shipment.updatedAt, file, objectUrl, ...result.details }
    })
  }, [clearError, showError])

  const reportEmptySelection = useCallback((shipmentId: string | null) => {
    showError(shipmentId, '画像が選択されませんでした。もう一度選んでください。')
  }, [showError])

  const prerequisitesAreValid = useCallback((shipmentId: string) =>
    Boolean(supabaseClient && isConfigured && isSignedIn &&
      workspaceConnected && workspaceId &&
      shipmentsRef.current.some((item) => item.id === shipmentId && !item.shippingQrImage)),
  [isConfigured, isSignedIn, workspaceConnected, workspaceId])

  const uploadPreview = useCallback(async () => {
    const currentPreview = previewRef.current
    if (!currentPreview || runningRef.current) return
    setMessage('')
    clearError()
    if (!prerequisitesAreValid(currentPreview.shipmentId) || !supabaseClient || !workspaceId) {
      showError(currentPreview.shipmentId, '認証またはworkspaceの状態を安全に確認できないため登録できません。')
      return
    }
    const shipment = shipmentsRef.current.find((item) => item.id === currentPreview.shipmentId)
    if (!shipment || shipment.shippingQrImage ||
      shipment.updatedAt !== currentPreview.shipmentUpdatedAt) {
      showError(currentPreview.shipmentId, '対象の発送カードが変化したため登録を停止しました。')
      return
    }
    const objectId = createUuidV4()
    if (!objectId) {
      showError(currentPreview.shipmentId, '画像登録に必要なIDを作成できませんでした。')
      return
    }
    const path = createAnniversaryQrStoragePath({
      workspaceId,
      shipmentId: shipment.id,
      objectId,
      mimeType: currentPreview.mimeType,
    })
    if (!path) {
      showError(currentPreview.shipmentId, '安全な画像保存先を作成できませんでした。')
      return
    }

    runningRef.current = true
    setIsUploading(true)
    let uploaded = false
    try {
      const upload = await supabaseClient.storage.from(ANNIVERSARY_QR_BUCKET).upload(
        path,
        currentPreview.file,
        { upsert: false, contentType: currentPreview.mimeType, cacheControl: '3600' },
      )
      if (upload.error || upload.data.path !== path) {
        if (upload.data) await supabaseClient.storage.from(ANNIVERSARY_QR_BUCKET).remove([path])
        showError(currentPreview.shipmentId, 'QR画像のアップロードに失敗しました。自動再試行は行いません。')
        return
      }
      uploaded = true
      const now = new Date().toISOString()
      const reference: AnniversaryShippingQrImage = {
        storagePath: path,
        mimeType: currentPreview.mimeType,
        width: currentPreview.width,
        height: currentPreview.height,
        sizeBytes: currentPreview.sizeBytes,
        createdAt: now,
        updatedAt: now,
      }
      if (!isAnniversaryShippingQrImage(reference, shipment.id) ||
        !anniversaryQrStoragePathMatchesWorkspace(reference.storagePath, workspaceId)) {
        const rollback = await supabaseClient.storage.from(ANNIVERSARY_QR_BUCKET).remove([path])
        if (rollback.error) {
          orphanedPathRef.current = path
          showError(currentPreview.shipmentId, 'QR画像の参照情報を作成できず、画像の取り消しにも失敗しました。孤立画像が残った可能性があります。')
        } else {
          uploaded = false
          showError(currentPreview.shipmentId, 'QR画像の参照情報を安全に作成できなかったため、画像を取り消しました。')
        }
        return
      }
      const saveResult = onSaveReference({
        ...shipment,
        shippingQrImage: reference,
        updatedAt: now,
      }, shipment.id)
      if (saveResult) {
        const rollback = await supabaseClient.storage.from(ANNIVERSARY_QR_BUCKET).remove([path])
        if (rollback.error) {
          orphanedPathRef.current = path
          showError(currentPreview.shipmentId, '参照情報を保存できず、画像の取り消しにも失敗しました。孤立画像が残った可能性があります。自動再試行は行いません。')
        } else {
          uploaded = false
          showError(currentPreview.shipmentId, '参照情報を保存できなかったため、アップロードした画像を取り消しました。')
        }
        return
      }
      uploaded = false
      setMessage('QR画像を登録しました。')
      setPreview((value) => {
        if (value) URL.revokeObjectURL(value.objectUrl)
        return null
      })
    } catch {
      if (uploaded) {
        const rollback = await supabaseClient.storage.from(ANNIVERSARY_QR_BUCKET).remove([path])
        if (rollback.error) {
          orphanedPathRef.current = path
          showError(currentPreview.shipmentId, '登録処理に失敗し、画像の取り消しにも失敗しました。孤立画像が残った可能性があります。自動再試行は行いません。')
        } else {
          showError(currentPreview.shipmentId, '登録処理に失敗したため、アップロードした画像を取り消しました。')
        }
      } else {
        showError(currentPreview.shipmentId, 'QR画像の登録処理に失敗しました。自動再試行は行いません。')
      }
    } finally {
      runningRef.current = false
      setIsUploading(false)
    }
  }, [clearError, onSaveReference, prerequisitesAreValid, showError, workspaceId])

  const downloadImage = useCallback(async (shipmentId: string) => {
    if (runningRef.current) return
    setMessage('')
    clearError()
    const shipment = shipmentsRef.current.find((item) => item.id === shipmentId)
    const reference = shipment?.shippingQrImage
    if (!shipment || !reference || !workspaceId || !supabaseClient ||
      !isConfigured || !isSignedIn || !workspaceConnected ||
      !isAnniversaryShippingQrImage(reference, shipment.id) ||
      !anniversaryQrStoragePathMatchesWorkspace(reference.storagePath, workspaceId)) {
      showError(shipmentId, 'QR画像の参照、認証、またはworkspaceを安全に確認できません。')
      return
    }
    runningRef.current = true
    setIsDownloading(true)
    try {
      const result = await supabaseClient.storage.from(ANNIVERSARY_QR_BUCKET).download(reference.storagePath)
      if (result.error || !result.data) {
        showError(shipmentId, 'QR画像が見つかりません。参照情報はありますが画像を取得できません。')
        return
      }
      if (!await validateDownloadedAnniversaryQrImage(result.data, reference)) {
        showError(shipmentId, '取得したQR画像を安全に確認できませんでした。')
        return
      }
      const objectUrl = URL.createObjectURL(result.data)
      setDisplay((current) => {
        if (current) URL.revokeObjectURL(current.objectUrl)
        return { shipmentId, objectUrl }
      })
    } catch {
      showError(shipmentId, '通信状態を確認してください。QR画像を取得できませんでした。')
    } finally {
      runningRef.current = false
      setIsDownloading(false)
    }
  }, [clearError, isConfigured, isSignedIn, showError, workspaceConnected, workspaceId])

  return {
    preview,
    display,
    isUploading,
    isDownloading,
    message,
    error,
    errorShipmentId,
    selectFile,
    reportEmptySelection,
    clearError,
    uploadPreview,
    downloadImage,
    clearPreview,
    clearDisplay,
  }
}
