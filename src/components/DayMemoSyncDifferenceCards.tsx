import { useState } from 'react'
import type { SyncDifferencePresentationItem } from '../utils/syncDifferencePresentation'

interface Props {
  items: SyncDifferencePresentationItem[] | null
  stopReason?: string | null
  onActionPrepared: (selection: SyncDifferenceActionSelection) => void
}

export type SyncDifferenceUiAction = {
  id: 'inspect' | 'adopt_remote' | 'upload_local' | 'discard_local' | 'hold' | 'safety_check'
  label: string
}

export type SyncDifferenceActionSelection = {
  date: string
  classification: string
  action: SyncDifferenceUiAction['id']
  currentTarget: string
}

const REMOTE_ONLY_ACTIONS: SyncDifferenceUiAction[] = [
  { id: 'adopt_remote', label: 'このiPhoneへ反映' },
  { id: 'hold', label: '今回は保留' },
]
const LOCAL_ONLY_ACTIONS: SyncDifferenceUiAction[] = [
  { id: 'upload_local', label: '同期先へ送る' },
  { id: 'discard_local', label: 'このiPhoneから削除' },
  { id: 'hold', label: '今回は保留' },
]
const BODY_MISMATCH_ACTIONS: SyncDifferenceUiAction[] = [
  { id: 'hold', label: '今回は保留' },
]
const SAFETY_ACTIONS: SyncDifferenceUiAction[] = [
  { id: 'hold', label: '今回は保留' },
]

function actionsFor(classification: string): SyncDifferenceUiAction[] {
  if (classification === 'local_only') return LOCAL_ONLY_ACTIONS
  if (classification === 'remote_only_active' || classification === 'remote_only_tombstone') return REMOTE_ONLY_ACTIONS
  if (classification === 'body_mismatch') return BODY_MISMATCH_ACTIONS
  return SAFETY_ACTIONS
}

function entryActionFor(classification: string): SyncDifferenceUiAction {
  if (classification === 'body_mismatch') return { id: 'inspect', label: '内容を比較' }
  if (classification === 'local_only' || classification === 'remote_only_active' || classification === 'remote_only_tombstone') {
    return { id: 'inspect', label: '内容を確認' }
  }
  return { id: 'safety_check', label: '安全状態を確認' }
}

export function DayMemoSyncDifferenceCards({ items, stopReason, onActionPrepared }: Props) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [selectedAction, setSelectedAction] = useState<SyncDifferenceUiAction | null>(null)
  const selectedItem = items?.find((item) => `${item.date}:${item.classification}` === selectedKey) ?? null

  return <section className="sync-difference-panel" aria-label="同期差異">
    <h5>同期差異</h5>
    {items === null ? <p>差異を確認してください</p>
      : items.length === 0 ? <p className="cloud-day-memo-success">差異はありません</p>
        : <>
          <p><strong>現在の差異：{items.length}件</strong></p>
          <ol className="sync-difference-list">
            {items.map((item) => <li key={`${item.date}:${item.classification}`} className="sync-difference-card">
              <strong>{item.title}</strong>
              <dl>
                <div><dt>対象</dt><dd>{item.date}</dd></div>
                <div><dt>種類</dt><dd>{item.typeLabel}</dd></div>
                <div><dt>次の操作</dt><dd>{item.nextAction}</dd></div>
              </dl>
              {(() => {
                const entryAction = entryActionFor(item.classification)
                return <button type="button" className="health-secondary-button cloud-sync-button"
                  aria-expanded={selectedItem === item} onClick={() => {
                    setSelectedKey(`${item.date}:${item.classification}`)
                    setSelectedAction(entryAction)
                  }}>{entryAction.label}</button>
              })()}
              {selectedItem === item ? <div className="sync-difference-action-picker" role="group"
                aria-label={`${item.date}の確認操作`}>
                <p><strong>確認対象</strong></p>
                <p>対象：{item.date}<br />種類：{item.typeLabel}</p>
                <p className="cloud-sync-note">ここでは操作候補の選択だけを行います。同期・反映・削除は実行しません。</p>
                <div className="sync-difference-action-buttons">
                  {actionsFor(item.classification).map((action) => <button key={action.id} type="button"
                    className="health-secondary-button cloud-sync-button" aria-pressed={selectedAction?.id === action.id}
                    onClick={() => {
                      setSelectedAction(action)
                      onActionPrepared({ date: item.date, classification: item.classification,
                        action: action.id, currentTarget: `${item.date}:${item.classification}` })
                    }}>{action.label}</button>)}
                </div>
                {selectedAction ? <p className="cloud-day-memo-success">選択中：{selectedAction.label}。この段階では実行していません。</p> : null}
                <button type="button" className="health-secondary-button cloud-sync-button" onClick={() => {
                  setSelectedKey(null)
                  setSelectedAction(null)
                }}>閉じる</button>
              </div> : null}
            </li>)}
          </ol>
        </>}
    {stopReason ? <p className="cloud-pairing-error" role="alert">停止理由：{stopReason}</p> : null}
  </section>
}
