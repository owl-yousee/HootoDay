import { useRef, useState } from 'react'
import { copyTextWithFallback, type CopyTextResult } from '../utils/clipboard'

interface Props {
  buttonLabel: string
  text: string | (() => string)
  successMessage: string
}

export function CopyTextControl({ buttonLabel, text, successMessage }: Props) {
  const [result, setResult] = useState<CopyTextResult | 'idle'>('idle')
  const [snapshot, setSnapshot] = useState('')
  const [copying, setCopying] = useState(false)
  const copyingRef = useRef(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const copy = async () => {
    if (copyingRef.current) return
    copyingRef.current = true
    setCopying(true)
    const nextSnapshot = typeof text === 'function' ? text() : text
    setSnapshot(nextSnapshot)
    setResult('idle')
    try {
      const next = await copyTextWithFallback(nextSnapshot)
      setResult(next)
    } finally {
      copyingRef.current = false
      setCopying(false)
    }
  }
  const selectAll = () => {
    const textarea = textareaRef.current
    if (!textarea) { setResult('failed'); return }
    try {
      textarea.focus({ preventScroll: true })
      textarea.select()
      textarea.setSelectionRange(0, textarea.value.length)
    } catch {
      setResult('failed')
    }
  }
  const close = () => {
    setResult('idle')
    setSnapshot('')
    requestAnimationFrame(() => buttonRef.current?.focus({ preventScroll: true }))
  }
  const succeeded = result === 'clipboard_api_success' || result === 'exec_command_success'
  const manual = result === 'manual_copy_required' || result === 'failed'

  return <div className="sync-copy-control">
    <button ref={buttonRef} type="button" className="health-secondary-button cloud-sync-button"
      aria-label={buttonLabel} disabled={copying} onClick={() => { void copy() }}>{copying ? 'コピーしています…' : buttonLabel}</button>
    <div aria-live="polite" aria-atomic="true">
      {succeeded ? <p className="cloud-day-memo-success">{successMessage}</p> : null}
      {manual ? <div className="sync-copy-manual" onKeyDown={(event) => { if (event.key === 'Escape') close() }}>
        <p>{result === 'failed' ? '文章を選択できませんでした。下の文章を長押ししてコピーしてください。'
          : '自動コピーできなかったため、下の文章を長押ししてコピーしてください。'}</p>
        <label>コピーする同期状態
          <textarea ref={textareaRef} readOnly rows={14} value={snapshot}
            onFocus={(event) => { event.currentTarget.select(); event.currentTarget.setSelectionRange(0, event.currentTarget.value.length) }} />
        </label>
        <div className="sync-copy-manual-actions">
          <button type="button" className="health-secondary-button cloud-sync-button" onClick={selectAll}>全文を選択</button>
          <button type="button" className="health-secondary-button cloud-sync-button" onClick={close}>閉じる</button>
        </div>
      </div> : null}
    </div>
  </div>
}
