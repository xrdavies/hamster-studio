export function logEntries(text: string) {
  const rows = text
    .split('\n')
    .filter(Boolean)
    .map((raw) => {
      try {
        return { raw, value: JSON.parse(raw) }
      } catch {
        return { raw, value: {} }
      }
    })
  return rows.map((row) => {
    const metadata = row.value.metadata || {}
    const error =
      row.value.level === 'error' ||
      metadata.success === false ||
      !!metadata.error ||
      metadata.status >= 400
    const context = metadata.context || metadata
    const related = error
      ? rows
          .filter((other) => {
            if (other === row) return false
            const candidate = other.value.metadata?.context || other.value.metadata || {}
            return context.requestId
              ? candidate.requestId === context.requestId
              : context.messageId && candidate.messageId === context.messageId
          })
          .map((other) => other.raw)
          .join('\n')
      : ''
    return { raw: row.raw, error, related }
  })
}
