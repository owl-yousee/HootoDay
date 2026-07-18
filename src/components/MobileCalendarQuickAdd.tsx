import { CalendarPlusIcon } from '@phosphor-icons/react/CalendarPlus'
import { NotePencilIcon } from '@phosphor-icons/react/NotePencil'
import { PlusIcon } from '@phosphor-icons/react/Plus'
import { useEffect, useRef } from 'react'

interface MobileCalendarQuickAddProps {
  dateLabel: string
  isOpen: boolean
  onToggle: () => void
  onClose: () => void
  onAddEvent: () => void
  onAddMemo: () => void
}

export function MobileCalendarQuickAdd({
  dateLabel,
  isOpen,
  onToggle,
  onClose,
  onAddEvent,
  onAddMemo,
}: MobileCalendarQuickAddProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const firstActionRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!isOpen) return
    firstActionRef.current?.focus()

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
      triggerRef.current?.focus()
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen, onClose])

  const chooseAction = (action: () => void) => {
    onClose()
    action()
  }

  return (
    <div className="mobile-calendar-quick-add">
      <section
        id="mobile-calendar-add-menu"
        className="mobile-calendar-add-menu"
        aria-labelledby="mobile-calendar-add-title"
        hidden={!isOpen}
      >
          <div className="mobile-calendar-add-heading">
            <strong id="mobile-calendar-add-title">追加する内容</strong>
            <span>{dateLabel}に追加</span>
          </div>
          <div className="mobile-calendar-add-actions">
            <button
              ref={firstActionRef}
              type="button"
              onClick={() => chooseAction(onAddEvent)}
              aria-label={`${dateLabel}に予定を追加`}
            >
              <CalendarPlusIcon size={20} weight="bold" aria-hidden="true" />
              <span>予定</span>
            </button>
            <button
              type="button"
              onClick={() => chooseAction(onAddMemo)}
              aria-label={`${dateLabel}のメモを編集`}
            >
              <NotePencilIcon size={20} weight="bold" aria-hidden="true" />
              <span>メモ</span>
            </button>
          </div>
      </section>

      <button
        ref={triggerRef}
        type="button"
        className="mobile-calendar-add-trigger"
        onClick={onToggle}
        aria-label="選択日に追加"
        aria-expanded={isOpen}
        aria-controls="mobile-calendar-add-menu"
      >
        <PlusIcon size={25} weight="bold" aria-hidden="true" />
      </button>
    </div>
  )
}
