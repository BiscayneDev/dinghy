import { createServerClient } from '@/lib/supabase/server'
import { decideHeldNote, decidePendingTarget } from '@/lib/files/deliverable-intent'
import { fileUrlOf } from '@/lib/files/origin'
import { GATEWAY_URL, SHIPYARD_API_KEY } from './config'
import { intakeRedo } from './redo-intake'
import { realIntakeDeps } from './redo-intake-runtime'
import { closeRedoPending, type PendingRedo } from './redo-jobs'

/**
 * The user was asked which page a complaint was about. Their next message picks one (native reply, or one bounded judgment on their words),
 * and the kept complaint, as the user's own stored message, goes to the same intake a direct complaint would use. Returns the reply to send,
 * or null when the message is not an answer (it is then ordinary chat and the kept complaint waits until it expires).
 */
export async function resolvePendingRedo(chatGuid: string, text: string, replyTo: { text: string } | undefined, pending: PendingRedo, signal?: AbortSignal): Promise<string | null> {
    const repliedUrl = replyTo?.text ? fileUrlOf(replyTo.text) : null
    let idx = repliedUrl ? pending.files.findIndex((f) => f.url === repliedUrl) : -1
    if (idx < 0) {
        const d = await decidePendingTarget({ gatewayUrl: GATEWAY_URL, apiKey: SHIPYARD_API_KEY ?? '', answer: text, pages: pending.files.map((f) => f.title), signal: signal ?? AbortSignal.timeout(8000) })
        if (d === 'neither') { await closeRedoPending(pending.userId, chatGuid, pending.id, 'dropped').catch(() => false); return null }
        if (d === null) return null
        idx = d
    }
    const file = pending.files[idx]
    const { data } = await createServerClient().from('spectrum_messages').select('content').eq('id', pending.noteId).eq('chat_guid', chatGuid).eq('role', 'user').maybeSingle()
    const complaint = (data as { content?: string } | null)?.content
    if (!complaint) { await closeRedoPending(pending.userId, chatGuid, pending.id, 'dropped').catch(() => false); return null }
    // The answer may carry a correction ('the hotel one, but 14-17 March'): keep it as an additional note of the user's own.
    const answerNote = await createServerClient().from('spectrum_messages').select('id').eq('chat_guid', chatGuid).eq('role', 'user').eq('content', text).order('created_at', { ascending: false }).limit(1).then((r) => { const id = (r.data as { id?: string | number }[] | null)?.[0]?.id; return id == null ? null : String(id) }, () => null)
    const reply = await intakeRedo(chatGuid, file.url, complaint, realIntakeDeps(() => decideHeldNote({ gatewayUrl: GATEWAY_URL, apiKey: SHIPYARD_API_KEY ?? '', request: complaint, context: '[]', signal: AbortSignal.timeout(8000) })), { replied: file.url, candidates: [], complaintNoteId: pending.noteId, ...(answerNote ? { extraNoteId: answerNote } : {}) })
    await closeRedoPending(pending.userId, chatGuid, pending.id, 'resolved').catch(() => false)
    return reply
}
