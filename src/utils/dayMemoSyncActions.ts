export const BODY_MISMATCH_REMOTE_ACTIONS = {
  compare: 'localとremoteを比較',
  apply: 'remote本文をこの端末へ反映',
  applying: 'remote本文を反映中…',
  finalize: 'remote採用結果を確定',
  finalizing: 'remote採用結果を確認中…',
  retryCurrent: '現在段階を再確認',
  restartSaved: '保存済み状態からやり直す',
  close: '復旧作業を閉じる',
} as const

export type BodyMismatchRemoteActionKey = keyof typeof BODY_MISMATCH_REMOTE_ACTIONS

export function bodyMismatchRemoteAction(
  key: BodyMismatchRemoteActionKey,
  handler: (() => void) | null,
  eligible = true,
) {
  return handler && eligible ? { key, label: BODY_MISMATCH_REMOTE_ACTIONS[key], handler } : null
}
