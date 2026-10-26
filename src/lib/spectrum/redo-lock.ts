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
