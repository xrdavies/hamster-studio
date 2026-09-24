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
        <h3>{state.title}</h3>
        <p>{state.message}</p>
        <div>
          <button className="secondary" onClick={onCancel}>
            取消
          </button>
          <button className="primary danger" onClick={state.confirm}>
            确认
          </button>
        </div>
      </section>
    </div>
  )
}
