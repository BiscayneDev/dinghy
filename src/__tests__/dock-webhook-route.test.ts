import { afterEach, describe, expect, it } from 'vitest'
import { signDockPayload } from '@/lib/dock/hmac'
import { POST } from '@/app/api/dock/webhook/route'

const SECRET = 'whsec_route_test_0123456789'
const body = JSON.stringify({ event_id: 'route-1', type: 'run.update', link_ref: 'x', workspace_id: 'w', data: {} })

function req(headers: Record<string, string>, raw = body): Request {
    return new Request('https://getdinghy.sh/api/dock/webhook', { method: 'POST', headers, body: raw })
}

afterEach(() => {
    delete process.env.DINGHY_DOCK_WEBHOOK_SECRET
})

describe('POST /api/dock/webhook', () => {
    it('refuses an unsigned request', async () => {
        process.env.DINGHY_DOCK_WEBHOOK_SECRET = SECRET
        const res = await POST(req({}))
        expect(res.status).toBe(401)
    })
    it('refuses a signature made with another secret', async () => {
        process.env.DINGHY_DOCK_WEBHOOK_SECRET = SECRET
        const ts = Math.floor(Date.now() / 1000)
        const res = await POST(req({ 'x-dinghy-timestamp': String(ts), 'x-dinghy-signature': signDockPayload('wrong', ts, body) }))
        expect(res.status).toBe(401)
    })
    it('refuses a stale signed request (outside the replay window)', async () => {
        process.env.DINGHY_DOCK_WEBHOOK_SECRET = SECRET
        const ts = Math.floor(Date.now() / 1000) - 3600
        const res = await POST(req({ 'x-dinghy-timestamp': String(ts), 'x-dinghy-signature': signDockPayload(SECRET, ts, body) }))
        expect(res.status).toBe(401)
    })
    it('fails closed (500) when the shared secret is not configured', async () => {
        const ts = Math.floor(Date.now() / 1000)
        const res = await POST(req({ 'x-dinghy-timestamp': String(ts), 'x-dinghy-signature': signDockPayload(SECRET, ts, body) }))
        expect(res.status).toBe(500)
    })
})
