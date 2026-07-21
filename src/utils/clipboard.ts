export type CopyTextResult =
  | 'clipboard_api_success'
  | 'exec_command_success'
  | 'manual_copy_required'
  | 'failed'

export async function copyTextWithFallback(text: string): Promise<CopyTextResult> {
  if (!text) return 'failed'
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return 'clipboard_api_success'
    } catch {
      // Permission denial and LAN/browser restrictions continue to the DOM fallback.
    }
  }

  if (!document.body || typeof document.execCommand !== 'function') return 'manual_copy_required'
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('aria-hidden', 'true')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  textarea.style.width = '1px'
  textarea.style.height = '1px'
  textarea.style.opacity = '0.01'
  textarea.style.fontSize = '16px'
  textarea.style.userSelect = 'text'
  document.body.appendChild(textarea)
  let copied = false
  try {
    textarea.focus({ preventScroll: true })
    textarea.select()
    textarea.setSelectionRange(0, text.length)
    copied = document.execCommand('copy') === true
  } catch {
    copied = false
  } finally {
    window.getSelection()?.removeAllRanges()
    textarea.remove()
    try { previousFocus?.focus({ preventScroll: true }) } catch { previousFocus?.focus() }
  }
  return copied ? 'exec_command_success' : 'manual_copy_required'
}
