/**
 * HMAC signing for Dock -> Dinghy webhooks.
 *
 * Dock signs `${timestamp}.${rawBody}` with the shared secret (DINGHY_DOCK_WEBHOOK_SECRET on Dinghy,
 * DINGHY_WEBHOOK_SECRET on Dock) and sends:
 *   x-dinghy-timestamp: <unix seconds>
 *   x-dinghy-signature: <hex sha256 hmac>
 * A request is refused when the timestamp is outside the replay window or the signature does not match.
 * Event-level dedupe (dock_events) handles a replay that lands inside the window.
 */

import { createHmac, timingSafeEqual } from 'crypto'

export const DOCK_REPLAY_WINDOW_SECONDS = 300

export function signDockPayload(secret: string, timestampSeconds: number, rawBody: string): string {
    return createHmac('sha256', secret).update(`${timestampSeconds}.${rawBody}`).digest('hex')
}

export type DockSignatureCheck =
    | { ok: true }
    | { ok: false; reason: 'no_secret' | 'missing' | 'bad_timestamp' | 'stale' | 'bad_signature' }

export function verifyDockSignature(input: {
    secret: string | undefined
    timestamp: string | null
    signature: string | null
    rawBody: string
    nowSeconds: number
    windowSeconds?: number
}): DockSignatureCheck {
    if (!input.secret) return { ok: false, reason: 'no_secret' }
    if (!input.timestamp || !input.signature) return { ok: false, reason: 'missing' }
    if (!/^\d{1,12}$/.test(input.timestamp)) return { ok: false, reason: 'bad_timestamp' }
    const ts = Number(input.timestamp)
    const window = input.windowSeconds ?? DOCK_REPLAY_WINDOW_SECONDS
    if (Math.abs(input.nowSeconds - ts) > window) return { ok: false, reason: 'stale' }

    const expected = Buffer.from(signDockPayload(input.secret, ts, input.rawBody), 'hex')
    if (!/^[0-9a-f]{64}$/i.test(input.signature)) return { ok: false, reason: 'bad_signature' }
    const provided = Buffer.from(input.signature, 'hex')
    if (provided.length !== expected.length) return { ok: false, reason: 'bad_signature' }
    return timingSafeEqual(provided, expected) ? { ok: true } : { ok: false, reason: 'bad_signature' }
}
