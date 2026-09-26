import { useEffect, useRef, useState } from 'react'
import { X, Sparkles } from 'lucide-react'
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
          <Sparkles size={16} /> Skills
        </strong>
        <button className="icon" disabled={working} onClick={onClose} aria-label={t('ui.close')}>
          <X size={18} />
        </button>
      </header>
      <p className="muted">{t('skills.help')}</p>
      <div className="skill-list">
        <button className="secondary" disabled={working} onClick={() => void choose(null)}>
          {t('skills.none')}
        </button>
        {skills.map((skill) => (
          <div className="skill-row" key={skill.id}>
            <button
              className="secondary"
              disabled={working}
              aria-pressed={selected?.id === skill.id}
              onClick={() => void choose(skill)}
            >
              <strong>{skill.name}</strong>
              <small>{skill.description}</small>
            </button>
            {skill.id !== 'builtin-creator' && (
              <button
                className="secondary"
                disabled={working}
                onClick={() => {
                  setEditing({ ...skill, id: 'draft-copy' })
                  setError('')
                }}
              >
                {t('skills.editCopy')}
              </button>
            )}
          </div>
        ))}
      </div>
      {editing && (
        <section className="skill-editor">
          <h3>{t('skills.draft')}</h3>
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
