import { useEffect, useMemo, useRef, useState } from 'react'
import { Gift } from '@phosphor-icons/react'
import type {
  AnniversaryCampaign,
  AnniversaryShipment,
  AnniversaryShipmentStatus,
} from '../types/inventory'
import { createUuidV4 } from '../utils/uuid'

type Props = {
  campaigns: AnniversaryCampaign[]
  shipments: AnniversaryShipment[]
  onSave: (
    campaign: AnniversaryCampaign,
    shipment: AnniversaryShipment,
    expectedShipmentId?: string | null,
  ) => string | null
  onDelete: (shipmentId: string) => string | null
  onEditingStateChange?: (editing: boolean) => void
}

type FieldErrors = Partial<Record<
  'year' | 'name' | 'destinationNumber' | 'itemDescription' | 'quantity',
  string
>>

const statusOptions: { value: AnniversaryShipmentStatus; label: string }[] = [
  { value: 'unprepared', label: '未準備' },
  { value: 'preparing', label: '準備中' },
  { value: 'prepared', label: '準備済み' },
  { value: 'not_shipped', label: '未発送' },
  { value: 'shipped', label: '発送済み' },
]

const statusLabel = (status: AnniversaryShipmentStatus) =>
  statusOptions.find((option) => option.value === status)?.label ?? status

export function AnniversaryManagementPanel({
  campaigns,
  shipments,
  onSave,
  onDelete,
  onEditingStateChange,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const submittingRef = useRef(false)
  const lockedScrollYRef = useRef(0)
  const [editing, setEditing] = useState<AnniversaryShipment | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const campaignById = useMemo(
    () => new Map(campaigns.map((campaign) => [campaign.id, campaign])),
    [campaigns],
  )
  const rows = useMemo(() => [...shipments]
    .map((shipment) => ({ shipment, campaign: campaignById.get(shipment.campaignId) }))
    .filter((row): row is { shipment: AnniversaryShipment; campaign: AnniversaryCampaign } =>
      Boolean(row.campaign))
    .sort((a, b) => b.campaign.year - a.campaign.year ||
      b.shipment.updatedAt.localeCompare(a.shipment.updatedAt)), [campaignById, shipments])

  useEffect(() => () => onEditingStateChange?.(false), [onEditingStateChange])
  useEffect(() => {
    if (!isOpen) return
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    const body = document.body
    const root = document.documentElement
    const previous = {
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyWidth: body.style.width,
      bodyOverflow: body.style.overflow,
      rootOverflow: root.style.overflow,
      rootOverscroll: root.style.overscrollBehavior,
    }
    lockedScrollYRef.current = window.scrollY
    body.style.position = 'fixed'
    body.style.top = `-${lockedScrollYRef.current}px`
    body.style.width = '100%'
    body.style.overflow = 'hidden'
    root.style.overflow = 'hidden'
    root.style.overscrollBehavior = 'none'
    return () => {
      body.style.position = previous.bodyPosition
      body.style.top = previous.bodyTop
      body.style.width = previous.bodyWidth
      body.style.overflow = previous.bodyOverflow
      root.style.overflow = previous.rootOverflow
      root.style.overscrollBehavior = previous.rootOverscroll
      window.scrollTo({ top: lockedScrollYRef.current, behavior: 'auto' })
    }
  }, [isOpen])

  const open = (shipment: AnniversaryShipment | null = null) => {
    setEditing(shipment)
    setError('')
    setFieldErrors({})
    setIsOpen(true)
    onEditingStateChange?.(true)
  }
  const close = () => {
    if (submittingRef.current) return
    dialogRef.current?.close()
    setIsOpen(false)
    setEditing(null)
    setError('')
    setFieldErrors({})
    onEditingStateChange?.(false)
  }

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submittingRef.current) return
    const form = new FormData(event.currentTarget)
    const yearText = String(form.get('year') ?? '').trim()
    const year = Number(yearText)
    const name = String(form.get('name') ?? '').trim()
    const fanboxPlan = String(form.get('fanboxPlan') ?? '').trim()
    const destinationNumber = String(form.get('destinationNumber') ?? '').trim()
    const itemDescription = String(form.get('itemDescription') ?? '').trim()
    const quantityText = String(form.get('quantity') ?? '').trim()
    const quantity = Number(quantityText)
    const status = String(form.get('status') ?? '') as AnniversaryShipmentStatus
    const shippedAtText = String(form.get('shippedAt') ?? '').trim()
    const memo = String(form.get('memo') ?? '').trim()
    const nextErrors: FieldErrors = {}
    if (!/^\d{4}$/.test(yearText) || !Number.isInteger(year) || year < 1900 || year > 9999) {
      nextErrors.year = '対象年は1900〜9999の4桁で入力してください。'
    }
    if (!name) nextErrors.name = '周年名を入力してください。'
    if (!destinationNumber) nextErrors.destinationNumber = '宛先番号を入力してください。'
    if (!itemDescription) nextErrors.itemDescription = '発送物を入力してください。'
    if (!/^\d+$/.test(quantityText) || !Number.isSafeInteger(quantity) || quantity < 1) {
      nextErrors.quantity = '数量は1以上の整数で入力してください。'
    }
    if (!statusOptions.some((option) => option.value === status)) {
      setError('状態を選択してください。')
      return
    }
    if (Object.keys(nextErrors).length) {
      setFieldErrors(nextErrors)
      setError('入力内容を確認してください。')
      return
    }

    submittingRef.current = true
    setIsSubmitting(true)
    setError('')
    setFieldErrors({})
    try {
      const now = new Date().toISOString()
      const currentCampaign = editing ? campaignById.get(editing.campaignId) : undefined
      const matchingCampaign = currentCampaign ?? campaigns.find((campaign) =>
        campaign.year === year && campaign.name.trim() === name)
      const campaignId = matchingCampaign?.id ?? createUuidV4()
      const shipmentId = editing?.id ?? createUuidV4()
      if (!campaignId || !shipmentId) {
        setError('保存に必要なIDを作成できませんでした。入力内容は変更されていません。')
        return
      }
      const campaign: AnniversaryCampaign = {
        id: campaignId,
        year,
        name,
        completedAt: matchingCampaign?.completedAt ?? null,
        createdAt: matchingCampaign?.createdAt ?? now,
        updatedAt: now,
      }
      const shipment: AnniversaryShipment = {
        id: shipmentId,
        campaignId,
        fanboxPlan,
        destinationNumber,
        itemDescription,
        quantity,
        status,
        shippedAt: shippedAtText || null,
        memo,
        createdAt: editing?.createdAt ?? now,
        updatedAt: now,
      }
      const result = onSave(campaign, shipment, editing?.id ?? null)
      if (result) {
        setError(result)
        return
      }
      submittingRef.current = false
      close()
    } finally {
      submittingRef.current = false
      setIsSubmitting(false)
    }
  }

  const editingCampaign = editing ? campaignById.get(editing.campaignId) : undefined

  return <section className="inventory-section anniversary-panel">
    <div className="inventory-section-heading">
      <div>
        <h2>周年記念</h2>
        <p>FANBOX周年特典などを、個人情報を保存せず宛先番号で管理します。</p>
      </div>
      <button className="health-primary-button" type="button" onClick={() => open()}>
        <Gift aria-hidden="true" /> 周年記念を登録
      </button>
    </div>

    {rows.length === 0
      ? <div className="inventory-empty">
          <strong>周年記念の登録はまだありません</strong>
          <p>氏名や住所は保存せず、宛先番号だけで管理します。</p>
        </div>
      : <div className="anniversary-list">
          {rows.map(({ campaign, shipment }) =>
            <article className="anniversary-card" key={shipment.id}>
              <header>
                <div>
                  <span className="anniversary-year">{campaign.year}年</span>
                  <h3>{campaign.name}</h3>
                </div>
                <span className={`anniversary-status ${shipment.status}`}>
                  {statusLabel(shipment.status)}
                </span>
              </header>
              <dl>
                <div><dt>FANBOXプラン</dt><dd>{shipment.fanboxPlan || '未設定'}</dd></div>
                <div><dt>宛先番号</dt><dd>{shipment.destinationNumber}</dd></div>
                <div className="anniversary-wide"><dt>発送物</dt><dd>{shipment.itemDescription}</dd></div>
                <div><dt>数量</dt><dd>{shipment.quantity}個</dd></div>
                <div><dt>発送日</dt><dd>{shipment.shippedAt || '未設定'}</dd></div>
              </dl>
              {shipment.memo && <p className="anniversary-memo">{shipment.memo}</p>}
              <div className="inventory-row-actions">
                <button type="button" onClick={() => open(shipment)}>編集</button>
                <button type="button" className="inventory-danger-button" onClick={() => {
                  if (!window.confirm('この周年記念記録を削除しますか？通常在庫は変化しません。')) return
                  const result = onDelete(shipment.id)
                  if (result) window.alert(result)
                }}>削除</button>
              </div>
            </article>)}
        </div>}

    <dialog ref={dialogRef} className="inventory-dialog anniversary-dialog" onCancel={(event) => {
      event.preventDefault()
      close()
    }}>
      <form key={editing?.id ?? 'new-anniversary'} onSubmit={submit} noValidate>
        <header>
          <div><p className="eyebrow">Anniversary</p><h2>{editing ? '周年記念を編集' : '周年記念を登録'}</h2></div>
          <button type="button" aria-label="ダイアログを閉じる" onClick={close}>×</button>
        </header>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="inventory-form-grid">
          <label data-field-error={fieldErrors.year}>対象年
            <input name="year" type="text" inputMode="numeric" pattern="[0-9]{4}" autoComplete="off"
              maxLength={4} required defaultValue={editingCampaign?.year ?? new Date().getFullYear()} />
          </label>
          <label data-field-error={fieldErrors.name}>周年名
            <input name="name" maxLength={100} required defaultValue={editingCampaign?.name} />
          </label>
          <label>FANBOXプラン（任意）
            <input name="fanboxPlan" maxLength={100} defaultValue={editing?.fanboxPlan} />
          </label>
          <label data-field-error={fieldErrors.destinationNumber}>宛先番号
            <input name="destinationNumber" autoComplete="off" maxLength={100} required
              defaultValue={editing?.destinationNumber} />
          </label>
          <label className="inventory-wide" data-field-error={fieldErrors.itemDescription}>発送物
            <input name="itemDescription" maxLength={500} required defaultValue={editing?.itemDescription} />
          </label>
          <label data-field-error={fieldErrors.quantity}>数量
            <input name="quantity" type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off"
              required defaultValue={editing?.quantity ?? 1} />
          </label>
          <label>状態
            <select name="status" defaultValue={editing?.status ?? 'unprepared'}>
              {statusOptions.map((option) =>
                <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>発送日（任意）
            <input name="shippedAt" type="date" defaultValue={editing?.shippedAt ?? ''} />
          </label>
          <label className="inventory-wide">メモ（任意）
            <textarea name="memo" maxLength={500} defaultValue={editing?.memo} />
          </label>
        </div>
        <p className="anniversary-privacy-note">氏名・住所・電話番号・メールアドレスは入力しないでください。</p>
        <footer>
          <button type="button" onClick={close}>キャンセル</button>
          <button className="health-primary-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? '保存中…' : '保存'}
          </button>
        </footer>
      </form>
    </dialog>
  </section>
}
