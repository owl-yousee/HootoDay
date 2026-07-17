import { NotebookIcon } from '@phosphor-icons/react/Notebook'

export function RecordsPlaceholder() {
  return (
    <section className="records-placeholder" aria-labelledby="records-placeholder-title">
      <span className="records-placeholder-icon" aria-hidden="true">
        <NotebookIcon size={30} weight="regular" />
      </span>
      <div>
        <p className="eyebrow">Records</p>
        <h1 id="records-placeholder-title">記録を見る</h1>
        <p>記録を横断して振り返る画面は準備中です。</p>
      </div>
    </section>
  )
}
