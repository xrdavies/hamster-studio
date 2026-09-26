import { useEffect, useRef, useState } from 'react'
import { X, Check, Sparkles } from 'lucide-react'
import { t, translateMessage } from '../i18n'
import type { Skill } from '../../shared/types'
export const skillName = (skill: Skill) =>
  skill.id === 'builtin-character-sheet' ? t('skills.characterName') : skill.name
export const skillDescription = (skill: Skill) =>
  skill.id === 'builtin-character-sheet'
    ? t('skills.characterDescription')
    : skill.id === 'builtin-creator'
      ? t('skills.creatorDescription')
      : skill.description
export default function SkillPanel({
  selected,
  onSelect,
  onClose,
}: {
  selected?: Skill | null
  onSelect: (skill: Skill | null) => Promise<void>
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [skills, setSkills] = useState<Skill[]>([])
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  useEffect(() => {
    dialog.current?.showModal()
    void window.studio
      .listSkills()
      .then(setSkills)
      .catch((e) => setError(String(e)))
  }, [])
  async function choose(skill: Skill | null) {
    setWorking(true)
    try {
      await onSelect(skill)
      onClose()
    } catch (e) {
      setError(translateMessage(String(e)))
    } finally {
      setWorking(false)
    }
  }
  const options =
    selected && !skills.some((s) => s.id === selected.id) ? [selected, ...skills] : skills
  return (
    <dialog
      className="skill-panel region-editor"
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault()
        if (!working) onClose()
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !working) onClose()
      }}
    >
      <header>
        <strong>{t('skills.pick')}</strong>
        <button className="icon" aria-label={t('ui.close')} disabled={working} onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="skill-list">
        {[null, ...options].map((skill) => (
          <div className="skill-row" key={skill?.id || 'none'}>
            <button
              className="skill-choice"
              disabled={working}
              aria-pressed={skill ? selected?.id === skill.id : !selected}
              onClick={() => void choose(skill)}
            >
              <Sparkles size={17} />
              <span>
                <strong>{skill ? skillName(skill) : t('skills.none')}</strong>
                <small>{skill ? skillDescription(skill) : t('skills.noneHelp')}</small>
              </span>
              {(skill ? selected?.id === skill.id : !selected) && <Check size={17} />}
            </button>
          </div>
        ))}
      </div>
      {error && <p role="status">{error}</p>}
    </dialog>
  )
}
