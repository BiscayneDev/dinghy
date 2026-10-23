/**
 * Server helpers for the signed-in Dock consent page (/connect/dock).
 *
 * Identity: the web session (dock_session cookie) proves the Dinghy account; the account's bound
 * spectrum identity proves which iMessage thread the link will serve. A consent decision can only
 * ever bind the signed-in owner's own thread - there is no parameter that picks another chat.
 *
 * CSRF: the decide POST carries a stateless nonce = HMAC(ENCRYPTION_KEY, userId:sha256(code)).
 * It is rendered only into the same-origin consent page, so a cross-site form (which cannot read
 * that page) cannot produce it. The route also requires a same-origin Origin header.
 */

import { createHash, createHmac, timingSafeEqual } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'

export interface DockConnectIdentity {
    userId: string
    chatGuid: string
    /** Raw E.164 handle for the "signed in as" footer. */
    phone: string | null
}

/** The signed-in owner's bound Dinghy thread. Null when the account has no iMessage identity. */
export async function resolveConnectIdentity(userId: string): Promise<DockConnectIdentity | null> {
    const supabase = createServerClient()
    const { data } = await supabase
        .from('spectrum_identities')
        .select('chat_guid, handle')
        .eq('user_id', userId)
        .order('bound_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    const row = data as { chat_guid?: string; handle?: string } | null
    if (!row?.chat_guid) return null
    return { userId, chatGuid: row.chat_guid, phone: row.handle ?? null }
}

function secret(): string {
    const s = process.env.ENCRYPTION_KEY
    if (!s) throw new Error('ENCRYPTION_KEY is not set - cannot sign the consent nonce')
    return s
}

export function consentNonce(userId: string, code: string): string {
    const codeHash = createHash('sha256').update(code, 'utf8').digest('hex')
    return createHmac('sha256', secret()).update(`${userId}:${codeHash}`, 'utf8').digest('hex')
}

export function verifyConsentNonce(userId: string, code: string, nonce: string): boolean {
    if (!/^[0-9a-f]{64}$/.test(nonce)) return false
    const expected = Buffer.from(consentNonce(userId, code), 'utf8')
    const actual = Buffer.from(nonce, 'utf8')
    return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/** Browser POSTs carry Origin; require it to be this deployment's own origin. */
export function sameOriginRequest(request: Request): boolean {
    const origin = request.headers.get('origin')
    if (!origin) return false
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
    if (!host) return false
    try {
        return new URL(origin).host === host
    } catch {
        return false
    }
}
