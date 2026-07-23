import type { useDayMemoNormalBodyMismatchCandidate } from '../hooks/useDayMemoNormalBodyMismatchCandidate'

interface Props {
  candidate: ReturnType<typeof useDayMemoNormalBodyMismatchCandidate>
  disabled?: boolean
}

export function DayMemoBodyMismatchComparison({ candidate, disabled = false }: Props) {
  if (!candidate.eligible) return null
  return (
    <div className="cloud-day-memo-baseline-panel" role="region" aria-labelledby="day-memo-body-mismatch-heading">
      <h4 id="day-memo-body-mismatch-heading">本文相違の比較と採用候補</h4>
      <p>本文相違の日付を1件だけ選び、明示操作でlocalとremoteを読み取り専用比較します。候補確定は採用実行ではありません。</p>
      <fieldset disabled={candidate.checking || disabled}>
        <legend>比較する日付</legend>
        {candidate.bodyMismatchDates.map((date) => (
          <label key={date}><input type="radio" name="day-memo-body-mismatch-date" value={date}
            checked={candidate.selectedDate === date} onChange={() => candidate.setSelectedDate(date)} /> {date}</label>
        ))}
      </fieldset>
      <button type="button" className="health-secondary-button cloud-sync-button"
        disabled={!candidate.selectedDate || candidate.checking || disabled} onClick={() => { void candidate.compare() }}>
        {candidate.checking ? 'local／remoteを確認中…' : 'local／remote内容を比較'}
      </button>
      {candidate.comparison ? (
        <div role="dialog" aria-modal="false" aria-labelledby="day-memo-body-mismatch-comparison-heading">
          <h5 id="day-memo-body-mismatch-comparison-heading">{candidate.comparison.date} の本文比較</h5>
          <p>この比較画面はread-onlyです。localとremoteの本文は異なり、自動結合しません。</p>
          <label>local本文<textarea readOnly rows={8} value={candidate.comparison.localContent} /></label>
          <p>local更新日時：{new Date(candidate.comparison.localUpdatedAt).toLocaleString('ja-JP')}／文字数：{candidate.comparison.localCharacterCount}</p>
          <label>remote本文<textarea readOnly rows={8} value={candidate.comparison.remoteContent} /></label>
          <p>remote更新日時：{new Date(candidate.comparison.remoteUpdatedAt).toLocaleString('ja-JP')}／文字数：{candidate.comparison.remoteCharacterCount}</p>
          <p>remote revision／change sequence：{candidate.comparison.remoteRevision}／{candidate.comparison.remoteChangeSequence}（検証済み）</p>
          <label><input type="radio" name="day-memo-body-mismatch-choice" checked={candidate.choice === 'local'} onChange={() => candidate.setChoice('local')} /> localを採用候補にする</label>
          <label><input type="radio" name="day-memo-body-mismatch-choice" checked={candidate.choice === 'remote'} onChange={() => candidate.setChoice('remote')} /> remoteを採用候補にする</label>
          <button type="button" className="health-secondary-button cloud-sync-button" disabled={!candidate.choice || disabled}
            onClick={() => { candidate.confirmCandidate() }}>この候補を確定</button>
        </div>
      ) : null}
      {candidate.result ? (
        <div role="status">
          <p><strong>safety分類：{candidate.result.safety}</strong></p>
          <ul className="cloud-day-memo-preview-summary">
            <li>対象日：{candidate.result.date ?? '確認不能'}</li>
            <li>採用候補：{candidate.result.candidate === 'local' ? 'local' : candidate.result.candidate === 'remote' ? 'remote' : '未確定'}</li>
            <li>local／remote確認：{candidate.result.localAndRemoteVerified ? '確認済み' : '未確認'}</li>
            <li>永続変更：なし</li><li>RPC送信：なし</li>
            <li>確認日時：{new Date(candidate.result.checkedAt).toLocaleString('ja-JP')}</li>
            <li>停止段階：{candidate.result.stopStage}</li>
            <li>failureReason：{candidate.result.failureReason ?? 'なし'}</li>
            <li>Saved Recovery State：{candidate.result.diagnostics.savedStateConfirmed ? '確認済み' : '未確認'}</li>
            <li>metadata：{candidate.result.diagnostics.metadataValid ? '確認済み' : '未確認／不一致'}</li>
            <li>workspace：{candidate.result.diagnostics.workspaceMatched ? '一致' : '未確認／不一致'}</li>
            <li>local snapshot：{candidate.result.diagnostics.localSnapshotMatched ? '一致' : '未確認／不一致'}</li>
            <li>full pull：{candidate.result.diagnostics.fullPullSucceeded ? '完了' : '未完了'}</li>
            <li>cursor：{candidate.result.diagnostics.cursorMatched ? '一致' : '未確認／不一致'}</li>
            <li>remote／baseline：{candidate.result.diagnostics.remoteBaselineMatched ? '一致' : '未確認／不一致'}</li>
            <li>body mismatch再分類：{candidate.result.diagnostics.bodyMismatchConfirmed ? '確認済み' : '未確認'}</li>
            <li>snapshot revision：{candidate.result.diagnostics.snapshotRevision ?? '未生成'}</li>
          </ul>
          <p>{candidate.result.nextAction}</p>
        </div>
      ) : null}
      <button type="button" className="health-secondary-button cloud-sync-button" disabled={disabled} onClick={candidate.discard}>比較・候補結果を破棄</button>
    </div>
  )
}
