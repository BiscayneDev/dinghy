import { createHash, randomUUID } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'

/** Itinerary jobs run up to 240s (handler deadline); a lock older than this is a dead job, not a running one. */
export const REDO_LOCK_STALE_MS = 300_000

export type RedoLock =
    | { state: 'acquired'; claimId: string; release: () => Promise<void> }
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
    if (first) return { state: 'acquired', claimId, release }
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
        return second ? { state: 'acquired', claimId, release } : { state: 'held' }
    } catch {
        return { state: 'unknown' }
    }
}

/** Read-only: is a live redo holding this file's lock? A stale lock counts as free (acquire recovers it). */
export async function peekRedoLock(chatGuid: string, hash: string, now: () => number = Date.now): Promise<'free' | 'held' | 'unknown'> {
    return (await peekRedoLockInfo(chatGuid, hash, now)).state
}

export async function peekRedoLockInfo(chatGuid: string, hash: string, now: () => number = Date.now): Promise<{ state: 'free' | 'held' | 'unknown'; claimId?: string }> {
    try {
        const { data, error } = await createServerClient().from('spectrum_inbound_dedupe').select('received_at,claim_id').eq('message_id', `redo-lock:${hash}`).limit(1)
        if (error) return { state: 'unknown' }
        const row = (data as { received_at?: string; claim_id?: string }[] | null)?.[0]
        if (!row) return { state: 'free' }
        const age = now() - Date.parse(row.received_at ?? '')
        if (!Number.isFinite(age)) return { state: 'unknown' }
        return age <= REDO_LOCK_STALE_MS ? { state: 'held', claimId: row.claim_id } : { state: 'free' }
    } catch {
        return { state: 'unknown' }
    }
}

/** Wait (bounded) for the running redo to release. */
const redoWaitMs = () => Number(process.env.DINGHY_REDO_WAIT_MS) || 60_000

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

/**
 * Signals from later messages to the running redo, on the same atomic facility: one row per signal, keyed by the running job's own claim id so they can never leak into a later job. Rows hold only a content hash; the text stays in the stored chat. The owning job reads them at its gates (each loop turn, before it publishes) and again before it sends.
 */
const sha = (t: string) => createHash('sha1').update(t).digest('hex').slice(0, 16)
export const contentHash = sha
export async function recordRedoSignal(chatGuid: string, jobClaimId: string, kind: 'note' | 'cancel', text: string): Promise<boolean> {
    try {
        const { data, error } = await createServerClient().rpc('claim_inbound_delivery', { p_message_id: `redo-${kind}:${jobClaimId}:${sha(text)}`, p_chat_guid: chatGuid, p_claim_id: randomUUID() })
        return !error && (data === true || data === false)
    } catch {
        return false
    }
}
export async function markRedoClosed(chatGuid: string, jobClaimId: string): Promise<void> {
    await recordRedoSignal(chatGuid, jobClaimId, 'note', `closed:${jobClaimId}`).catch(() => false)
}
export async function readRedoSignals(jobClaimId: string): Promise<{ noteHashes: string[]; cancelled: boolean; closed: boolean }> {
    try {
        const db = createServerClient()
        const { data } = await db.from('spectrum_inbound_dedupe').select('message_id').like('message_id', `redo-%:${jobClaimId}:%`)
        const ids = ((data as { message_id: string }[] | null) ?? []).map((r) => r.message_id)
        const closedHash = sha(`closed:${jobClaimId}`)
        return {
            noteHashes: ids.filter((i) => i.startsWith('redo-note:') && !i.endsWith(`:${closedHash}`)).map((i) => i.split(':')[2]),
            cancelled: ids.some((i) => i.startsWith('redo-cancel:')),
            closed: ids.some((i) => i.endsWith(`:${closedHash}`)),
        }
    } catch {
        return { noteHashes: [], cancelled: false, closed: false }
    }
}
