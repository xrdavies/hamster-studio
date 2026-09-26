import { useEffect, useState } from 'react'
import { ArrowLeft, Plus } from 'lucide-react'
import { t, translateMessage } from '../i18n'
import type { Skill } from '../../shared/types'
import ConfirmDialog, { type ConfirmState } from './ConfirmDialog'
import { skillName, skillDescription } from './SkillPanel'

export const emptySkill = (): Skill => ({
  id: 'draft-new',
  version: 1,
  schemaVersion: 2,
  name: '',
  description: '',
  tools: [],
  requirements: { minImages: 0, maxImages: 6 },
  instructions: '## Purpose\n\n## Inputs\n\n## Outputs\n\n## Steps\n\n## Acceptance\n\n## Limits\n',
})
export default function SkillManager({
  draft,
  onClose,
  onRun,
}: {
  draft?: Skill
  onClose: () => void
  onRun: (skill: Skill) => Promise<void>
}) {
  const [skills, setSkills] = useState<Skill[]>([])
  const [editing, setEditing] = useState<Skill | undefined>(draft)
  const [baseline, setBaseline] = useState(JSON.stringify(draft))
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const builtin = !!editing?.id.startsWith('builtin-')
  const dirty = JSON.stringify(editing) !== baseline
  useEffect(() => {
    void window.studio
      .listSkills()
      .then(setSkills)
      .catch((e) => setError(String(e)))
  }, [])
  function change(skill: Skill | undefined) {
    setEditing(skill)
    setBaseline(JSON.stringify(skill))
    setError('')
  }
  function leave(action: () => void) {
    if (dirty)
      setConfirm({
        title: t('skills.unsaved'),
        message: t('skills.discardHelp'),
        confirm: () => {
          setConfirm(null)
          action()
        },
      })
    else action()
  }
  async function save() {
    if (!editing) return
    setWorking(true)
    try {
      const saved = await window.studio.saveSkill(editing)
      setSkills(await window.studio.listSkills())
      change(saved)
      setError(t('skills.saved'))
    } catch (e) {
      setError(translateMessage(String(e)))
    } finally {
      setWorking(false)
    }
  }
  async function run(skill: Skill) {
    setWorking(true)
    try {
      await onRun(skill)
    } catch (e) {
      setError(translateMessage(String(e)))
    } finally {
      setWorking(false)
    }
  }
  async function remove() {
    if (!editing || builtin) return
    setConfirm(null)
    setWorking(true)
    try {
      await window.studio.deleteSkill(editing.id)
      setSkills(await window.studio.listSkills())
      change(undefined)
    } catch (e) {
      setError(String(e))
    } finally {
      setWorking(false)
    }
  }
  return (
    <section className="skill-manager" aria-label={t('skills.manage')}>
      <header className="skill-manager-header">
        <button className="secondary" disabled={working} onClick={() => leave(onClose)}>
          <ArrowLeft size={16} />
          {t('skills.returnChat')}
        </button>
        <h2>{t('skills.manage')}</h2>
        <button
          className="primary"
          disabled={working}
          onClick={() => leave(() => change(emptySkill()))}
        >
          <Plus size={16} />
          {t('skills.create')}
        </button>
      </header>
      <div className="skill-manager-body">
        <nav className="skill-library" aria-label={t('skills.manage')}>
          {[true, false].map((group) => (
            <section key={String(group)}>
              <h3>{t(group ? 'skills.builtin' : 'skills.mine')}</h3>
              {skills
                .filter((s) => s.id.startsWith('builtin-') === group)
                .map((skill) => (
                  <button
                    key={skill.id}
                    disabled={working}
                    aria-current={editing?.id === skill.id ? 'true' : undefined}
                    onClick={() => leave(() => change(skill))}
                  >
                    <strong>{skillName(skill)}</strong>
                    <small>{skillDescription(skill)}</small>
                  </button>
                ))}
              {!group && !skills.some((s) => !s.id.startsWith('builtin-')) && (
                <p className="muted">{t('skills.emptyLibrary')}</p>
              )}
            </section>
          ))}
          {editing?.id.startsWith('draft-') && (
            <button aria-current="true">
              {t('skills.draft')} · {editing.name || t('skills.name')}
            </button>
          )}
        </nav>
        <div className="skill-manager-content">
          {error && <p role="status">{error}</p>}
          {editing ? (
            <>
              <div className="skill-editor-top">
                <header className="skill-editor-heading">
                  <h2>{editing.name || t('skills.draft')}</h2>
                  <span>
                    {t(builtin ? 'skills.builtin' : 'skills.mine')} · v{editing.version}{' '}
                    {dirty ? ' · ' + t('skills.unsaved') : ''}
                  </span>
                </header>
                <div className="skill-editor-actions">
                <button
                  className="secondary"
                  disabled={working}
                  onClick={() =>
                    leave(() => {
                      const creator = skills.find((s) => s.id === 'builtin-creator')
                      if (creator) void run(creator)
                    })
                  }
                >
                  {t('skills.useCreator')}
                </button>
                <button
                  className="secondary"
                  disabled={working}
                  onClick={() =>
                    leave(() =>
                      change({
                        ...editing,
                        id: 'draft-copy',
                        tools: editing.tools.filter((tool) => tool !== 'draft_skill'),
                      }),
                    )
                  }
                >
                  {t('skills.editCopy')}
                </button>
                {!builtin && !editing.id.startsWith('draft-') && (
                  <button
                    className="secondary"
                    disabled={working}
                    onClick={() =>
                      setConfirm({
                        title: t('skills.delete'),
                        message: t('skills.deleteHelp'),
                        confirm: () => void remove(),
                      })
                    }
                  >
                    {t('skills.delete')}
                  </button>
                )}
                </div>
              </div>
              <fieldset className="skill-editor-fields" disabled={working || builtin}>
                <section className="skill-editor">
                  <div className="skill-editor-main">
                    <div className="skill-editor-section skill-editor-identity">
                      <label>
                        {t('skills.name')}
                        <input value={editing.name} maxLength={160} onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
                      </label>
                      <label>
                        {t('skills.description')}
                        <input value={editing.description} maxLength={1000} onChange={(event) => setEditing({ ...editing, description: event.target.value })} />
                      </label>
                    </div>
                    <div className="skill-editor-section">
                      <fieldset disabled={working}>
                        <legend>{t('skills.tools')}</legend>
                        <div className="skill-tool-grid">
                          {[...new Set(['create_images', 'list_images', 'view_image', 'read_webpage', ...editing.tools])].map((tool) => (
                            <label key={tool}>
                              <input type="checkbox" checked={editing.tools.includes(tool)} onChange={(event) => setEditing({ ...editing, tools: event.target.checked ? [...editing.tools, tool] : editing.tools.filter((value) => value !== tool) })} />
                              {tool}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    </div>
                    <div className="skill-editor-section">
                      <fieldset disabled={working}>
                        <legend>{t('skills.requirements')}</legend>
                        <div className="skill-requirement-grid">
                          <label>{t('skills.minImages')}<input type="number" min="0" max="6" value={editing.requirements?.minImages ?? 0} onChange={(event) => setEditing({ ...editing, requirements: { ...(editing.requirements || { minImages: 0, maxImages: 6 }), minImages: Number(event.target.value) } })} /></label>
                          <label>{t('skills.maxImages')}<input type="number" min="0" max="6" value={editing.requirements?.maxImages ?? 6} onChange={(event) => setEditing({ ...editing, requirements: { ...(editing.requirements || { minImages: 0, maxImages: 6 }), maxImages: Number(event.target.value) } })} /></label>
                        </div>
                      </fieldset>
                    </div>
                  </div>
                  <div className="skill-editor-section skill-instructions">
                    <div className="skill-instructions-heading"><strong>{t('skills.instructions')}</strong><span>Markdown</span></div>
                    <p className="muted">{t('skills.templateHelp')}</p>
                    <textarea rows={18} maxLength={20000} value={editing.instructions} onChange={(event) => setEditing({ ...editing, instructions: event.target.value })} />
                  </div>
                </section>
              </fieldset>
              <footer className="skill-manager-footer">
                <span>{t(builtin ? 'skills.readOnly' : 'skills.snapshotHelp')}</span>
                <button className="secondary" disabled={working} onClick={() => void run(editing)}>
                  {t('skills.testNewChat')}
                </button>
                {!builtin && (
                  <button className="primary" disabled={working} onClick={() => void save()}>
                    {t('skills.save')}
                  </button>
                )}
              </footer>
            </>
          ) : (
            <div className="skill-manager-empty">
              <h2>{t('skills.manage')}</h2>
              <p>{t('skills.manageHelp')}</p>
              <button
                className="secondary"
                disabled={working || !skills.some((s) => s.id === 'builtin-creator')}
                onClick={() => {
                  const creator = skills.find((s) => s.id === 'builtin-creator')
                  if (creator) void run(creator)
                }}
              >
                {t('skills.useCreator')}
              </button>
            </div>
          )}
        </div>
      </div>
      {confirm && <ConfirmDialog state={confirm} onCancel={() => setConfirm(null)} />}
    </section>
  )
}
