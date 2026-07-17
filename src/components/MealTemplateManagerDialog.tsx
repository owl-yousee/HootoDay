import { useState, type FormEvent } from 'react'
import type { MealTemplate, MealType } from '../types/health'
import {
  MAX_MEAL_TEMPLATE_CONTENT_LENGTH, MAX_MEAL_TEMPLATE_NAME_LENGTH,
  mealTypeLabels, normalizeMealTemplateText,
} from '../utils/mealTemplateStorage'

interface Props {
  templates: MealTemplate[]
  onSave: (template: MealTemplate) => void
  onDelete: (id: string) => void
  onMove: (id: string, direction: -1 | 1) => void
  onClose: () => void
}

function createId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `meal-template-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function MealTemplateManagerDialog({ templates, onSave, onDelete, onMove, onClose }: Props) {
  const [editing, setEditing] = useState<MealTemplate | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [name, setName] = useState('')
  const [mealType, setMealType] = useState<MealType>('breakfast')
  const [content, setContent] = useState('')
  const [error, setError] = useState('')

  const beginCreate = () => { setEditing(null); setName(''); setMealType('breakfast'); setContent(''); setError(''); setIsCreating(true) }
  const beginEdit = (template: MealTemplate) => { setEditing(template); setName(template.name); setMealType(template.mealType); setContent(template.content); setError(''); setIsCreating(true) }
  const cancelForm = () => { setIsCreating(false); setEditing(null); setError('') }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const normalizedName = normalizeMealTemplateText(name)
    const normalizedContent = normalizeMealTemplateText(content)
    if (!normalizedName) { setError('定型名を入力してください。'); return }
    if (!normalizedContent) { setError('内容を入力してください。'); return }
    const now = new Date().toISOString()
    onSave({
      id: editing?.id ?? createId(), name: normalizedName, mealType, content: normalizedContent,
      sortOrder: editing?.sortOrder ?? templates.length, createdAt: editing?.createdAt ?? now, updatedAt: now,
    })
    cancelForm()
  }

  return (
    <section className="meal-template-manager" aria-labelledby="meal-template-manager-title">
      <div className="meal-template-manager-heading">
        <div><p className="weight-record-eyebrow">Meal templates</p><h2 id="meal-template-manager-title">食事定型メニュー</h2></div>
        <button type="button" className="event-action-button secondary" onClick={onClose}>食事入力へ戻る</button>
      </div>

      {isCreating ? (
        <form className="meal-template-form" onSubmit={handleSubmit} noValidate>
          <h3>{editing ? '定型メニューを編集' : '定型メニューを新規作成'}</h3>
          {error && <p id="meal-template-error" className="form-error" role="alert">{error}</p>}
          <div className="form-field"><label htmlFor="meal-template-name">定型名</label><input id="meal-template-name" value={name} onChange={(event) => { setName(event.target.value); setError('') }} maxLength={MAX_MEAL_TEMPLATE_NAME_LENGTH} aria-invalid={Boolean(error)} aria-describedby="meal-template-name-hint" /><span id="meal-template-name-hint" className="field-hint">最大{MAX_MEAL_TEMPLATE_NAME_LENGTH}文字。</span></div>
          <div className="form-field"><label htmlFor="meal-template-type">使用先</label><select id="meal-template-type" value={mealType} onChange={(event) => setMealType(event.target.value as MealType)}>{Object.entries(mealTypeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
          <div className="form-field"><label htmlFor="meal-template-content">内容</label><textarea id="meal-template-content" value={content} onChange={(event) => { setContent(event.target.value); setError('') }} maxLength={MAX_MEAL_TEMPLATE_CONTENT_LENGTH} rows={6} aria-invalid={Boolean(error)} aria-describedby="meal-template-content-hint" /><span id="meal-template-content-hint" className="field-hint">改行できます。最大{MAX_MEAL_TEMPLATE_CONTENT_LENGTH}文字。</span><span className="character-count">{content.length}/{MAX_MEAL_TEMPLATE_CONTENT_LENGTH}</span></div>
          <div className="event-editor-actions"><span className="event-action-spacer" /><button type="button" className="event-action-button secondary" onClick={cancelForm}>キャンセル</button><button type="submit" className="event-action-button primary">定型を保存</button></div>
        </form>
      ) : (
        <>
          <div className="meal-template-toolbar"><p>{templates.length}件の定型メニュー</p><button type="button" className="event-action-button primary" onClick={beginCreate}>新規作成</button></div>
          {templates.length === 0 ? <p className="meal-template-empty">定型メニューは未登録です。</p> : (
            <div className="meal-template-list">
              {templates.map((template, index) => (
                <article className="meal-template-card" key={template.id}>
                  <div className="meal-template-card-heading"><div><h3>{template.name}</h3><span>{mealTypeLabels[template.mealType]}</span></div></div>
                  <p>{template.content}</p>
                  <div className="meal-template-card-actions">
                    <button type="button" className="event-action-button secondary" onClick={() => onMove(template.id, -1)} disabled={index === 0} aria-label={`${template.name}を上へ移動`}>上へ</button>
                    <button type="button" className="event-action-button secondary" onClick={() => onMove(template.id, 1)} disabled={index === templates.length - 1} aria-label={`${template.name}を下へ移動`}>下へ</button>
                    <button type="button" className="event-action-button secondary" onClick={() => beginEdit(template)} aria-label={`${template.name}を編集`}>編集</button>
                    <button type="button" className="event-action-button danger" onClick={() => { if (window.confirm(`「${template.name}」を削除しますか？`)) onDelete(template.id) }} aria-label={`${template.name}を削除`}>削除</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}
