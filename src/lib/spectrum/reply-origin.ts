import type { IntakeDeps } from './redo-intake'
import { googleTtlDays } from './google-retention'

export type RepliedPageRequest =
    | { ok: true; request: string }
    | { ok: false; reason: 'no_user' | 'page_not_found' | 'origin_unrecoverable' | 'origin_not_saved' | 'expired' | 'retention' }

/**
 * The original request behind a page the user natively replied to, for a turn that is not a redo. Same source and same strict checks the redo intake uses:
 * the page must belong to this user and this chat and be live, a stored origin is used verbatim, and a page made before origins were stored is bound only by
 * the strict legacy binder (and the binding is saved, with its Google-derived flag, so retention expiry applies to it). Anything ambiguous or missing is a refusal, never a guess.
 */
export async function recoverRepliedPageRequest(deps: IntakeDeps, chatGuid: string, url: string, now = Date.now()): Promise<RepliedPageRequest> {
    const userId = await deps.userId(chatGuid).catch(() => null)
    if (!userId) return { ok: false, reason: 'no_user' }
    const file = await deps.file(userId, chatGuid, url).catch(() => null)
    if (!file) return { ok: false, reason: 'page_not_found' }
    // Retention is applied before any read of source text: an expired page, or a Google-derived origin past the Google retention window, is never recovered
    // (not from the stored origin and not by re-binding the old chat rows the retention job may not have deleted yet).
    if (file.expires_at && Date.parse(file.expires_at) <= now) return { ok: false, reason: 'expired' }
    const pastGoogleTtl = now - Date.parse(file.created_at) > googleTtlDays() * 86_400_000
    if (file.origin_google_derived && pastGoogleTtl) return { ok: false, reason: 'retention' }
    if (file.origin_request?.trim()) return { ok: true, request: file.origin_request }
    const found = await deps.legacy(file, chatGuid).catch(() => null)
    if (!found || !found.origin.ok) return { ok: false, reason: 'origin_unrecoverable' }
    if (found.google && pastGoogleTtl) return { ok: false, reason: 'retention' }
    const saved = await deps.saveLegacyOrigin(userId, chatGuid, file, found.origin.request, found.google, { runId: found.origin.evidence.runId, messageId: found.origin.evidence.messageId }).catch(() => false)
    return saved ? { ok: true, request: found.origin.request } : { ok: false, reason: 'origin_not_saved' }
}

export const REPLY_ORIGIN_REFUSAL = 'I could not tell what that page was meant to be from, so I have not started anything. Nothing was changed. Send the whole request in one message and I will do it from that.'
export const PENDING_PAUSED_REPLY = 'Your earlier note is kept, but rebuilding pages is paused right now, so I have not changed anything.'

export function withPageRequest(origin: string, latest: string): string {
    return origin.includes(latest) ? origin : `${origin}\n\nLatest message from the user about that page: ${latest}`
}
