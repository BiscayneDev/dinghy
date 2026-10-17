/**
 * Photon 2.0 webhook: Dinghy's v2 front door, running in parallel with the
 * legacy Spectrum route (src/app/api/spectrum/webhook/route.ts).
 *
 * Same discipline as the legacy route: verify the HMAC signature over the
 * raw body (401 on bad signature, 500 when unconfigured - fail closed),
 * respond 200 immediately, and run the handler in an after() tail with the
 * outbox as the durability net. Inert until PHOTON_V2_* env vars are set
 * AND a v2 webhook destination points here - setting those is the cutover.
 */

import { after } from 'next/server'
import { getPhotonV2Config } from '@/lib/photon-v2/config'
import { verifyPhotonV2Webhook } from '@/lib/photon-v2/webhook'
import { inboundFromV2Event, type V2MessageReceivedEvent } from '@/lib/photon-v2/adapter'
import { handleSpectrumMessage } from '@/lib/spectrum/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: Request): Promise<Response> {
    let cfg
    try {
        cfg = getPhotonV2Config()
    } catch (err) {
        console.error('photon v2 webhook config:', err instanceof Error ? err.message : String(err))
        return Response.json({ error: 'photon v2 webhook not configured' }, { status: 500 })
    }

    const rawBody = await req.text()
    if (!verifyPhotonV2Webhook(req.headers, rawBody, cfg.webhookSecret)) {
        return Response.json({ error: 'bad signature' }, { status: 401 })
    }

    let event: V2MessageReceivedEvent
    try {
        event = JSON.parse(rawBody) as V2MessageReceivedEvent
    } catch {
        return Response.json({ error: 'bad json' }, { status: 400 })
    }

    // 200 first; the tail does the work. Only message.received carries work;
    // delivery receipts and typing updates are acknowledged and dropped.
    after(async () => {
        try {
            const inbound = await inboundFromV2Event(event)
            if (!inbound) return
            await handleSpectrumMessage(inbound.space, inbound.message)
        } catch (err) {
            console.error('photon v2 handler failed:', err instanceof Error ? err.message : String(err))
        }
    })
    return Response.json({ received: true })
}
