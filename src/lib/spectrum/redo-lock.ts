import { randomUUID } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'

/** Itinerary jobs run up to 240s (handler deadline); a lock older than this is a dead job, not a running one. */
export const REDO_LOCK_STALE_MS = 300_000

export type RedoLock =
    | { state: 'acquired'; release: () => Promise<void> }
    | { state: 'held' }
    /** The database could not tell us whether a redo is running: start nothing, say so. */
    | { state: 'unknown' }

/**
 * Durable per-chat, per-delivered-file in-flight exclusion on the existing atomic facility (spectrum_inbound_dedupe plus claim_inbound_delivery, migrations 015/021): no schema change.
 * The claim lasts the whole job and is deleted on any terminal outcome (release). A lock older than REDO_LOCK_STALE_MS is recovered by compare-and-delete on its claim_id, so a job that died without releasing never blocks a redo for good, and two recoverers cannot both win.
 */
export async function acquireRedoLock(chatGuid: string, hash: string, now: () => number = Date.now): Promise<RedoLock> {
    const supabase = createServerClient()
    const key = `redo-lock:${hash}`
    const claimId = randomUUID()
    const tryClaim = async (): Promise<boolean | null> => {
        try {
            const { data, error } = await supabase.rpc('claim_inbound_delivery', { p_message_id: key, p_chat_guid: chatGuid, p_claim_id: claimId })
            return error ? null : data === true
        } catch {
            return null
        }
    }
    const release = async () => {
        try {
            await supabase.from('spectrum_inbound_dedupe').delete().eq('message_id', key).eq('claim_id', claimId)
        } catch (err) {
            console.error('redo lock release failed (stale recovery will clear it):', err instanceof Error ? err.message : String(err))
        }
    }
    const first = await tryClaim()
    if (first === null) return { state: 'unknown' }
    if (first) return { state: 'acquired', release }
    try {
        const { data, error } = await supabase.from('spectrum_inbound_dedupe').select('received_at,claim_id').eq('message_id', key).limit(1)
        const row = (data as { received_at?: string; claim_id?: string }[] | null)?.[0]
        if (error || !row?.received_at || !row.claim_id) return { state: 'unknown' }
        const age = now() - Date.parse(row.received_at)
        if (!Number.isFinite(age)) return { state: 'unknown' }
        if (age <= REDO_LOCK_STALE_MS) return { state: 'held' }
        await supabase.from('spectrum_inbound_dedupe').delete().eq('message_id', key).eq('claim_id', row.claim_id)
        const second = await tryClaim()
        if (second === null) return { state: 'unknown' }
        return second ? { state: 'acquired', release } : { state: 'held' }
    } catch {
        return { state: 'unknown' }
    }
}

/** Read-only: is a live redo holding this file's lock? A stale lock counts as free (acquire recovers it). */
export async function peekRedoLock(chatGuid: string, hash: string, now: () => number = Date.now): Promise<'free' | 'held' | 'unknown'> {
    try {
        const { data, error } = await createServerClient().from('spectrum_inbound_dedupe').select('received_at,claim_id').eq('message_id', `redo-lock:${hash}`).limit(1)
        if (error) return 'unknown'
        const row = (data as { received_at?: string }[] | null)?.[0]
        if (!row) return 'free'
        const age = now() - Date.parse(row.received_at ?? '')
        if (!Number.isFinite(age)) return 'unknown'
        return age <= REDO_LOCK_STALE_MS ? 'held' : 'free'
    } catch {
        return 'unknown'
    }
}

/** Wait (bounded) for the running redo to release. */
const redoWaitMs = () => Number(process.env.DINGHY_REDO_WAIT_MS) || 110_000

export async function waitForRedoRelease(chatGuid: string, hash: string, maxMs: number = redoWaitMs(), pollMs = Math.min(3000, Math.max(10, Math.floor(maxMs / 4)))): Promise<'released' | 'timeout' | 'unknown'> {
    const until = Date.now() + maxMs
    for (;;) {
        const s = await peekRedoLock(chatGuid, hash)
        if (s === 'free') return 'released'
        if (s === 'unknown') return 'unknown'
        if (Date.now() + pollMs > until) return 'timeout'
        await new Promise((r) => setTimeout(r, pollMs))
    }
}
