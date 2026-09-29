import { expect, it } from 'vitest'
import { logEntries } from './logEntries'
it('keeps successful exchanges available and links errors only to their own request', () => {
  const rows = logEntries(
    [
      { stage: 'http.request', metadata: { context: { requestId: 'a' }, body: 'prompt' } },
      { stage: 'http.request', metadata: { context: { requestId: 'b' }, body: 'unrelated' } },
      { level: 'error', metadata: { context: { requestId: 'a' }, error: 'reset' } },
      { metadata: { status: 503 } },
      { metadata: { success: false } },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n'),
  )
  expect(rows.filter((row) => row.error)).toHaveLength(3)
  expect(rows[2].related).toContain('prompt')
  expect(rows[2].related).not.toContain('unrelated')
})
