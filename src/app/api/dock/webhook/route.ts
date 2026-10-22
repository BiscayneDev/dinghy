/**
 * Dock -> Dinghy webhook. Dock POSTs connector events here, HMAC-signed (see src/lib/dock/hmac.ts).
 * 401 on a bad or stale signature; 500 when the shared secret is not configured (fail closed).
 * Replays inside the window are dropped by event id, so a retry from Dock is a no-op.
 */

import { NextResponse } from 'next/server'
import { verifyDockSignature } from '@/lib/dock/hmac'
import { applyDockEvent, type DockEvent } from '@/lib/dock/service'
import { dockDepsViaOutbox, dockWebhookSecret } from '@/lib/dock/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function isEvent(v: unknown): v is DockEvent {
    if (!v || typeof v !== 'object') return false
    const e = v as Record<string, unknown>
    return (
        typeof e.event_id === 'string' &&
        e.event_id.length > 0 &&
        e.event_id.length <= 120 &&
        typeof e.type === 'string' &&
        typeof e.link_ref === 'string' &&
        typeof e.workspace_id === 'string' &&
        (e.data === undefined || (typeof e.data === 'object' && e.data !== null))
    )
}

export async function POST(req: Request): Promise<Response> {
    const secret = dockWebhookSecret()
    const raw = await req.text()
    const check = verifyDockSignature({
        secret,
        timestamp: req.headers.get('x-dinghy-timestamp'),
        signature: req.headers.get('x-dinghy-signature'),
        rawBody: raw,
        nowSeconds: Math.floor(Date.now() / 1000),
    })
    if (!check.ok) {
        if (check.reason === 'no_secret') {
            console.error('dock webhook not configured: DINGHY_DOCK_WEBHOOK_SECRET is unset')
            return NextResponse.json({ error: 'dock webhook not configured' }, { status: 500 })
        }
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    let body: unknown
    try {
        body = JSON.parse(raw)
    } catch {
        return NextResponse.json({ error: 'invalid json' }, { status: 400 })
    }
    if (!isEvent(body)) return NextResponse.json({ error: 'invalid event' }, { status: 400 })

    try {
        const outcome = await applyDockEvent(dockDepsViaOutbox(), { ...body, data: body.data ?? {} })
        return NextResponse.json({ outcome })
    } catch (err) {
        // Log only the message type; the body can carry approval details.
        console.error('dock webhook failed:', body.type, err instanceof Error ? err.message : String(err))
        return NextResponse.json({ error: 'temporarily unavailable' }, { status: 503 })
    }
}
