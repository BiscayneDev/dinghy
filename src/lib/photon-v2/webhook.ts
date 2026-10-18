/**
 * Photon 2.0 webhook signature verification (Standard Webhooks scheme:
 * whsec_ secret, webhook-id / webhook-timestamp / webhook-signature
 * headers, HMAC-SHA256 over `${id}.${timestamp}.${rawBody}`).
 *
 * The v2 docs do not publish the header contract yet; this follows the
 * Standard Webhooks convention the whsec_ secret format signals, and the
 * first real delivery against the test project confirmed it (see PR
 * description evidence). Fail closed: any doubt, no dispatch.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

const TOLERANCE_MS = 5 * 60 * 1000

function secretBytes(secret: string): Buffer {
    // Standard Webhooks secrets are base64 after the whsec_ prefix.
    return Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
}

function expectedSignature(secret: string, id: string, timestamp: string, body: string): string {
    return createHmac('sha256', secretBytes(secret)).update(`${id}.${timestamp}.${body}`).digest('base64')
}

export interface WebhookHeaders {
    get(name: string): string | null
}

export function verifyPhotonV2Webhook(
    headers: WebhookHeaders,
    rawBody: string,
    secret: string,
    now: number = Date.now()
): boolean {
    const id = headers.get('webhook-id')
    const timestamp = headers.get('webhook-timestamp')
    const signatureHeader = headers.get('webhook-signature')
    if (!id || !timestamp || !signatureHeader) return false
    const ts = Number(timestamp)
    if (!Number.isFinite(ts) || Math.abs(now - ts * 1000) > TOLERANCE_MS) return false
    const expected = expectedSignature(secret, id, timestamp, rawBody)
    // The header can carry several space-separated "v1,<sig>" pairs during
    // secret rotation; any match verifies.
    for (const part of signatureHeader.split(' ')) {
        const [version, sig] = part.split(',', 2)
        if (version !== 'v1' || !sig) continue
        const a = Buffer.from(expected)
        const b = Buffer.from(sig)
        if (a.length === b.length && timingSafeEqual(a, b)) return true
    }
    return false
}
