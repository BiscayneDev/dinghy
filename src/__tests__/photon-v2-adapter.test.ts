import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyPhotonV2Webhook } from '@/lib/photon-v2/webhook'
import { inboundFromV2Event, v2SpaceFor } from '@/lib/photon-v2/adapter'
import { parseV2ChatGuid, v2ChatGuid } from '@/lib/photon-v2/store'

const SECRET = 'whsec_' + Buffer.from('test-secret-key-test-secret-key').toString('base64')

function signedHeaders(body: string, id = 'msg_1', ts = Math.floor(Date.now() / 1000)) {
    const sig = createHmac('sha256', Buffer.from(SECRET.replace(/^whsec_/, ''), 'base64'))
        .update(`${id}.${ts}.${body}`).digest('base64')
    const map = new Map([
        ['webhook-id', id],
        ['webhook-timestamp', String(ts)],
        ['webhook-signature', `v1,${sig}`],
    ])
    return { get: (n: string) => map.get(n.toLowerCase()) ?? null }
}

describe('verifyPhotonV2Webhook', () => {
    const body = '{"type":"message.received"}'
    it('accepts a valid signature', () => {
        expect(verifyPhotonV2Webhook(signedHeaders(body), body, SECRET)).toBe(true)
    })
    it('rejects a tampered body', () => {
        expect(verifyPhotonV2Webhook(signedHeaders(body), body + 'x', SECRET)).toBe(false)
    })
    it('rejects missing headers', () => {
        expect(verifyPhotonV2Webhook({ get: () => null }, body, SECRET)).toBe(false)
    })
    it('rejects an old timestamp', () => {
        const stale = Math.floor(Date.now() / 1000) - 3600
        expect(verifyPhotonV2Webhook(signedHeaders(body, 'msg_1', stale), body, SECRET)).toBe(false)
    })
})

const fakeEvent = (over: Record<string, unknown> = {}) => ({
    id: 'evt_1',
    type: 'message.received',
    timestamp: '2026-10-17T23:00:00Z',
    data: {
        projectId: 'pho_prj_x',
        object: {
            id: 'pho_msg_1',
            platform: 'imessage',
            status: 'received',
            content: { type: 'text', format: 'plain', text: 'ping' },
            sentBy: { id: 'pho_usr_human', kind: 'human', handle: '+15550001111' },
            receivedBy: { id: 'pho_usr_agent', kind: 'agent', handle: '+15550002222' },
            space: { id: 'pho_spc_1', platform: 'imessage', kind: 'direct' },
            createdAt: '2026-10-17T23:00:00Z',
            ...over,
        },
    },
})

describe('inboundFromV2Event', () => {
    it('normalizes a plain text into the legacy shape with a synthetic chat guid', async () => {
        const r = await inboundFromV2Event(fakeEvent(), { capture: () => {} })
        expect(r).not.toBeNull()
        expect(r!.space.id).toBe('v2;imessage;pho_spc_1')
        expect(r!.message.content).toEqual({ type: 'text', text: 'ping' })
        expect(r!.message.sender).toEqual({ id: 'pho_usr_human', handle: '+15550001111' })
        expect(typeof r!.message.react).toBe('function')
        expect(typeof r!.message.reply).toBe('function')
    })
    it('drops our own outbound echoes', async () => {
        expect(await inboundFromV2Event(fakeEvent({ sentBy: { id: 'pho_usr_agent', kind: 'agent' } }), { capture: () => {} })).toBeNull()
    })
    it('drops delivery receipts and system content', async () => {
        expect(await inboundFromV2Event(fakeEvent({ status: 'delivered' }), { capture: () => {} })).toBeNull()
        expect(await inboundFromV2Event(fakeEvent({ content: { type: 'message.read' } }), { capture: () => {} })).toBeNull()
        expect(await inboundFromV2Event({ ...fakeEvent(), type: 'message.delivered' }, { capture: () => {} })).toBeNull()
    })
})

describe('v2SpaceFor.send', () => {
    it('maps strings, typing builders, and contact builders through capture', async () => {
        const calls: { method: string; args: Record<string, unknown> }[] = []
        const space = v2SpaceFor('pho_spc_1', 'pho_usr_agent', 'imessage', { capture: (c) => calls.push(c) })
        await space.send('hello')
        await (space as { send(c: unknown): Promise<unknown> }).send({ build: async () => ({ type: 'typing', state: 'start' }) })
        await (space as { send(c: unknown): Promise<unknown> }).send({
            build: async () => ({ type: 'contact', name: { formatted: 'Dinghy' }, phones: [{ value: '+15550002222', type: 'mobile' }], urls: ['https://www.getdinghy.sh'] }),
        })
        expect(calls.map((c) => c.method)).toEqual(['sendText', 'setTyping', 'sendContact'])
        expect(calls[0]!.args.text).toBe('hello')
    })
})

describe('v2 chat guids', () => {
    it('round-trips', () => {
        const g = v2ChatGuid('whatsapp', 'pho_spc_01m0000000000000000000000a')
        expect(parseV2ChatGuid(g)).toEqual({ platform: 'whatsapp', spaceId: 'pho_spc_01m0000000000000000000000a' })
        expect(parseV2ChatGuid('iMessage;+;+15550001111')).toBeNull()
    })
})
