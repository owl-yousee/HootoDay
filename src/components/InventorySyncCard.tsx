import type { useInventorySync } from '../hooks/useInventorySync'

type Props = {
  sync: ReturnType<typeof useInventorySync>
}

export function InventorySyncCard({ sync }: Props) {
  const { ui } = sync
  const busy = ui.status === 'checking' || ui.status === 'working'
  const action = (() => {
    switch (ui.status) {
      case 'initial_upload_ready':
        return {
          label: 'このPCのデータを最初に送信',
          run: () => window.confirm('このPCの販売・在庫データを同期先の最初の正本として送信しますか？') && sync.initialUpload(),
        }
      case 'initial_download_ready':
        return {
          label: 'PCのデータをこの端末へ取り込む',
          run: () => window.confirm('この端末の空の販売・在庫データを、PCのデータで置き換えますか？') && sync.initialDownload(),
        }
      case 'local_changed': return { label: 'この端末の変更を送信', run: sync.push }
      case 'remote_changed':
        return {
          label: '同期先の変更を取り込む',
          run: () => window.confirm('この端末の販売・在庫データを同期先の最新版で置き換えますか？') && sync.pull(),
        }
      case 'pending_resend_ready':
        return {
          label: '同じ操作を再送',
          run: () => window.confirm('前回と同じ操作IDで再送しますか？') && sync.resend(),
        }
      case 'pending_check': return { label: '送信結果を確認', run: sync.check }
      case 'conflict': return { label: '差異を再確認', run: sync.check }
      case 'attention': return { label: '同期状態を再確認', run: sync.check }
      default: return { label: '販売・在庫の同期状態を確認', run: sync.check }
    }
  })()
  return (
    <section className={`inventory-sync-card inventory-sync-${ui.status}`} aria-live="polite">
      <div>
        <h2>販売・在庫の同期</h2>
        <p>{ui.message}</p>
      </div>
      <dl>
        <div><dt>状態</dt><dd>{ui.status}</dd></div>
        <div><dt>同期先revision</dt><dd>{ui.remoteRevision ?? '未確認'}</dd></div>
        <div><dt>最終確認</dt><dd>{ui.lastCheckedAt ? new Date(ui.lastCheckedAt).toLocaleString('ja-JP') : '未確認'}</dd></div>
      </dl>
      {ui.conflictSummary && (
        <p className="inventory-sync-detail">
          端末のみ {ui.conflictSummary.localOnly}件 / 同期先のみ {ui.conflictSummary.remoteOnly}件 /
          同内容 {ui.conflictSummary.bothSame}件 / 競合 {ui.conflictSummary.conflicts}件
        </p>
      )}
      {ui.recoveryRequired && <p className="inventory-sync-warning">自動処理を停止しました。バックアップと保存状態を確認してください。</p>}
      <button type="button" className="health-primary-button" disabled={busy} onClick={action.run}>
        {busy ? '確認中…' : action.label}
      </button>
      <small>自動送信・自動取込・自動retryは行いません。</small>
    </section>
  )
}
