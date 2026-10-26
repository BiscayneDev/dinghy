import { createServerClient } from '@/lib/supabase/server'

/**
 * Client for the durable redo job RPCs (migration 077). Ids and states only; note text stays in the user's own stored messages.
 * Every call passes user and chat so the database enforces ownership. A failed or malformed call is "unknown", never "ok".
 */
export type UpsertResult =
    | { status: 'created' | 'appended'; jobId: string; revision: number; phase?: string }
    | { status: 'refused'; reason: 'file' | 'chat' | 'note' | 'no_origin' | 'race' }
    | { status: 'unknown' }
export type FenceResult = 'ok' | 'cancelled' | 'stale' | 'lost' | 'unknown'
export type CloseResult = 'done' | 'requeued' | 'note_unapplied' | 'lost' | 'unknown'
export interface ClaimedJob {
    id: string; user_id: string; chat_guid: string; file_id: string; claim_id: string; op_id: string
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
    const r = await rpc<{ status?: string; job_id?: string; revision?: number; phase?: string; reason?: string }>('upsert_redo_job', { p_user: userId, p_chat: chatGuid, p_file: fileId, p_note: noteId })
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
