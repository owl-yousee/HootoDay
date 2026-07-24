import { useEffect, useMemo, useRef, useState } from 'react'
import { Gift } from '@phosphor-icons/react'
import type {
  AnniversaryCampaign,
  AnniversaryShipment,
  AnniversaryShipmentStatus,
} from '../types/inventory'
import { createUuidV4 } from '../utils/uuid'

const fixedPlans = ['うさぎ', 'きのこ', 'ねこ'] as const
type FixedPlan = typeof fixedPlans[number]
type CampaignErrors = Partial<Record<'year' | 'name', string>>
type ShipmentErrors = Partial<Record<'destinationNumber' | 'itemDescription', string>>

type Props = {
  campaigns: AnniversaryCampaign[]
  shipments: AnniversaryShipment[]
  onSaveCampaign: (campaign: AnniversaryCampaign, expectedCampaignId?: string | null) => string | null
  onSaveShipment: (shipment: AnniversaryShipment, expectedShipmentId?: string | null) => string | null
  onDeleteShipment: (shipmentId: string) => string | null
  onDeleteCampaign: (campaignId: string) => string | null
  onEditingStateChange?: (editing: boolean) => void
}

const displayStatus = (status: AnniversaryShipmentStatus) => {
  if (status === 'unprepared') return '未着手'
  if (status === 'preparing') return '準備中'
  if (status === 'shipped') return '発送完了'
  return '発送待ち'
}
const statusGroup = (status: AnniversaryShipmentStatus) =>
  status === 'prepared' ? 'not_shipped' : status
const statusOrder = (status: AnniversaryShipmentStatus) =>
  status === 'unprepared' ? 0 : status === 'preparing' ? 1 :
    status === 'prepared' || status === 'not_shipped' ? 2 : 3

function PlanSummary({ plan, records, selected, onSelect }: {
  plan: FixedPlan
  records: AnniversaryShipment[]
  selected: boolean
  onSelect: () => void
}) {
  const count = (group: 'unprepared' | 'preparing' | 'not_shipped' | 'shipped') =>
    records.filter((record) => statusGroup(record.status) === group).length
  return <button type="button" className="anniversary-plan" aria-pressed={selected} onClick={onSelect}>
    <strong>{plan}</strong>
    <span>全 {records.length}</span>
    <small>未着手 {count('unprepared')}</small>
    <small>準備中 {count('preparing')}</small>
    <small>発送待ち {count('not_shipped')}</small>
    <small>発送完了 {count('shipped')}</small>
  </button>
}

export function AnniversaryManagementPanel(props: Props) {
  const onEditingStateChange = props.onEditingStateChange
  const campaignDialogRef = useRef<HTMLDialogElement>(null)
  const shipmentDialogRef = useRef<HTMLDialogElement>(null)
  const submittingRef = useRef(false)
  const lockedScrollYRef = useRef(0)
  const [selectedPlans, setSelectedPlans] = useState<Record<string, FixedPlan>>({})
  const [editingCampaign, setEditingCampaign] = useState<AnniversaryCampaign | null>(null)
  const [shipmentContext, setShipmentContext] = useState<{
    campaign: AnniversaryCampaign
    plan: string
    shipment: AnniversaryShipment | null
  } | null>(null)
  const [campaignOpen, setCampaignOpen] = useState(false)
  const [shipmentOpen, setShipmentOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [campaignErrors, setCampaignErrors] = useState<CampaignErrors>({})
  const [shipmentErrors, setShipmentErrors] = useState<ShipmentErrors>({})

  const sortedCampaigns = useMemo(() => [...props.campaigns].sort((a, b) =>
    b.year - a.year || b.updatedAt.localeCompare(a.updatedAt)), [props.campaigns])

  useEffect(() => () => onEditingStateChange?.(false), [onEditingStateChange])
  useEffect(() => {
    const open = campaignOpen || shipmentOpen
    if (!open) return
    const dialog = campaignOpen ? campaignDialogRef.current : shipmentDialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    const body = document.body
    const root = document.documentElement
    const previous = {
      bodyPosition: body.style.position, bodyTop: body.style.top,
      bodyWidth: body.style.width, bodyOverflow: body.style.overflow,
      rootOverflow: root.style.overflow, rootOverscroll: root.style.overscrollBehavior,
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
  }, [campaignOpen, shipmentOpen])

  const beginEditing = () => onEditingStateChange?.(true)
  const endEditing = () => onEditingStateChange?.(false)
  const openCampaign = (campaign: AnniversaryCampaign | null) => {
    setEditingCampaign(campaign)
    setCampaignErrors({})
    setError('')
    setCampaignOpen(true)
    beginEditing()
  }
  const closeCampaign = () => {
    if (submittingRef.current) return
    campaignDialogRef.current?.close()
    setCampaignOpen(false)
    setEditingCampaign(null)
    setCampaignErrors({})
    setError('')
    endEditing()
  }
  const openShipment = (campaign: AnniversaryCampaign, plan: string, shipment: AnniversaryShipment | null = null) => {
    setShipmentContext({ campaign, plan, shipment })
    setShipmentErrors({})
    setError('')
    setShipmentOpen(true)
    beginEditing()
  }
  const closeShipment = () => {
    if (submittingRef.current) return
    shipmentDialogRef.current?.close()
    setShipmentOpen(false)
    setShipmentContext(null)
    setShipmentErrors({})
    setError('')
    endEditing()
  }

  const submitCampaign = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submittingRef.current) return
    const form = new FormData(event.currentTarget)
    const yearText = String(form.get('year') ?? '').trim()
    const year = Number(yearText)
    const name = String(form.get('name') ?? '').trim()
    const errors: CampaignErrors = {}
    if (!/^\d{4}$/.test(yearText) || !Number.isInteger(year) || year < 1900 || year > 9999) {
      errors.year = '対象年は1900〜9999の4桁で入力してください。'
    }
    if (!name) errors.name = '周年名を入力してください。'
    if (Object.keys(errors).length) {
      setCampaignErrors(errors)
      setError('入力内容を確認してください。')
      return
    }
    const id = editingCampaign?.id ?? createUuidV4()
    if (!id) {
      setError('保存に必要なIDを作成できませんでした。入力内容は変更されていません。')
      return
    }
    submittingRef.current = true
    setIsSubmitting(true)
    const now = new Date().toISOString()
    const result = props.onSaveCampaign({
      id, year, name,
      completedAt: editingCampaign?.completedAt ?? null,
      createdAt: editingCampaign?.createdAt ?? now,
      updatedAt: now,
    }, editingCampaign?.id ?? null)
    submittingRef.current = false
    setIsSubmitting(false)
    if (result) {
      setError(result)
      return
    }
    closeCampaign()
  }

  const submitShipment = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submittingRef.current || !shipmentContext) return
    const form = new FormData(event.currentTarget)
    const destinationNumber = String(form.get('destinationNumber') ?? '').trim()
    const itemDescription = String(form.get('itemDescription') ?? '').trim()
    const status = String(form.get('status') ?? '') as AnniversaryShipmentStatus
    const shippedAt = String(form.get('shippedAt') ?? '').trim() || null
    const memo = String(form.get('memo') ?? '').trim()
    const errors: ShipmentErrors = {}
    if (!destinationNumber) errors.destinationNumber = '宛先番号を入力してください。'
    if (!itemDescription) errors.itemDescription = '内容物を入力してください。'
    const allowedStatuses: AnniversaryShipmentStatus[] = ['unprepared', 'preparing', 'not_shipped', 'shipped']
    if (shipmentContext.shipment?.status === 'prepared') allowedStatuses.push('prepared')
    if (!allowedStatuses.includes(status)) {
      setError('状態を選択してください。')
      return
    }
    if (Object.keys(errors).length) {
      setShipmentErrors(errors)
      setError('入力内容を確認してください。')
      return
    }
    const id = shipmentContext.shipment?.id ?? createUuidV4()
    if (!id) {
      setError('保存に必要なIDを作成できませんでした。入力内容は変更されていません。')
      return
    }
    submittingRef.current = true
    setIsSubmitting(true)
    const now = new Date().toISOString()
    const result = props.onSaveShipment({
      id,
      campaignId: shipmentContext.campaign.id,
      fanboxPlan: shipmentContext.shipment?.fanboxPlan ?? shipmentContext.plan,
      destinationNumber,
      itemDescription,
      quantity: shipmentContext.shipment?.quantity ?? 1,
      status,
      shippedAt,
      memo,
      createdAt: shipmentContext.shipment?.createdAt ?? now,
      updatedAt: now,
    }, shipmentContext.shipment?.id ?? null)
    submittingRef.current = false
    setIsSubmitting(false)
    if (result) {
      setError(result)
      return
    }
    closeShipment()
  }

  return <section className="anniversary-panel">
    <div className="inventory-section anniversary-create-card">
      <div className="inventory-section-heading">
        <div><h2>周年記念</h2><p>年単位の周年記念と、プラン別の発送状況を管理します。</p></div>
        <button className="health-primary-button anniversary-create-button" type="button" onClick={() => openCampaign(null)}>
          <Gift aria-hidden="true" /> 新しい周年記念を作成
        </button>
      </div>
    </div>

    {sortedCampaigns.length === 0
      ? <div className="inventory-empty">
          <strong>周年記念の登録はまだありません</strong>
          <p>周年記念を作成すると、うさぎ・きのこ・ねこの3プランが表示されます。</p>
        </div>
      : <div className="anniversary-campaign-list">
          {sortedCampaigns.map((campaign) => {
            const campaignShipments = props.shipments.filter((record) => record.campaignId === campaign.id)
            const selectedPlan = selectedPlans[campaign.id] ?? 'うさぎ'
            const selectedRecords = campaignShipments
              .filter((record) => record.fanboxPlan === selectedPlan)
              .sort((a, b) => statusOrder(a.status) - statusOrder(b.status) ||
                a.destinationNumber.localeCompare(b.destinationNumber, 'ja', { numeric: true }))
            const legacyRecords = campaignShipments
              .filter((record) => !fixedPlans.includes(record.fanboxPlan as FixedPlan))
              .sort((a, b) => statusOrder(a.status) - statusOrder(b.status) ||
                a.destinationNumber.localeCompare(b.destinationNumber, 'ja', { numeric: true }))
            const shippedCount = campaignShipments.filter((record) => record.status === 'shipped').length
            return <article className="anniversary-campaign" key={campaign.id}>
              <header className="anniversary-campaign-heading">
                <div>
                  <span className="anniversary-year">{campaign.year}年</span>
                  <h3>{campaign.name}</h3>
                  <p>全{campaignShipments.length}件／発送完了{shippedCount}件</p>
                </div>
                <div className="inventory-row-actions">
                  <button type="button" onClick={() => openCampaign(campaign)}>周年記念を編集</button>
                  <button type="button" className="inventory-danger-button" onClick={() => {
                    if (!window.confirm(`${campaign.year}年「${campaign.name}」を削除しますか？\n配下の発送記録${campaignShipments.length}件もすべて削除されます。`)) return
                    const result = props.onDeleteCampaign(campaign.id)
                    if (result) window.alert(result)
                  }}>周年記念を削除</button>
                </div>
              </header>

              <div className="anniversary-plans" aria-label={`${campaign.name}のプラン`}>
                {fixedPlans.map((plan) =>
                  <PlanSummary key={plan} plan={plan}
                    records={campaignShipments.filter((record) => record.fanboxPlan === plan)}
                    selected={selectedPlan === plan}
                    onSelect={() => setSelectedPlans((current) => ({ ...current, [campaign.id]: plan }))} />)}
              </div>

              <section className="anniversary-selected-plan">
                <div className="anniversary-selected-plan-heading">
                  <h4>{selectedPlan}プラン</h4>
                  <button className="health-primary-button" type="button"
                    onClick={() => openShipment(campaign, selectedPlan)}>＋ {selectedPlan}へ追加</button>
                </div>
                {selectedRecords.length === 0
                  ? <p className="anniversary-plan-empty">このプランの発送記録はありません。</p>
                  : <div className="anniversary-shipment-list">
                      {selectedRecords.map((shipment) =>
                        <ShipmentCard key={shipment.id} shipment={shipment}
                          onEdit={() => openShipment(campaign, selectedPlan, shipment)}
                          onDelete={() => {
                            if (!window.confirm(`宛先番号「${shipment.destinationNumber}」の発送記録を削除しますか？`)) return
                            const result = props.onDeleteShipment(shipment.id)
                            if (result) window.alert(result)
                          }} />)}
                    </div>}
              </section>

              {legacyRecords.length > 0 && <section className="anniversary-legacy">
                <h4>その他の既存プラン</h4>
                <p>既存データを変更せず表示しています。編集してもプラン名と数量は維持されます。</p>
                <div className="anniversary-shipment-list">
                  {legacyRecords.map((shipment) =>
                    <ShipmentCard key={shipment.id} shipment={shipment} showPlan
                      onEdit={() => openShipment(campaign, shipment.fanboxPlan, shipment)}
                      onDelete={() => {
                        if (!window.confirm(`宛先番号「${shipment.destinationNumber}」の発送記録を削除しますか？`)) return
                        const result = props.onDeleteShipment(shipment.id)
                        if (result) window.alert(result)
                      }} />)}
                </div>
              </section>}
            </article>
          })}
        </div>}

    <dialog ref={campaignDialogRef} className="inventory-dialog anniversary-dialog" onCancel={(event) => {
      event.preventDefault()
      closeCampaign()
    }}>
      <form key={editingCampaign?.id ?? 'new-campaign'} onSubmit={submitCampaign} noValidate>
        <header><div><p className="eyebrow">Anniversary</p><h2>{editingCampaign ? '周年記念を編集' : '周年記念を作成'}</h2></div>
          <button type="button" aria-label="ダイアログを閉じる" onClick={closeCampaign}>×</button></header>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="inventory-form-grid">
          <label data-field-error={campaignErrors.year}>対象年
            <input name="year" type="text" inputMode="numeric" pattern="[0-9]{4}" autoComplete="off"
              maxLength={4} required defaultValue={editingCampaign?.year ?? new Date().getFullYear()} />
          </label>
          <label data-field-error={campaignErrors.name}>周年名
            <input name="name" maxLength={100} required defaultValue={editingCampaign?.name} />
          </label>
        </div>
        <footer><button type="button" onClick={closeCampaign}>キャンセル</button>
          <button className="health-primary-button" type="submit" disabled={isSubmitting}>{isSubmitting ? '保存中…' : '保存'}</button></footer>
      </form>
    </dialog>

    <dialog ref={shipmentDialogRef} className="inventory-dialog anniversary-dialog" onCancel={(event) => {
      event.preventDefault()
      closeShipment()
    }}>
      <form key={shipmentContext?.shipment?.id ?? `${shipmentContext?.campaign.id}:${shipmentContext?.plan}`} onSubmit={submitShipment} noValidate>
        <header><div><p className="eyebrow">{shipmentContext?.plan}プラン</p>
          <h2>{shipmentContext?.shipment ? '発送記録を編集' : '発送記録を追加'}</h2></div>
          <button type="button" aria-label="ダイアログを閉じる" onClick={closeShipment}>×</button></header>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="inventory-form-grid">
          <label data-field-error={shipmentErrors.destinationNumber}>宛先番号
            <input name="destinationNumber" autoComplete="off" maxLength={100} required
              defaultValue={shipmentContext?.shipment?.destinationNumber} />
          </label>
          <label className="inventory-wide" data-field-error={shipmentErrors.itemDescription}>内容物
            <input name="itemDescription" maxLength={500} required
              defaultValue={shipmentContext?.shipment?.itemDescription} />
          </label>
          <label>状態
            <select name="status" defaultValue={shipmentContext?.shipment?.status ?? 'unprepared'}>
              <option value="unprepared">未着手</option>
              <option value="preparing">準備中</option>
              {shipmentContext?.shipment?.status === 'prepared' &&
                <option value="prepared">発送待ち（旧状態を維持）</option>}
              <option value="not_shipped">発送待ち</option>
              <option value="shipped">発送完了</option>
            </select>
          </label>
          <label>発送日（任意）
            <input name="shippedAt" type="date" defaultValue={shipmentContext?.shipment?.shippedAt ?? ''} />
          </label>
          <label className="inventory-wide">メモ（任意）
            <textarea name="memo" maxLength={500} defaultValue={shipmentContext?.shipment?.memo} />
          </label>
        </div>
        {shipmentContext?.shipment && shipmentContext.shipment.quantity !== 1 &&
          <p className="anniversary-compatibility-note">既存数量：{shipmentContext.shipment.quantity}。互換性のため、この編集では変更しません。</p>}
        <footer><button type="button" onClick={closeShipment}>キャンセル</button>
          <button className="health-primary-button" type="submit" disabled={isSubmitting}>{isSubmitting ? '保存中…' : '保存'}</button></footer>
      </form>
    </dialog>
  </section>
}

function ShipmentCard({ shipment, showPlan = false, onEdit, onDelete }: {
  shipment: AnniversaryShipment
  showPlan?: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  return <article className="anniversary-shipment-card">
    <span className={`anniversary-status ${statusGroup(shipment.status)}`}>{displayStatus(shipment.status)}</span>
    {showPlan && <strong className="anniversary-legacy-plan">{shipment.fanboxPlan}</strong>}
    <dl>
      <div><dt>宛先番号</dt><dd>{shipment.destinationNumber}</dd></div>
      <div><dt>内容物</dt><dd>{shipment.itemDescription}</dd></div>
      <div><dt>発送日</dt><dd>{shipment.shippedAt || '未設定'}</dd></div>
    </dl>
    {shipment.quantity !== 1 && <small className="anniversary-legacy-quantity">既存数量 {shipment.quantity}</small>}
    {shipment.memo && <p className="anniversary-memo">{shipment.memo}</p>}
    <div className="inventory-row-actions">
      <button type="button" onClick={onEdit}>編集</button>
      <button type="button" className="inventory-danger-button" onClick={onDelete}>削除</button>
    </div>
  </article>
}
