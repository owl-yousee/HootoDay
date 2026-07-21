import type { SyncDifferencePresentationItem } from '../utils/syncDifferencePresentation'

interface Props {
  items: SyncDifferencePresentationItem[] | null
  stopReason?: string | null
}

export function DayMemoSyncDifferenceCards({ items, stopReason }: Props) {
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
            </li>)}
          </ol>
        </>}
    {stopReason ? <p className="cloud-pairing-error" role="alert">停止理由：{stopReason}</p> : null}
  </section>
}
