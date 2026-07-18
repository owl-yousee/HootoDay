import type { ChangeEvent } from 'react'

interface MobileNativePickerFieldProps {
  id: string
  className: string
  label: string
  type: 'date' | 'time'
  value: string
  onChange: (value: string) => void
  required?: boolean
  optional?: boolean
  disabled?: boolean
  error?: string
}

function formatDateValue(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return match ? `${match[1]}/${match[2]}/${match[3]}` : null
}

function formatSpokenValue(type: 'date' | 'time', value: string): string {
  if (type === 'date') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    return match ? `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日` : '未設定'
  }

  const match = /^(\d{2}):(\d{2})$/.exec(value)
  return match ? `${Number(match[1])}時${Number(match[2])}分` : '未設定'
}

export function MobileNativePickerField({
  id,
  className,
  label,
  type,
  value,
  onChange,
  required = false,
  optional = false,
  disabled = false,
  error,
}: MobileNativePickerFieldProps) {
  const errorId = `${id}-error`
  const displayValue = type === 'date' ? formatDateValue(value) : (/^\d{2}:\d{2}$/.test(value) ? value : null)
  const placeholder = type === 'date' ? '日付を選択' : '未設定'

  const handleChange = (changeEvent: ChangeEvent<HTMLInputElement>) => {
    onChange(changeEvent.target.value)
  }

  return (
    <div className={`form-field mobile-picker-field ${className}`}>
      <label htmlFor={id}>
        {label}
        {required && <span className="required-label">必須</span>}
        {optional && <span className="optional-label">任意</span>}
      </label>
      <div className={`mobile-picker-control${disabled ? ' is-disabled' : ''}`}>
        <div
          className={`mobile-picker-display${error ? ' has-error' : ''}`}
          aria-hidden="true"
        >
          <span className={displayValue ? 'mobile-picker-value' : 'mobile-picker-placeholder'}>
            {displayValue ?? placeholder}
          </span>
        </div>
        <input
          id={id}
          className="mobile-picker-native"
          type={type}
          value={value}
          onChange={handleChange}
          onInput={(inputEvent) => onChange(inputEvent.currentTarget.value)}
          disabled={disabled}
          required={required}
          aria-label={`${label}を選択。現在は${formatSpokenValue(type, value)}`}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
        />
      </div>
      {error && <p id={errorId} className="form-error" role="alert">{error}</p>}
    </div>
  )
}
