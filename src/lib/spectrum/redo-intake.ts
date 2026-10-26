import { bindLegacyOrigin, type ChatRow, type LegacyOrigin, type RunStage } from './legacy-origin'
import type { HeldNoteVerdict } from '@/lib/files/deliverable-intent'
import type { UpsertResult } from './redo-jobs'

/**
 * A correction after a delivered file. It never runs the redo here and never waits: it records the work as a durable job
 * (or adds to / cancels the active one) and answers truthfully. The job worker does the rest.
 */
export interface RedoFileRow { id: string; created_at: string; origin_request: string | null; origin_google_derived: boolean; origin_kind: string | null; kind: string | null }
export interface IntakeDeps {
    userId(chatGuid: string): Promise<string | null>
    file(userId: string, chatGuid: string, url: string): Promise<RedoFileRow | null>
    legacy(file: RedoFileRow, chatGuid: string): Promise<{ origin: LegacyOrigin; google: boolean } | null>
    saveLegacyOrigin(userId: string, chatGuid: string, file: RedoFileRow, request: string, google: boolean, evidence: { runId: string; messageId: string | null }): Promise<boolean>
    noteId(chatGuid: string, text: string): Promise<string | null>
    active(userId: string, chatGuid: string): Promise<{ id: string; phase: string } | null | 'unknown'>
    upsert(userId: string, chatGuid: string, fileId: string, noteId: string | null): Promise<UpsertResult>
    cancel(userId: string, chatGuid: string, fileId: string): Promise<{ status: string; phase?: string } | null>
    heldVerdict(): Promise<HeldNoteVerdict | null>
}

const COULD_NOT_START = 'I could not start the redo just now, so nothing was changed.'
export const LATE_PHASES = new Set(['publishing', 'published', 'sending', 'sent'])

export async function intakeRedo(chatGuid: string, fileUrl: string | null, text: string, deps: IntakeDeps): Promise<string> {
    if (!fileUrl) return 'I could not find the page you mean, so I have not redone it. Nothing was changed.'
    const userId = await deps.userId(chatGuid).catch(() => null)
    const file = userId ? await deps.file(userId, chatGuid, fileUrl).catch(() => null) : null
    if (!userId || !file) return 'I could not find the page you mean, so I have not redone it. Nothing was changed.'
    if (!file.origin_request) {
        const found = await deps.legacy(file, chatGuid).catch(() => null)
        if (!found || !found.origin.ok) return 'I could not tie that page back to the request that made it, so I have not redone it. Nothing was changed.'
        const saved = await deps.saveLegacyOrigin(userId, chatGuid, file, found.origin.request, found.google, { runId: found.origin.evidence.runId, messageId: found.origin.evidence.messageId }).catch(() => false)
        if (!saved) return COULD_NOT_START
    }
    const note = await deps.noteId(chatGuid, text).catch(() => null)
    if (!note) return COULD_NOT_START
    const active = await deps.active(userId, chatGuid)
    if (active === 'unknown') return COULD_NOT_START
    if (active) {
        const verdict = (await deps.heldVerdict().catch(() => null)) ?? 'new_instruction'
        if (verdict === 'repeat') return 'Still on it. That is already covered by the redo I am working on.'
        if (verdict === 'stop') {
            const c = await deps.cancel(userId, chatGuid, file.id)
            if (!c) return 'I could not stop that redo just now, so it may still arrive.'
            if (c.status === 'none') return 'There is no redo running for that page.'
            if (c.status === 'cancelled') return 'Stopped before it started. Nothing will be sent from it.'
            if (c.phase && LATE_PHASES.has(c.phase)) return 'I asked it to stop, but that version may already have gone out. I cannot unsend it.'
            return 'Stopping it now. Nothing more will be sent from it.'
        }
        const r = await deps.upsert(userId, chatGuid, file.id, note)
        if (r.status !== 'appended' && r.status !== 'created') return 'I could not add that to the redo just now, so it is not in it. Nothing was changed.'
        return r.status === 'appended' && r.phase && LATE_PHASES.has(r.phase)
            ? 'Got it. The version in progress is already on its way out without that, so I will make one more version with your note and send it.'
            : 'Got it. I am adding that to the version I am building now.'
    }
    const r = await deps.upsert(userId, chatGuid, file.id, note)
    if (r.status === 'created' || r.status === 'appended') return 'On it. I am rebuilding that page and will send it here when it is ready.'
    return COULD_NOT_START
}

/** Real stage and message reads for the legacy binder. Read-only. */
export async function loadLegacyEvidence(db: { from: (t: string) => any }, chatGuid: string, file: RedoFileRow): Promise<{ stages: RunStage[]; rows: ChatRow[]; google: boolean } | null> {
    const at = Date.parse(file.created_at)
    if (!Number.isFinite(at)) return null
    const from = new Date(at - 15 * 60_000).toISOString(), to = new Date(at + 60_000).toISOString()
    const [st, ms] = await Promise.all([
        db.from('dinghy_run_stages').select('run_id, message_id, stage, detail, created_at').eq('chat_guid', chatGuid).gte('created_at', from).lte('created_at', to).limit(500),
        db.from('spectrum_messages').select('id, role, content, created_at, google_derived').eq('chat_guid', chatGuid).in('role', ['user', 'assistant']).gte('created_at', from).lte('created_at', to).order('created_at', { ascending: true }).limit(200),
    ])
    if (st.error || ms.error) return null
    const stages: RunStage[] = (st.data ?? []).map((r: any) => ({ run_id: r.run_id, message_id: r.message_id, stage: r.stage, detail: r.detail, at: Date.parse(r.created_at) }))
    const rows: ChatRow[] = (ms.data ?? []).map((r: any) => ({ id: String(r.id), role: r.role, content: String(r.content), at: Date.parse(r.created_at) }))
    const google = (ms.data ?? []).some((r: any) => r.google_derived)
    return { stages, rows, google }
}
export { bindLegacyOrigin }
