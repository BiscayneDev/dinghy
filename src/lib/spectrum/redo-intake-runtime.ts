import { createServerClient } from '@/lib/supabase/server'
import { briefableUserId } from './briefing'
import { activeRedoJobFor, cancelRedoJob, openRedoPending, upsertRedoJob } from './redo-jobs'
import { bindLegacyOrigin, loadLegacyEvidence, type IntakeDeps } from './redo-intake'
import type { HeldNoteVerdict } from '@/lib/files/deliverable-intent'

export function realIntakeDeps(heldVerdict: () => Promise<HeldNoteVerdict | null>): IntakeDeps {
    const db = createServerClient()
    return {
        userId: (chatGuid) => briefableUserId(chatGuid).catch(() => null),
        async file(userId, chatGuid, url) {
            const { data } = await db.from('dinghy_files').select('id, created_at, origin_request, origin_google_derived, origin_kind, kind, lineage_id, title, expires_at')
                .eq('user_id', userId).eq('url', url).or(`chat_guid.eq.${chatGuid.replace(/[,()]/g, '')},chat_guid.is.null`).is('deleted_at', null).is('revoked_at', null)
                .order('created_at', { ascending: false }).limit(1)
            return ((data ?? [])[0] as never) ?? null
        },
        async legacy(file, chatGuid) {
            const ev = await loadLegacyEvidence(db, chatGuid, file)
            if (!ev) return null
            return { origin: bindLegacyOrigin({ id: file.id, createdAt: Date.parse(file.created_at) }, ev.stages, ev.rows), google: ev.google }
        },
        async saveLegacyOrigin(userId, chatGuid, file, request, google, evidence) {
            const { data, error } = await db.from('dinghy_files').update({ origin_request: request, origin_google_derived: google, origin_run_id: evidence.runId, origin_message_id: evidence.messageId, chat_guid: chatGuid })
                .eq('id', file.id).eq('user_id', userId).is('origin_request', null).select('id')
            return !error && (data?.length ?? 0) > 0
        },
        async noteId(chatGuid, text) {
            const { data } = await db.from('spectrum_messages').select('id').eq('chat_guid', chatGuid).eq('role', 'user').eq('content', text).order('created_at', { ascending: false }).limit(1)
            const id = (data as { id?: string | number }[] | null)?.[0]?.id
            return id == null ? null : String(id)
        },
        active: activeRedoJobFor, upsert: upsertRedoJob, cancel: cancelRedoJob, heldVerdict, openPending: openRedoPending,
    }
}
