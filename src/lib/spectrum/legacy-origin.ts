/**
 * Original request for a file made BEFORE origin_request existed. Binds by stored identifiers only, with a strict time rule, and keeps the user's words verbatim.
 * Not a stored foreign key: it is a correlation, and the recovery evidence (run id, message id, file id) is returned so it can be audited. Anything ambiguous is a specific gap.
 */
export interface RunStage { run_id: string; message_id: string | null; stage: string; detail: string | null; at: number }
export interface ChatRow { id: string; role: 'user' | 'assistant'; content: string; at: number }
export type LegacyOrigin =
    | { ok: true; request: string; evidence: { fileId: string; runId: string; messageId: string | null; userRowId: string } }
    | { ok: false; gap: 'no_deliverable_run' | 'ambiguous_run' | 'no_user_message' | 'ambiguous_user_message' | 'no_request_text' }

const WINDOW_MS = 5_000

export function bindLegacyOrigin(file: { id: string; createdAt: number }, stages: RunStage[], rows: ChatRow[]): LegacyOrigin {
    // A deliverable run that completed within the window of the file row.
    const done = stages.filter((s) => s.stage === 'reply_ready' && /^deliverable:[a-z]+:completed$/.test(s.detail ?? '') && Math.abs(s.at - file.createdAt) <= WINDOW_MS)
    const runs = [...new Set(done.map((s) => s.run_id))]
    if (runs.length === 0) return { ok: false, gap: 'no_deliverable_run' }
    if (runs.length > 1) return { ok: false, gap: 'ambiguous_run' }
    const runId = runs[0]
    const own = stages.filter((s) => s.run_id === runId)
    const startedAt = Math.min(...own.map((s) => s.at))
    const messageId = own.find((s) => s.message_id)?.message_id ?? null
    // The user message that started it: created just before the run, with no other user message between it and the file.
    const users = rows.filter((r) => r.role === 'user' && r.at <= startedAt + WINDOW_MS)
    const starter = users.filter((r) => startedAt - r.at <= WINDOW_MS && r.at <= startedAt + 1_000)
    if (starter.length === 0) return { ok: false, gap: 'no_user_message' }
    const latest = starter.reduce((a, b) => (b.at > a.at ? b : a))
    if (starter.filter((r) => r.at === latest.at).length > 1) return { ok: false, gap: 'ambiguous_user_message' }
    if (rows.some((r) => r.role === 'user' && r.at > latest.at && r.at <= file.createdAt)) return { ok: false, gap: 'ambiguous_user_message' }
    if (!latest.content.trim()) return { ok: false, gap: 'no_request_text' }
    return { ok: true, request: latest.content, evidence: { fileId: file.id, runId, messageId, userRowId: latest.id } }
}
