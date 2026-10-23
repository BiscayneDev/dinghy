import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { recordGrantIfAlways, redeemPairing } from '@/lib/dock/service'
import { dockDepsViaOutbox } from '@/lib/dock/runtime'
import { resolveConnectIdentity, sameOriginRequest, verifyConsentNonce } from '@/lib/dock/connect'

export const dynamic = 'force-dynamic'

const CODE_RE = /^[A-Za-z0-9-]{6,20}$/

/**
 * The consent decision behind /connect/dock. Same-origin + session + a nonce that was rendered only
 * into the owner's own consent page. The link binds to the owner's bound Dinghy thread, never to a
 * chat from the request body. "always" records the workspace grant only after Dock's own redemption
 * response names the workspace - never from the unauthenticated URL hint.
 */
export async function POST(request: Request): Promise<NextResponse> {
    if (!sameOriginRequest(request)) return NextResponse.json({ error: 'Bad origin' }, { status: 403 })

    let body: { pair?: unknown; decision?: unknown; nonce?: unknown } = {}
    try {
        body = (await request.json()) as typeof body
    } catch {
        return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    const code = typeof body.pair === 'string' ? body.pair.trim().toUpperCase() : ''
    const decision = body.decision
    const nonce = typeof body.nonce === 'string' ? body.nonce : ''
    if (!CODE_RE.test(code)) return NextResponse.json({ error: 'This link is missing a valid pairing code.' }, { status: 400 })
    if (decision !== 'once' && decision !== 'always' && decision !== 'deny') {
        return NextResponse.json({ error: 'Unknown decision' }, { status: 400 })
    }

    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    if (!verifyConsentNonce(session.userId, code, nonce)) {
        return NextResponse.json({ error: 'This consent page went stale. Reload it and decide again.' }, { status: 403 })
    }

    if (decision === 'deny') return NextResponse.json({ ok: true, status: 'denied' })

    const identity = await resolveConnectIdentity(session.userId)
    if (!identity) return NextResponse.json({ error: 'This account has no Dinghy thread to connect.' }, { status: 409 })

    try {
        const deps = dockDepsViaOutbox()
        const out = await redeemPairing(deps, { chatGuid: identity.chatGuid, code, userId: session.userId })
        if (!out.ok) {
            const msg =
                out.reason === 'already_linked'
                    ? null // handled below with a dedicated status
                    : out.reason === 'used'
                      ? 'That code was already used. Make a fresh connect link in Dock settings.'
                      : out.reason === 'unreachable'
                        ? "Dock didn't answer. Try again in a minute."
                        : out.reason === 'expired'
                          ? 'That code expired. Make a fresh connect link in Dock settings.'
                          : out.reason === 'invalid'
                            ? "That code didn't work. Make a fresh connect link in Dock settings."
                            : "Dock sent back something unexpected. Try again in a minute."
            if (out.reason === 'already_linked') return NextResponse.json({ ok: true, status: 'already' })
            const status = out.reason === 'expired' ? 410 : out.reason === 'unreachable' ? 502 : 400
            return NextResponse.json({ ok: false, status: 'failed', error: msg }, { status })
        }
        const grant = await recordGrantIfAlways(deps, { decision, chatGuid: identity.chatGuid, workspaceRef: out.workspaceRef })
        return NextResponse.json({ ok: true, status: 'connected', chief: out.chief, grant })
    } catch (err) {
        console.error('dock connect decide failed:', err instanceof Error ? err.message : String(err))
        return NextResponse.json({ ok: false, status: 'failed', error: 'Something went wrong. Try again in a moment.' }, { status: 500 })
    }
}
