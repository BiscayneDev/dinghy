import { createServerClient } from '@/lib/supabase/server'

/**
 * Client for the durable redo job RPCs (migration 077). Ids and states only; note text stays in the user's own stored messages.
 * Every call passes user and chat so the database enforces ownership. A failed or malformed call is "unknown", never "ok".
 */
export type UpsertResult =
    | { status: 'created' | 'appended'; jobId: string; revision: number; phase?: string }
    | { status: 'refused'; reason: 'file' | 'chat' | 'note' | 'no_origin' | 'race' | 'no_authorization' }
    | { status: 'unknown' }
export type FenceResult = 'ok' | 'cancelled' | 'stale' | 'lost' | 'unknown'
export type CloseResult = 'done' | 'requeued' | 'note_unapplied' | 'lost' | 'unknown'
export interface ClaimedJob {
    id: string; user_id: string; chat_guid: string; file_id: string; lineage_id: string; claim_id: string; op_id: string
    note_ids: string[]; note_revision: number; consumed_revision: number; passes: number; resumes: number
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T | null> {
    try {
        const { data, error } = await createServerClient().rpc(fn, args)
        if (error) { console.error(`[redo-jobs] ${fn} failed:`, error.message); return null }
        return (Array.isArray(data) ? data[0] : data) as T
    } catch (err) {
        console.error(`[redo-jobs] ${fn} threw:`, err instanceof Error ? err.message : String(err))
        return null
    }
}

export async function upsertRedoJob(userId: string, chatGuid: string, fileId: string, noteId: string | null): Promise<UpsertResult> {
    const r = await rpc<{ status?: string; job_id?: string; revision?: number; phase?: string; reason?: string }>('upsert_redo_job', { p_user: userId, p_chat: chatGuid, p_file: fileId, p_note: noteId, p_require_auth: redoMode() === 'proof' })
    if (!r?.status) return { status: 'unknown' }
    if ((r.status === 'created' || r.status === 'appended') && r.job_id) return { status: r.status, jobId: r.job_id, revision: r.revision ?? 0, ...(r.phase ? { phase: r.phase } : {}) }
    if (r.status === 'refused') return { status: 'refused', reason: (r.reason as 'file') ?? 'file' }
    return { status: 'unknown' }
}
export async function cancelRedoJob(userId: string, chatGuid: string, fileId: string): Promise<{ status: string; phase?: string } | null> {
    return rpc('redo_cancel', { p_user: userId, p_chat: chatGuid, p_file: fileId })
}
export async function claimRedoJob(leaseMs = 330_000): Promise<ClaimedJob | null> {
    const r = await rpc<ClaimedJob>('claim_redo_job', { p_lease_ms: leaseMs })
    return r?.id ? r : null
}
export async function advanceRedoJob(jobId: string, claimId: string, phase: 'building' | 'publishing' | 'published' | 'sending' | 'sent', consumedRevision: number): Promise<FenceResult> {
    const r = await rpc<string>('redo_advance', { p_job: jobId, p_claim: claimId, p_phase: phase, p_consumed: consumedRevision })
    return r === 'ok' || r === 'cancelled' || r === 'stale' || r === 'lost' ? r : 'unknown'
}
export async function closeRedoJob(jobId: string, claimId: string): Promise<CloseResult> {
    const r = await rpc<string>('redo_close', { p_job: jobId, p_claim: claimId })
    return r === 'done' || r === 'requeued' || r === 'note_unapplied' || r === 'lost' ? r : 'unknown'
}
export async function notifyRedoOutcome(jobId: string, text: string): Promise<boolean> {
    return (await rpc<boolean>('redo_notify', { p_job: jobId, p_text: text })) === true
}
export async function redoFileForOp(userId: string, jobId: string): Promise<string | null> {
    return (await rpc<string | null>('redo_file_for_op', { p_user: userId, p_job: jobId })) ?? null
}
export async function failRedoJob(jobId: string, claimId: string, reason: string): Promise<boolean> {
    return (await rpc<boolean>('redo_fail', { p_job: jobId, p_claim: claimId, p_reason: reason })) === true
}
export async function activeRedoJobFor(userId: string, lineageId: string): Promise<{ id: string; phase: string } | null | 'unknown'> {
    try {
        const { data, error } = await createServerClient().from('dinghy_redo_jobs').select('id, phase').eq('user_id', userId).eq('lineage_id', lineageId).in('state', ['queued', 'running']).limit(1)
        if (error) return 'unknown'
        return (data?.[0] as { id: string; phase: string } | undefined) ?? null
    } catch { return 'unknown' }
}

/** Off by default. While off, no job is ever created (a job nobody runs would be a promise nobody keeps). */
export const redoMode = (): 'off' | 'proof' | 'owner' | 'on' => (['on', 'owner', 'proof'].includes(process.env.DINGHY_REDO_JOBS ?? '') ? (process.env.DINGHY_REDO_JOBS as 'on' | 'owner' | 'proof') : 'off')
/** Worker, kick and cron run in every mode except off. */
export const redoJobsEnabled = (): boolean => redoMode() !== 'off'
/** Who may create jobs. 'on': everyone. 'owner': the chats in DINGHY_REDO_OWNER_CHATS (ongoing, needs its own approval). 'proof': only DINGHY_REDO_PROOF_CHAT, and only while an armed one-shot authorization or its active job exists. Anything else: nobody. */
export async function redoJobsAllowed(chatGuid: string): Promise<boolean> {
    const m = redoMode()
    if (m === 'on') return true
    if (m === 'owner') return (process.env.DINGHY_REDO_OWNER_CHATS ?? '').split(',').map((x) => x.trim()).filter(Boolean).includes(chatGuid)
    if (m !== 'proof' || !chatGuid || process.env.DINGHY_REDO_PROOF_CHAT !== chatGuid) return false
    try {
        const db = createServerClient()
        const armed = await db.from('dinghy_redo_authorizations').select('id').eq('chat_guid', chatGuid).eq('state', 'armed').limit(1)
        if (armed.error) return false
        if (armed.data?.length) return true
        const active = await db.from('dinghy_redo_jobs').select('id').eq('chat_guid', chatGuid).in('state', ['queued', 'running']).limit(1)
        return !active.error && Boolean(active.data?.length)
    } catch { return false }
}

export const TERMINAL_TEXT: Record<string, string> = {
    outcome_unknown: 'I could not confirm whether the redo of that page went out. I have not retried it, so it may or may not reach you. The earlier version is unchanged.',
    resume_exhausted: 'I could not finish the redo of that page. Nothing new was sent.',
}
/** Blocked or failed jobs that no one has told the user about yet. Deduped again inside redo_notify. */
export async function unreportedTerminalJobs(): Promise<{ id: string; failure: string | null }[]> {
    try {
        const { data, error } = await createServerClient().from('dinghy_redo_jobs').select('id, failure').in('state', ['blocked', 'failed']).is('notified_key', null).limit(20)
        return error ? [] : ((data ?? []) as { id: string; failure: string | null }[])
    } catch { return [] }
}
