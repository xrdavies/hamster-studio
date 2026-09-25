import { translateMessage, t } from '../i18n'
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
        <h3>{translateMessage(state.title)}</h3>
        <p>{translateMessage(state.message)}</p>
        <div>
          <button className="secondary" onClick={onCancel}>
            {t('ui.cancel')}
          </button>
          <button className="primary danger" onClick={state.confirm}>
            {t('ui.confirm')}
          </button>
        </div>
      </section>
    </div>
  )
}
