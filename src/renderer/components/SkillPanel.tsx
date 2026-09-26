import { useEffect, useRef, useState } from 'react'
import { X, Sparkles, Plus, Check, Copy, ArrowLeft, MessageSquare } from 'lucide-react'
import { t, translateMessage } from '../i18n'
import type { Skill } from '../../shared/types'

export default function SkillPanel({
  selected,
  draft,
  onSelect,
  onClose,
}: {
  selected?: Skill | null
  draft?: Skill
  onSelect: (skill: Skill | null) => Promise<void>
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [skills, setSkills] = useState<Skill[]>([])
  const [editing, setEditing] = useState<Skill | undefined>(
    draft || (selected?.id.startsWith('draft-') ? selected : undefined),
  )
  const [showEditor, setShowEditor] = useState(!!editing)
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  useEffect(() => {
    dialog.current?.showModal()
    void window.studio
      .listSkills()
      .then(setSkills)
      .catch((reason) => setError(translateMessage(String(reason))))
  }, [])
  async function choose(skill: Skill | null) {
    setWorking(true)
    try {
      await onSelect(skill)
      onClose()
    } catch (reason) {
      setError(translateMessage(String(reason)))
    } finally {
      setWorking(false)
    }
  }
  async function save() {
    if (!editing) return
    setWorking(true)
    try {
      await window.studio.saveSkill(editing)
      setSkills(await window.studio.listSkills())
      setEditing(undefined)
      setShowEditor(false)
      setError(t('skills.saved'))
    } catch (reason) {
      setError(translateMessage(String(reason)))
    } finally {
      setWorking(false)
    }
  }
  return (
    <dialog
      className="skill-panel region-editor"
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault()
        if (!working) onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !working) onClose()
      }}
    >
      <header>
        <strong>
          {showEditor && (
            <button
              className="icon"
              disabled={working}
              onClick={() => setShowEditor(false)}
              aria-label={t('skills.back')}
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <Sparkles size={16} /> {showEditor ? t('skills.draft') : 'Skills'}
        </strong>
        <div className="skill-header-actions">
          {!showEditor && (
            <button
              className="primary"
              disabled={working || !skills.some((skill) => skill.id === 'builtin-creator')}
              onClick={() => void choose(skills.find((skill) => skill.id === 'builtin-creator')!)}
            >
              <Plus size={16} />
              {t('skills.create')}
            </button>
          )}
          <button className="icon" disabled={working} onClick={onClose} aria-label={t('ui.close')}>
            <X size={18} />
          </button>
        </div>
      </header>
      {!showEditor && (
        <>
          <p className="muted">{t('skills.chooseHelp')}</p>
          <div className="skill-list">
            <div className="skill-row">
              <button
                className="skill-choice"
                disabled={working}
                aria-pressed={!selected}
                onClick={() => void choose(null)}
              >
                <MessageSquare size={18} />
                <span>
                  <strong>{t('skills.none')}</strong>
                  <small>{t('skills.noneHelp')}</small>
                </span>
                {!selected && <Check size={17} />}
              </button>
            </div>
            {skills
              .filter((skill) => skill.id !== 'builtin-creator')
              .map((skill) => (
                <div className="skill-row" key={skill.id}>
                  <button
                    className="skill-choice"
                    disabled={working}
                    aria-pressed={selected?.id === skill.id}
                    onClick={() => void choose(skill)}
                  >
                    <Sparkles size={18} />
                    <span>
                      <strong>
                        {skill.id === 'builtin-character-sheet'
                          ? t('skills.characterName')
                          : skill.name}
                      </strong>
                      <small>
                        {skill.id === 'builtin-character-sheet'
                          ? t('skills.characterDescription')
                          : skill.description}
                      </small>
                    </span>
                    {selected?.id === skill.id && <Check size={17} />}
                  </button>
                  <button
                    className="skill-copy"
                    disabled={working}
                    title={t('skills.editCopy')}
                    aria-label={t('skills.editCopy')}
                    onClick={() => {
                      setEditing({ ...skill, id: 'draft-copy' })
                      setShowEditor(true)
                      setError('')
                    }}
                  >
                    <Copy size={16} />
                  </button>
                </div>
              ))}
            {selected?.id === 'builtin-creator' && (
              <p role="status" className="vision-context-note">
                {t('skills.creatorActive')}
              </p>
            )}
            {editing && (
              <button className="secondary" disabled={working} onClick={() => setShowEditor(true)}>
                {t('skills.resumeDraft')}
              </button>
            )}
          </div>
        </>
      )}
      {showEditor && editing && (
        <section className="skill-editor">
          <label>
            {t('skills.name')}
            <input
              value={editing.name}
              maxLength={160}
              disabled={working}
              onChange={(event) => setEditing({ ...editing, name: event.target.value })}
            />
          </label>
          <label>
            {t('skills.description')}
            <input
              value={editing.description}
              maxLength={1000}
              disabled={working}
              onChange={(event) => setEditing({ ...editing, description: event.target.value })}
            />
          </label>
          <fieldset disabled={working}>
            <legend>{t('skills.tools')}</legend>
            {[
              ...new Set([
                'create_images',
                'list_images',
                'view_image',
                'read_webpage',
                ...editing.tools,
              ]),
            ].map((tool) => (
              <label key={tool}>
                <input
                  type="checkbox"
                  checked={editing.tools.includes(tool)}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      tools: event.target.checked
                        ? [...editing.tools, tool]
                        : editing.tools.filter((value) => value !== tool),
                    })
                  }
                />
                {tool}
              </label>
            ))}
          </fieldset>
          <fieldset disabled={working}>
            <legend>{t('skills.requirements')}</legend>
            <label>
              {t('skills.minImages')}
              <input
                type="number"
                min="0"
                max="6"
                value={editing.requirements?.minImages ?? 0}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    requirements: {
                      ...(editing.requirements || { minImages: 0, maxImages: 6, capabilities: [] }),
                      minImages: Number(event.target.value),
                    },
                  })
                }
              />
            </label>
            <label>
              {t('skills.maxImages')}
              <input
                type="number"
                min="0"
                max="6"
                value={editing.requirements?.maxImages ?? 6}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    requirements: {
                      ...(editing.requirements || { minImages: 0, maxImages: 6, capabilities: [] }),
                      maxImages: Number(event.target.value),
                    },
                  })
                }
              />
            </label>
            <label>
              {t('skills.capabilities')}
              <input
                value={editing.requirements?.capabilities.join(', ') || ''}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    requirements: {
                      minImages: 0,
                      maxImages: 6,
                      ...editing.requirements,
                      capabilities: event.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    },
                  })
                }
              />
            </label>
          </fieldset>
          <p className="muted">{t('skills.templateHelp')}</p>
          <label>
            {t('skills.instructions')}
            <textarea
              rows={10}
              maxLength={20000}
              value={editing.instructions}
              disabled={working}
              onChange={(event) => setEditing({ ...editing, instructions: event.target.value })}
            />
          </label>
          <p className="muted">{t('skills.testHelp')}</p>
          <footer>
            <button
              className="secondary"
              disabled={working}
              onClick={() => void choose({ ...editing, id: 'draft-test' })}
            >
              {t('skills.test')}
            </button>
            <button className="primary" disabled={working} onClick={() => void save()}>
              {t('skills.save')}
            </button>
          </footer>
        </section>
      )}
      {error && <p role="status">{error}</p>}
    </dialog>
  )
}
