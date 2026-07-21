import { useMemo, useState } from 'react'
import type { DayMemoSyncMetadataV5 } from '../types/dayMemoSync'
import type { useDayMemoSavedRecoveryStateCheck } from '../hooks/useDayMemoSavedRecoveryStateCheck'
import type { useDayMemoNormalDifferenceRecoveryCheckpointCheck } from '../hooks/useDayMemoNormalDifferenceRecoveryCheckpointCheck'
import type { useDayMemoNormalBodyMismatchCandidate } from '../hooks/useDayMemoNormalBodyMismatchCandidate'
import type { useDayMemoNormalBodyMismatchLocalPreparation } from '../hooks/useDayMemoNormalBodyMismatchLocalPreparation'
import type { useDayMemoBodyMismatchRemoteAdoption } from '../hooks/useDayMemoBodyMismatchRemoteAdoption'
import type { useDayMemoRecoveryLocalOnlyPreparation } from '../hooks/useDayMemoRecoveryLocalOnlyPreparation'
import type { useDayMemoRecoveryLocalOnlyDiscard } from '../hooks/useDayMemoRecoveryLocalOnlyDiscard'
import type { useDayMemoRecoveryRemoteOnlyAdoption } from '../hooks/useDayMemoRecoveryRemoteOnlyAdoption'

type Props = {
  metadata: DayMemoSyncMetadataV5
  saved: ReturnType<typeof useDayMemoSavedRecoveryStateCheck>
  checkpoint: ReturnType<typeof useDayMemoNormalDifferenceRecoveryCheckpointCheck>
  bodyCandidate: ReturnType<typeof useDayMemoNormalBodyMismatchCandidate>
  bodyLocalPreparation: ReturnType<typeof useDayMemoNormalBodyMismatchLocalPreparation>
  bodyRemoteAdoption: ReturnType<typeof useDayMemoBodyMismatchRemoteAdoption>
  localOnly: ReturnType<typeof useDayMemoRecoveryLocalOnlyPreparation>
  localOnlyDiscard: ReturnType<typeof useDayMemoRecoveryLocalOnlyDiscard>
  remoteOnly: ReturnType<typeof useDayMemoRecoveryRemoteOnlyAdoption>
}

const labels: Record<string, string> = {
  body_mismatch: 'このiPhoneと同期先で内容が異なります',
  local_only: 'このiPhoneにだけデータがあります',
  remote_only_active: '同期先にだけデータがあります',
  remote_only_tombstone: '同期先では削除されています',
  exact_match_baseline_missing: '内容は一致しています。同期情報の確認が必要です',
}

const savedStateMessages: Record<string, string> = {
  normal_difference_checkpoint_saved_state_prerequisite_missing: '保存状態を確認する前提が整っていません。',
  normal_difference_checkpoint_saved_state_metadata_invalid: '同期情報を安全に読み取れませんでした。',
  normal_difference_checkpoint_saved_state_pending_remaining: '未完了の同期操作が残っています。',
  normal_difference_checkpoint_saved_state_workspace_mismatch: '同期先との接続状態を確認できませんでした。',
  normal_difference_checkpoint_saved_state_pull_failed: '同期先の状態を確認できませんでした。',
  normal_difference_checkpoint_saved_state_pull_malformed: '同期先の状態を完全に確認できませんでした。',
  normal_difference_checkpoint_saved_state_cursor_mismatch: '保存済みの同期位置と同期先の状態が一致しません。',
  normal_difference_checkpoint_saved_state_baseline_mismatch: '保存済みの同期基準を安全に確認できませんでした。',
  normal_difference_checkpoint_saved_state_unresolved_rebuild_failed: '未解決差異の一覧を安全に再構築できませんでした。',
  normal_difference_checkpoint_saved_state_push_blocked: '同期送信が停止されているため、先へ進めません。',
  normal_difference_checkpoint_saved_state_intent_conflict: '未完了の削除候補が残っています。',
  normal_difference_checkpoint_saved_state_state_changed: '確認中に端末の状態が変わりました。',
  normal_difference_checkpoint_saved_state_unknown: '保存状態を安全に判定できませんでした。',
}

const remoteAdoptionMessages: Record<string, string> = {
  body_mismatch_remote_source_changed: '確認後に同期情報または端末データが変わりました。',
  body_mismatch_remote_target_changed: '対象日の状態が確認時点から変わりました。',
  body_mismatch_remote_backup_failed: '反映前バックアップを安全に保存できませんでした。',
  body_mismatch_remote_backup_rollback_failed: '反映前バックアップの復元を確認できませんでした。',
  body_mismatch_remote_local_save_failed: 'iPhoneへの保存に失敗しました。元の内容は維持されています。',
  body_mismatch_remote_readback_failed: '保存結果を確認できなかったため、元の内容へ戻しました。',
  body_mismatch_remote_rollback_failed: '保存またはrollbackの結果を確認できません。自動で再実行しないでください。',
  body_mismatch_remote_unexpected_failure: '反映処理を完了できませんでした。保存状態から再確認してください。',
}

const remoteOnlyMessages: Record<string, string> = {
  remote_only_candidate_start_prerequisite_invalid: '現在の対象日または開始条件を確認できませんでした。',
  remote_only_candidate_prerequisite_changed: '保存状態、workspace、または対象日の状態が変化しました。',
  remote_only_candidate_pull_or_state_invalid: '同期先の完全な確認結果または現在の保存状態を確認できませんでした。',
  remote_only_candidate_tombstone: '対象日は同期先で削除済みになっています。',
  remote_only_candidate_invalid_remote: '対象日の同期先データをactive recordとして検証できませんでした。',
  remote_only_candidate_other_difference_changed: '対象外を含む未解決差異が確認時点から変化しました。',
  remote_only_candidate_unexpected_failure: '対象データの確認中に処理を完了できませんでした。',
}

export function DayMemoSyncGuide({ metadata, saved, checkpoint, bodyCandidate, bodyLocalPreparation,
  bodyRemoteAdoption, localOnly, localOnlyDiscard, remoteOnly }: Props) {
  const [selectedDate, setSelectedDate] = useState('')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'fallback'>('idle')
  const [copyText, setCopyText] = useState('')
  const items = useMemo(() => Object.entries(saved.result?.unresolvedClassifications ?? {}), [saved.result])
  const recommended = saved.result?.nextRecommendedDate ?? items[0]?.[0] ?? ''
  const activeDate = items.some(([date]) => date === selectedDate) ? selectedDate : recommended
  const activeClassification = items.find(([date]) => date === activeDate)?.[1] ?? null
  const index = items.findIndex(([date]) => date === activeDate)
  const checkpointReady = checkpoint.result?.safety === 'normal_difference_checkpoint_unresolved_ready'
  const comparisonCurrent = bodyCandidate.comparison?.date === activeDate
  const candidateCurrent = bodyCandidate.result?.date === activeDate
    && ['normal_body_mismatch_candidate_local', 'normal_body_mismatch_candidate_remote'].includes(bodyCandidate.result.safety)
  const remoteCurrent = bodyRemoteAdoption.result?.date === activeDate
  const remoteBlocked = remoteCurrent && bodyRemoteAdoption.stage === 'blocked'
  const remoteOnlyCurrent = remoteOnly.result?.date === activeDate
  const remaining = remoteOnlyCurrent ? remoteOnly.result?.unresolvedCount ?? items.length
    : bodyRemoteAdoption.result?.remainingCount ?? saved.result?.unresolvedCount ?? items.length
  const localDiscardCurrent = localOnlyDiscard.result?.date === activeDate

  const savedReady = saved.result?.safety === 'normal_difference_checkpoint_saved_state_ready'
  const currentStage = remoteOnlyCurrent ? `同期先のみデータ：${remoteOnly.stage}`
    : localDiscardCurrent && localOnlyDiscard.result?.safety === 'recovery_local_only_discarded'
    ? 'このiPhoneから削除完了'
    : !saved.result ? '保存状態の確認'
    : !savedReady ? '保存状態の安全停止'
      : !activeDate || !activeClassification ? '差異なし'
        : activeClassification !== 'body_mismatch' ? '差異1件の確認'
          : !checkpointReady ? '本文比較の準備確認'
            : remoteBlocked ? 'remote候補の安全停止'
              : remoteCurrent && bodyRemoteAdoption.stage === 'local_saved' ? 'iPhoneへの反映完了'
                : remoteCurrent && bodyRemoteAdoption.stage === 'metadata_ready' ? '同期情報の保存待ち'
                  : remoteCurrent && bodyRemoteAdoption.stage === 'completed' ? '反映完了'
                    : !comparisonCurrent ? '本文比較の対象選択'
                      : !candidateCurrent ? 'local／remote比較と候補選択'
                        : bodyCandidate.result?.candidate === 'local' ? 'local候補の送信準備'
                          : 'remote候補の明示反映'
  const currentProblem = remoteOnlyCurrent && (remoteOnly.stage === 'blocked' || remoteOnly.stage === 'failed')
    ? remoteOnlyMessages[remoteOnly.result?.safety ?? '']
      ?? remoteOnly.safeErrorMessage ?? '対象データの確認を安全に完了できませんでした。'
    : localDiscardCurrent && localOnlyDiscard.result
    ? localOnlyDiscard.result.safety === 'recovery_local_only_discarded'
      ? 'このiPhoneだけにあったデータを削除しました。同期先は変更していません。'
      : 'このiPhoneからの削除を安全に完了できませんでした。'
    : remoteBlocked && bodyRemoteAdoption.result
    ? remoteAdoptionMessages[bodyRemoteAdoption.result.safety] ?? 'iPhoneへの反映を安全に完了できませんでした。'
    : activeClassification
    ? labels[activeClassification] ?? '安全な確認が必要です'
    : saved.result && !savedReady
      ? savedStateMessages[saved.result.safety] ?? '保存状態を安全に確認できませんでした。'
      : savedReady ? '差異はありません' : '未解決差異の一覧はまだ準備されていません'
  const nextOperation = remoteOnlyCurrent
    ? remoteOnly.stage === 'candidate_ready' ? '対象1件をこのiPhoneへ反映'
      : remoteOnly.stage === 'local_saved' ? '反映後の状態を確認'
        : remoteOnly.stage === 'post_adoption_ready' ? '確認済み同期情報を保存'
          : remoteOnly.stage === 'metadata_saved' ? '次の差異を確認'
            : remoteOnly.stage === 'blocked' || remoteOnly.stage === 'failed' ? '保存状態から再確認' : '対象データだけ確認'
    : localDiscardCurrent ? '保存状態を再確認'
    : !savedReady ? '保存状態を読み取り専用で確認'
    : !activeDate ? '最終同期確認'
      : activeClassification === 'body_mismatch' && !checkpointReady ? '本文比較の準備を確認'
        : remoteBlocked ? '保存状態からやり直す'
          : remoteCurrent && bodyRemoteAdoption.stage === 'local_saved' ? '反映後の状態を確認'
            : activeClassification === 'body_mismatch' && !comparisonCurrent ? '内容を比較'
              : bodyCandidate.result?.candidate === 'remote' ? '同期先の内容を使う候補を確認'
            : bodyCandidate.result?.candidate === 'local' ? 'iPhoneの内容を残す候補を確認'
              : '選択中の差異を確認'

  const chooseDate = (nextIndex: number) => {
    const item = items[nextIndex]
    if (!item) return
    setSelectedDate(item[0]); setCopyState('idle')
    if (bodyCandidate.selectedDate !== item[0]) bodyCandidate.setSelectedDate(item[0])
  }

  const startSavedStateCheck = () => {
    setSelectedDate('')
    setCopyState('idle')
    setCopyText('')
    bodyRemoteAdoption.discard()
    remoteOnly.discard()
    bodyCandidate.discard()
    checkpoint.discard()
    void saved.check()
  }

  const copyResult = async () => {
    const state = !savedReady && saved.result ? '安全停止'
      : bodyRemoteAdoption.stage === 'completed' ? '成功'
        : bodyRemoteAdoption.stage === 'blocked' ? '安全停止' : '確認中'
    const text = ['同期チェック結果', `状態：${state}`, `対象：${activeDate || '未選択'}`,
      `問題：${currentProblem}`, `現在stage：${currentStage}`, `次の操作：${nextOperation}`,
      `残り：${savedReady ? `${remaining}件` : '未確認'}`, `metadata：${metadata.baselineStatus}`,
      `cursor：${metadata.lastPulledChangeSequence}`, `pending：${metadata.pendingOperation ? 'あり' : 'なし'}`,
      '自動retry：なし'].join('\n')
    setCopyText(text)
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text)
        setCopyState('copied')
        return
      } catch { /* LAN HTTPや権限拒否時は選択式fallbackへ進む */ }
    }
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    textarea.setSelectionRange(0, textarea.value.length)
    let copied = false
    try { copied = document.execCommand('copy') } catch { copied = false }
    textarea.remove()
    setCopyState(copied ? 'copied' : 'fallback')
  }

  return (
    <section className="iphone-sync-guide" aria-labelledby="iphone-sync-guide-heading">
      <div className="iphone-sync-guide-heading">
        <div><p className="theme-panel-eyebrow">Sync guide</p><h4 id="iphone-sync-guide-heading">同期チェック</h4></div>
        <strong>残り：{saved.result?.unresolvedCount ?? '未確認'}件</strong>
      </div>

      <p className="cloud-sync-note">現在の工程：{currentStage}</p>

      {!savedReady ? (
        <div className="iphone-sync-guide-step">
          <h5>{saved.result ? '保存状態を安全に確認できませんでした' : '保存後の状態を確認します'}</h5>
          <p>{saved.result ? currentProblem : '現在のiPhoneと同期先を読み取り専用で確認し、次の1件を決めます。'}</p>
          <p className="cloud-sync-note">iPhoneのデータ変更：なし／同期先への書き込み：なし／metadata変更：なし／自動retry：なし</p>
          <button type="button" className="health-primary-button cloud-sync-button" disabled={!saved.eligible || saved.checking}
            onClick={startSavedStateCheck}>{saved.checking ? '保存状態を確認中…' : saved.result ? '保存状態を再確認' : '保存状態を確認'}</button>
          {!saved.eligible ? <p className="cloud-sync-note">現在は確認を実行できません。接続・認証状態を確認してください。</p> : null}
        </div>
      ) : !activeDate || !activeClassification ? (
        <div className="iphone-sync-guide-step"><h5>未解決差異はありません</h5><p>最終同期確認へ進めます。</p></div>
      ) : (
        <div className="iphone-sync-guide-step">
          <div className="iphone-sync-guide-target">
            <span>対象</span><strong>{activeDate}</strong>
            <p>{labels[activeClassification] ?? 'この項目は安全な専用確認が必要です'}</p>
          </div>
          {items.length > 1 ? <div className="iphone-sync-guide-pagination">
            <button type="button" disabled={index <= 0} onClick={() => chooseDate(index - 1)}>前の項目</button>
            <span>{index + 1} / {items.length}</span>
            <button type="button" disabled={index < 0 || index >= items.length - 1} onClick={() => chooseDate(index + 1)}>次の項目</button>
          </div> : null}

          {activeClassification === 'body_mismatch' ? (
            !checkpointReady ? <>
              <h5>本文を比較する準備</h5>
              <p>現在の差異一覧が変わっていないことを確認します。確認後も自動では反映しません。</p>
              <p className="cloud-sync-note">iPhoneのデータ変更：なし／同期先への書き込み：なし／metadata変更：なし／自動retry：なし</p>
              <button type="button" className="health-primary-button cloud-sync-button"
                disabled={!checkpoint.eligible || checkpoint.checking} onClick={() => { void checkpoint.check() }}>
                {checkpoint.checking ? '比較の準備を確認中…' : '本文比較の準備を確認'}
              </button>
            </> : remoteBlocked && bodyRemoteAdoption.result ? <>
              <h5>iPhoneへ反映できませんでした</h5>
              <p>{remoteAdoptionMessages[bodyRemoteAdoption.result.safety] ?? '安全条件を確認できなかったため停止しました。'}</p>
              <ul className="cloud-day-memo-preview-summary">
                <li>対象：{bodyRemoteAdoption.result.date ?? '未確認'}</li>
                <li>iPhoneデータ：{bodyRemoteAdoption.result.localState === 'unchanged' ? '変更なし'
                  : bodyRemoteAdoption.result.localState === 'rolled_back' ? 'rollback済み'
                    : bodyRemoteAdoption.result.localState === 'saved' ? '保存済み' : '確認が必要'}</li>
                <li>同期先への書き込み：なし</li><li>metadata変更：なし</li><li>自動retry：なし</li>
              </ul>
              <button type="button" className="health-primary-button cloud-sync-button" onClick={() => {
                bodyRemoteAdoption.discard(); bodyCandidate.discard(); checkpoint.discard(); saved.discard()
              }}>保存状態からやり直す</button>
            </> : remoteCurrent && bodyRemoteAdoption.stage === 'local_saved' ? <>
              <h5>iPhoneへの反映が完了しました</h5>
              <ul className="cloud-day-memo-preview-summary">
                <li>対象：{bodyRemoteAdoption.result?.date ?? activeDate}</li><li>採用：同期先</li>
                <li>iPhoneデータ変更：あり</li><li>同期先への書き込み：なし</li>
                <li>metadata変更：まだなし</li><li>自動retry：なし</li>
              </ul>
              <button type="button" className="health-primary-button cloud-sync-button" disabled={!bodyRemoteAdoption.canVerify || bodyRemoteAdoption.running}
                onClick={() => { void bodyRemoteAdoption.verifyAfterApply() }}>反映後の状態を確認</button>
            </> : remoteCurrent && bodyRemoteAdoption.stage === 'metadata_ready' ? <>
              <h5>同期情報を保存します</h5><p>対象日のbaselineだけを追加し、ほかの差異は残します。</p>
              <button type="button" className="health-primary-button cloud-sync-button" disabled={!bodyRemoteAdoption.canSave || bodyRemoteAdoption.running}
                onClick={bodyRemoteAdoption.saveMetadata}>同期情報を保存</button>
            </> : remoteCurrent && bodyRemoteAdoption.stage === 'completed' ? <>
              <h5>完了しました</h5><p>{activeDate}へ同期先の内容を反映しました。残り：{remaining}件</p>
              <button type="button" className="health-primary-button cloud-sync-button" onClick={() => {
                bodyRemoteAdoption.discard(); bodyCandidate.discard(); checkpoint.discard(); saved.discard()
              }}>次の差異へ</button>
            </> : !comparisonCurrent ? <>
              <h5>内容を比較します</h5>
              <p>このiPhoneと同期先の内容を読み取り専用で表示します。</p>
              <button type="button" className="health-primary-button cloud-sync-button" disabled={bodyCandidate.checking}
                onClick={() => { if (bodyCandidate.selectedDate !== activeDate) bodyCandidate.setSelectedDate(activeDate); else void bodyCandidate.compare() }}>
                {bodyCandidate.selectedDate !== activeDate ? 'この日付を比較対象にする' : bodyCandidate.checking ? '内容を比較中…' : '内容を比較'}
              </button>
            </> : <>
              <div className="iphone-sync-guide-comparison">
                <label>このiPhoneの内容<textarea readOnly rows={6} value={bodyCandidate.comparison?.localContent ?? ''} /></label>
                <small>更新：{bodyCandidate.comparison ? new Date(bodyCandidate.comparison.localUpdatedAt).toLocaleString('ja-JP') : ''}</small>
                <label>同期先の内容<textarea readOnly rows={6} value={bodyCandidate.comparison?.remoteContent ?? ''} /></label>
                <small>更新：{bodyCandidate.comparison ? new Date(bodyCandidate.comparison.remoteUpdatedAt).toLocaleString('ja-JP') : ''}</small>
              </div>
              {!candidateCurrent ? <div className="iphone-sync-guide-actions">
                <button type="button" className="health-secondary-button cloud-sync-button" onClick={() => bodyCandidate.setChoice('local')}>このiPhoneの内容を残す</button>
                <button type="button" className="health-primary-button cloud-sync-button" onClick={() => bodyCandidate.setChoice('remote')}>同期先の内容を使う</button>
                {bodyCandidate.choice ? <>
                  <p>選択：{bodyCandidate.choice === 'local' ? 'このiPhoneの内容を残します' : '同期先の内容をこのiPhoneへ反映します'}</p>
                  <button type="button" className="health-primary-button cloud-sync-button" onClick={bodyCandidate.confirmCandidate}>この候補を確定</button>
                  <button type="button" className="health-secondary-button cloud-sync-button" onClick={bodyCandidate.clearChoice}>選び直す</button>
                </> : null}
              </div> : bodyCandidate.result?.candidate === 'local' ? <>
                <h5>このiPhoneの内容を同期先へ送る準備</h5>
                <p>この操作ではpendingを準備します。同期先への送信は次の明示操作です。</p>
                <button type="button" className="health-primary-button cloud-sync-button" disabled={!bodyLocalPreparation.eligible || bodyLocalPreparation.preparing}
                  onClick={() => { void bodyLocalPreparation.prepare() }}>この内容を残す準備をする</button>
              </> : <>
                <h5>選択内容を確認してください</h5>
                <p>この操作ではiPhoneの内容だけを変更します。同期先は変更しません。</p>
                <p className="cloud-sync-note">iPhoneのデータ変更：あり／同期先への書き込み：なし／metadata変更：反映後確認であり／自動retry：なし</p>
                <button type="button" className="health-primary-button cloud-sync-button" disabled={!bodyRemoteAdoption.canApply || bodyRemoteAdoption.running}
                  onClick={() => { void bodyRemoteAdoption.applyRemote() }}>{bodyRemoteAdoption.running ? '反映しています…' : 'この内容を反映する'}</button>
                <button type="button" className="health-secondary-button cloud-sync-button" onClick={bodyCandidate.clearChoice}>選び直す</button>
              </>}
            </>
          ) : activeClassification === 'local_only' ? <>
            {localDiscardCurrent ? <>
              <h5>{localOnlyDiscard.result?.safety === 'recovery_local_only_discarded'
                ? 'このiPhoneから削除しました' : '削除を完了できませんでした'}</h5>
              <ul className="cloud-day-memo-preview-summary">
                <li>対象日：{localOnlyDiscard.result?.date ?? activeDate}</li>
                <li>iPhoneのデータ：{localOnlyDiscard.result?.localState === 'discarded' ? '削除済み'
                  : localOnlyDiscard.result?.localState === 'rolled_back' ? '元の状態へ復元済み'
                    : localOnlyDiscard.result?.localState === 'uncertain' ? '確認が必要' : '変更なし'}</li>
                <li>同期先への書き込み：なし</li><li>metadata変更：なし</li>
                <li>pending作成：なし</li><li>自動retry：なし</li>
              </ul>
              <button type="button" className="health-primary-button cloud-sync-button" onClick={() => {
                localOnlyDiscard.discardResult(); localOnly.discard(); setSelectedDate('')
                checkpoint.discard(); bodyCandidate.discard(); saved.discard(); void saved.check()
              }}>保存状態を再確認</button>
            </> : <>
              <h5>このiPhoneにだけデータがあります</h5>
              <p>対象日：{activeDate}</p>
              <p>同期先へ送るか、このiPhoneからだけ削除するかを選んでください。</p>
              <button type="button" className="health-primary-button cloud-sync-button"
                disabled={!localOnly.eligible || localOnly.preparing || localOnlyDiscard.discarding}
                onClick={() => { void localOnly.prepare(activeDate) }}>同期先へ送る</button>
              <button type="button" className="health-secondary-button cloud-sync-button"
                disabled={!localOnlyDiscard.eligible || localOnlyDiscard.discarding || localOnly.preparing}
                onClick={() => { void localOnlyDiscard.discardLocalOnly(activeDate) }}>
                {localOnlyDiscard.discarding ? '削除しています…' : 'このiPhoneから削除'}
              </button>
              {!localOnlyDiscard.eligible ? <p className="cloud-sync-note">現在の保存状態では安全に削除できません。保存状態を再確認してください。</p> : null}
              <button type="button" className="health-secondary-button cloud-sync-button"
                onClick={() => chooseDate(Math.min(index + 1, items.length - 1))}>保留</button>
            </>}
          </> : activeClassification === 'remote_only_active' ? <>
            {remoteOnlyCurrent && (remoteOnly.stage === 'blocked' || remoteOnly.stage === 'failed') ? <>
              <h5>{remoteOnly.stage === 'failed' ? '確認に失敗しました' : '安全停止'}</h5>
              <p>{remoteOnlyMessages[remoteOnly.result?.safety ?? '']
                ?? remoteOnly.safeErrorMessage ?? '保存状態が変化したため停止しました。'}</p>
              <ul className="cloud-day-memo-preview-summary">
                <li>対象日：{remoteOnly.result?.date ?? activeDate}</li>
                <li>iPhoneのデータ：{remoteOnly.result?.localState === 'rolled_back' ? '元の状態へ復元済み'
                  : remoteOnly.result?.localState === 'uncertain' ? '確認が必要'
                    : remoteOnly.result?.localState === 'saved' ? '保存済み・同期情報未確定' : '変更なし'}</li>
                <li>同期先への書き込み：なし</li><li>自動retry：なし</li>
              </ul>
              <button type="button" className="health-primary-button cloud-sync-button" onClick={() => {
                remoteOnly.discard(); setSelectedDate(''); checkpoint.discard(); bodyCandidate.discard(); saved.discard(); void saved.check()
              }}>保存状態から再確認</button>
            </> : remoteOnlyCurrent && remoteOnly.stage === 'candidate_ready' ? <>
              <h5>対象データだけ確認しました</h5>
              <p>対象日：{activeDate}</p>
              <p>このiPhoneへ1件だけ反映します。他の未解決差異はそのまま残り、同期先は変更しません。</p>
              <button type="button" className="health-primary-button cloud-sync-button" disabled={!remoteOnly.canAdopt || remoteOnly.running}
                onClick={() => { void remoteOnly.adoptLocal() }}>{remoteOnly.running ? '反映しています…' : '反映する'}</button>
            </> : remoteOnlyCurrent && remoteOnly.stage === 'local_saved' ? <>
              <h5>iPhoneへの反映が完了しました</h5>
              <ul className="cloud-day-memo-preview-summary">
                <li>対象日：{remoteOnly.result?.date ?? activeDate}</li><li>採用：同期先</li>
                <li>iPhone変更：あり</li><li>同期先変更：なし</li>
                <li>残り差異：{remoteOnly.result?.unresolvedCount ?? '確認待ち'}件</li>
              </ul>
              <button type="button" className="health-primary-button cloud-sync-button" disabled={!remoteOnly.canPostCheck || remoteOnly.running}
                onClick={() => { void remoteOnly.checkPostAdoption() }}>反映後の状態を確認</button>
            </> : remoteOnlyCurrent && remoteOnly.stage === 'post_adoption_ready' ? <>
              <h5>反映後の状態を確認しました</h5>
              <p>対象日のbaselineだけを追加し、他の未解決差異とrecovery_requiredを維持します。</p>
              <button type="button" className="health-primary-button cloud-sync-button" disabled={!remoteOnly.canSave || remoteOnly.running}
                onClick={remoteOnly.saveMetadata}>同期情報を保存</button>
            </> : remoteOnlyCurrent && remoteOnly.stage === 'metadata_saved' ? <>
              <h5>同期情報を保存しました</h5>
              <p>対象1件の反映が完了しました。残り差異：{remoteOnly.result?.unresolvedCount ?? 0}件</p>
              <button type="button" className="health-primary-button cloud-sync-button" onClick={() => {
                remoteOnly.discard(); setSelectedDate(''); checkpoint.discard(); bodyCandidate.discard(); saved.discard(); void saved.check()
              }}>次の差異を確認</button>
            </> : <>
              <h5>同期先にだけデータがあります</h5>
              <p>対象日：{activeDate}</p>
              <p>対象データだけ確認します。他の未解決差異は変更しません。</p>
              <button type="button" className="health-primary-button cloud-sync-button" disabled={!remoteOnly.eligible || remoteOnly.running}
                onClick={() => { void remoteOnly.checkCandidate(activeDate) }}>
                {remoteOnly.running ? '確認しています…' : '対象データだけ確認'}</button>
              {!remoteOnly.eligible ? <p className="cloud-sync-note">現在の保存状態では確認を開始できません。保存状態を再確認してください。</p> : null}
            </>}
          </> : <><h5>この項目は専用の安全確認が必要です</h5><p>自動で削除・復活せず、安全側で停止します。</p></>}

        </div>
      )}
      <div className="iphone-sync-guide-copy">
        <button type="button" className="health-secondary-button cloud-sync-button" onClick={() => { void copyResult() }}>結果をコピー</button>
        {copyState === 'copied' ? <p className="cloud-day-memo-success">結果をコピーしました。</p> : null}
        {copyState === 'fallback' ? <div className="cloud-sync-note">
          <p>自動コピーできませんでした。下の内容を長押ししてコピーしてください。同期状態には影響ありません。</p>
          <textarea readOnly rows={10} value={copyText} aria-label="同期チェック結果のコピー用テキスト"
            onFocus={(event) => event.currentTarget.select()} />
        </div> : null}
      </div>
    </section>
  )
}
