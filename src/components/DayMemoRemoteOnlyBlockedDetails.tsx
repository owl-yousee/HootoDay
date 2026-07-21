import type { RecoveryRemoteOnlyResult } from '../hooks/useDayMemoRecoveryRemoteOnlyAdoption'

interface Props {
  result: RecoveryRemoteOnlyResult
  stopReason: string
}

function remoteCheckLabel(safety: string) {
  if (safety === 'remote_only_candidate_start_prerequisite_invalid'
    || safety === 'remote_only_candidate_prerequisite_changed') return 'remote確認前に安全停止'
  if (safety === 'remote_only_candidate_pull_or_state_invalid') return '完全なremote状態を確認できませんでした'
  if (safety === 'remote_only_candidate_tombstone') return '同期先は削除済み状態です'
  if (safety === 'remote_only_candidate_invalid_remote') return 'active recordとして検証できませんでした'
  if (safety === 'remote_only_candidate_other_difference_changed') return '対象外を含むremote差異が確認時点と一致しません'
  if (safety === 'remote_only_candidate_unexpected_failure') return 'remote確認結果を確定できませんでした'
  return '安全なremote状態を確認できませんでした'
}

function baselineCheckLabel(safety: string) {
  if (safety === 'remote_only_candidate_start_prerequisite_invalid') return '開始条件を確認できませんでした'
  if (safety === 'remote_only_candidate_prerequisite_changed') return 'metadataまたはbaselineの不変を確認できませんでした'
  if (safety === 'remote_only_candidate_pull_or_state_invalid') return 'cursor・baselineを含む状態確認が未完了です'
  if (safety === 'remote_only_candidate_other_difference_changed') return '未解決差異とbaselineの対応を確認できませんでした'
  return 'baseline確認は完了していません'
}

function localStateLabel(state: RecoveryRemoteOnlyResult['localState']) {
  if (state === 'saved') return '保存済み・同期情報未確定'
  if (state === 'rolled_back') return '元の状態へ復元済み'
  if (state === 'uncertain') return '確認が必要'
  return '変更なし'
}

export function DayMemoRemoteOnlyBlockedDetails({ result, stopReason }: Props) {
  return <div className="cloud-day-memo-preview-result is-blocked">
    <h6>安全停止の詳細</h6>
    <ul className="cloud-day-memo-preview-summary">
      <li>対象日：{result.date ?? '未確認'}</li>
      <li>stop理由分類：{result.stage}</li>
      <li>safety分類：{result.safety}</li>
      <li>永続変更：{result.persistentChanged ? 'あり・確認が必要' : 'なし'}</li>
      <li>local状態：{localStateLabel(result.localState)}</li>
      <li>remote状態確認結果：{remoteCheckLabel(result.safety)}</li>
      <li>baseline確認結果：{baselineCheckLabel(result.safety)}</li>
    </ul>
    <p className="cloud-pairing-error">停止理由：{stopReason}</p>
  </div>
}
