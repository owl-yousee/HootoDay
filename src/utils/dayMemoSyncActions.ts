import type { DayMemoNormalBodyMismatchChoice } from '../hooks/useDayMemoNormalBodyMismatchCandidate'

export const BODY_MISMATCH_CANDIDATE_ACTIONS = {
  local: 'local採用候補を確認',
  remote: 'remote採用候補を確認',
} as const satisfies Record<DayMemoNormalBodyMismatchChoice, string>

export const BODY_MISMATCH_LOCAL_ACTIONS = {
  apply: 'local本文を同期先へ反映',
  applying: 'local本文を同期先へ反映中…',
  finalize: 'local採用結果を確定',
  finalizing: 'local採用結果を確認中…',
} as const

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

export interface BodyMismatchCandidateAction<Choice extends DayMemoNormalBodyMismatchChoice> {
  key: `candidate_${Choice}`
  choice: Choice
  label: (typeof BODY_MISMATCH_CANDIDATE_ACTIONS)[Choice]
  handler: () => void
}

export function bodyMismatchCandidateAction<Choice extends DayMemoNormalBodyMismatchChoice>(
  choice: Choice,
  handler: () => void,
  eligible = true,
): BodyMismatchCandidateAction<Choice> | null {
  return eligible ? {
    key: `candidate_${choice}`,
    choice,
    label: BODY_MISMATCH_CANDIDATE_ACTIONS[choice],
    handler,
  } : null
}

export function resolveReadyBodyMismatchCandidateChoice(
  status: 'checking' | 'ready' | 'blocked' | 'failed' | null | undefined,
  result: { candidate: DayMemoNormalBodyMismatchChoice | null; safety: string } | null | undefined,
): DayMemoNormalBodyMismatchChoice | null {
  if (status !== 'ready' || !result?.candidate) return null
  if (result.candidate === 'local' && result.safety === 'normal_body_mismatch_candidate_local') return 'local'
  if (result.candidate === 'remote' && result.safety === 'normal_body_mismatch_candidate_remote') return 'remote'
  return null
}

export function bodyMismatchRemoteAction(
  key: BodyMismatchRemoteActionKey,
  handler: (() => void) | null,
  eligible = true,
) {
  return handler && eligible ? { key, label: BODY_MISMATCH_REMOTE_ACTIONS[key], handler } : null
}
