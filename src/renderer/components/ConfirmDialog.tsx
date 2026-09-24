import { t } from '../i18n'
export type ConfirmState = { title: string; message: string; confirm: () => void }

export default function ConfirmDialog({
  state,
  onCancel,
}: {
  state: ConfirmState
  onCancel: () => void
}) {
  return (
    <div className="confirm-backdrop">
      <section className="confirm-dialog">
        <h3>{t(state.title)}</h3>
        <p>{t(state.message)}</p>
        <div>
          <button className="secondary" onClick={onCancel}>
            {t('取消')}
          </button>
          <button className="primary danger" onClick={state.confirm}>
            {t('确认')}
          </button>
        </div>
      </section>
    </div>
  )
}
