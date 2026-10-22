import { beforeAll, describe, expect, it } from 'vitest'
import { harness, type Route } from './dock-harness'
import { applyDockEvent, drainDockQueue, handleDockInbound, type DockDeps } from '@/lib/dock/service'
import { dockApi } from '@/lib/dock/client'
import { decryptTokenFromDb } from '@/lib/crypto'

beforeAll(() => {
    process.env.ENCRYPTION_KEY = 'ab'.repeat(32)
})

const PAIR = '/api/connector/pair'
const RUNS = '/api/connector/runs'
const UNLINK = '/api/connector/unlink'
const DECIDE = '/api/connector/approvals/:id/decision'

function baseRoutes(over: Record<string, Route> = {}): Record<string, Route> {
    return {
        [PAIR]: () => ({ status: 200, json: { connector_token: 'tok_SECRET_1', workspace_id: 'ws1', chief_name: 'Vic' } }),
        [RUNS]: (b) => ({ status: 201, json: { run_id: 'r1', agent_name: 'Vic' } }),
        [UNLINK]: () => ({ status: 200, json: { ok: true } }),
        [DECIDE]: () => ({ status: 200, json: { status: 'ok' } }),
        ...over,
    }
}

function setup(over: Record<string, Route> = {}) {
    const routes = baseRoutes(over)
    const h = harness({ routes })
    let n = 0
    const deps: DockDeps = { ...h.deps, newLinkRef: () => 'ref_' + String(++n).padStart(28, '0') }
    return { ...h, deps, routes }
}

async function pairA(s: ReturnType<typeof setup>, chat = 'chatA', code = 'ABCD-1234') {
    await handleDockInbound(s.deps, chat, `pair ${code}`)
    return s.mem.links.get(chat)!
}

function approvalEvent(s: ReturnType<typeof setup>, linkRef: string, o: Partial<{ id: string; label: string; hash: string; eventId: string; expiresInMs: number }> = {}) {
    return {
        event_id: o.eventId ?? 'ev_' + (o.id ?? 'ap1') + '_' + (o.hash ?? 'h1'),
        type: 'approval.requested',
        link_ref: linkRef,
        workspace_id: 'ws1',
        data: {
            approval_id: o.id ?? 'ap1',
            label: o.label ?? 'Refund #3',
            action: 'Refund a customer',
            amount_text: '$40',
            destination: 'card ****1234',
            details_hash: o.hash ?? 'hash_v1_aaaaaaaaaaaa',
            expires_at: new Date(s.clock.t + (o.expiresInMs ?? 10 * 60 * 1000)).toISOString(),
            card_url: 'https://dock.test/approvals/' + (o.id ?? 'ap1'),
        },
    }
}

function callsTo(s: ReturnType<typeof setup>, path: string) {
    return s.dock.calls.filter((c) => c.path.startsWith(path))
}

describe('pairing', () => {
    it('links the chat once and stores the connector token encrypted', async () => {
        const s = setup()
        const link = await pairA(s)
        expect(s.sent.at(-1)?.text).toContain('Your Chief of Staff is Vic')
        expect(link.chief_name).toBe('Vic')
        expect(link.token_ciphertext).not.toContain('tok_SECRET_1')
        expect(decryptTokenFromDb(link.token_ciphertext)).toBe('tok_SECRET_1')
    })

    it('a one-time code is single use across chats', async () => {
        const s = setup()
        await pairA(s, 'chatA', 'ABCD-1234')
        await handleDockInbound(s.deps, 'chatB', 'pair ABCD-1234')
        expect(s.sent.at(-1)?.text).toContain('already used')
        expect(callsTo(s, PAIR)).toHaveLength(1)
        expect(s.mem.links.get('chatB')).toBeUndefined()
    })

    it('an expired code (Dock 410) links nothing', async () => {
        const s = setup({ [PAIR]: () => ({ status: 410 }) })
        await handleDockInbound(s.deps, 'chatA', 'pair ABCD-1234')
        expect(s.sent.at(-1)?.text).toContain('expired')
        expect(s.mem.links.get('chatA')).toBeUndefined()
    })

    it('an unreachable Dock releases the code so the user can retry', async () => {
        const s = setup({ [PAIR]: () => 'unreachable' })
        await handleDockInbound(s.deps, 'chatA', 'pair ABCD-1234')
        expect(s.sent.at(-1)?.text).toContain("didn't answer")
        expect(s.mem.codes.size).toBe(0)
        s.routes[PAIR] = () => ({ status: 200, json: { connector_token: 'tok_2', workspace_id: 'ws1', chief_name: 'Vic' } })
        await handleDockInbound(s.deps, 'chatA', 'pair ABCD-1234')
        expect(s.mem.links.get('chatA')).toBeDefined()
    })

    it('a linked chat cannot pair again', async () => {
        const s = setup()
        await pairA(s)
        await handleDockInbound(s.deps, 'chatA', 'pair ZZZZ-9999')
        expect(s.sent.at(-1)?.text).toContain('already linked')
        expect(callsTo(s, PAIR)).toHaveLength(1)
    })

    it('unlink removes the link; later @ mentions fall through to Dinghy', async () => {
        const s = setup()
        await pairA(s)
        expect(await handleDockInbound(s.deps, 'chatA', 'unlink dock')).toBe(true)
        expect(callsTo(s, UNLINK)).toHaveLength(1)
        expect(s.mem.links.get('chatA')?.status).toBe('unlinked')
        expect(await handleDockInbound(s.deps, 'chatA', '@Vic check sales')).toBe(false)
    })
})

describe('Dock -> Dinghy approval requests and replies', () => {
    it('sends the approval in short form and records it pending', async () => {
        const s = setup()
        const link = await pairA(s)
        expect(await applyDockEvent(s.deps, approvalEvent(s, link.link_ref))).toBe('applied')
        const text = s.sent.at(-1)!.text
        expect(text).toContain('Refund #3')
        expect(text).toContain('$40')
        expect(text).toContain('Reply yes or no')
        expect(s.mem.approvals.get('ap1')?.status).toBe('pending')
        expect(s.mem.approvals.get('ap1')?.shown_hash).toBe('hash_v1_aaaaaaaaaaaa')
    })

    it('a replayed signed event (same event id) is a no-op', async () => {
        const s = setup()
        const link = await pairA(s)
        const ev = approvalEvent(s, link.link_ref)
        await applyDockEvent(s.deps, ev)
        const before = s.sent.length
        expect(await applyDockEvent(s.deps, ev)).toBe('duplicate')
        expect(s.sent.length).toBe(before)
    })

    it('a yes resolves the single approval with the details the user saw', async () => {
        const s = setup()
        const link = await pairA(s)
        await applyDockEvent(s.deps, approvalEvent(s, link.link_ref))
        expect(await handleDockInbound(s.deps, 'chatA', 'yes')).toBe(true)
        const call = callsTo(s, '/api/connector/approvals/ap1/decision')[0]
        expect(call.body).toEqual({ decision: 'approve', expected_details_hash: 'hash_v1_aaaaaaaaaaaa' })
        expect(call.auth).toBe('Bearer tok_SECRET_1')
        expect(s.mem.approvals.get('ap1')?.status).toBe('approved')
        expect(s.sent.at(-1)?.text).toContain('Approved')
    })

    it('a second reply cannot resolve the same approval again', async () => {
        const s = setup()
        const link = await pairA(s)
        await applyDockEvent(s.deps, approvalEvent(s, link.link_ref))
        await handleDockInbound(s.deps, 'chatA', 'no')
        await handleDockInbound(s.deps, 'chatA', 'yes')
        expect(callsTo(s, '/api/connector/approvals/ap1/decision')).toHaveLength(1)
        expect(s.mem.approvals.get('ap1')?.decision).toBe('reject')
    })

    it("another user's reply never resolves this approval", async () => {
        const s = setup()
        const linkA = await pairA(s, 'chatA', 'AAAA-1111')
        await pairA(s, 'chatB', 'BBBB-2222')
        await applyDockEvent(s.deps, approvalEvent(s, linkA.link_ref))
        await handleDockInbound(s.deps, 'chatB', 'yes')
        expect(s.sent.at(-1)?.text).toContain('Nothing is waiting')
        expect(callsTo(s, '/api/connector/approvals/ap1/decision')).toHaveLength(0)
        expect(s.mem.approvals.get('ap1')?.status).toBe('pending')
    })

    it('with several pending approvals a bare yes asks; a labelled reply picks one', async () => {
        const s = setup()
        const link = await pairA(s)
        await applyDockEvent(s.deps, approvalEvent(s, link.link_ref, { id: 'ap1', label: 'Refund #3', hash: 'hash_a_aaaaaaaaaaaa' }))
        await applyDockEvent(s.deps, approvalEvent(s, link.link_ref, { id: 'ap2', label: 'Payout #9', hash: 'hash_b_bbbbbbbbbbbb' }))
        await handleDockInbound(s.deps, 'chatA', 'yes')
        expect(s.sent.at(-1)?.text).toContain('Which one?')
        expect(callsTo(s, '/api/connector/approvals/')).toHaveLength(0)
        await handleDockInbound(s.deps, 'chatA', 'no payout #9')
        expect(callsTo(s, '/api/connector/approvals/ap2/decision')[0].body.decision).toBe('reject')
        expect(s.mem.approvals.get('ap1')?.status).toBe('pending')
    })

    it('an expired approval is refused and Dock is not called', async () => {
        const s = setup()
        const link = await pairA(s)
        await applyDockEvent(s.deps, approvalEvent(s, link.link_ref, { expiresInMs: 5 * 60 * 1000 }))
        s.clock.t += 6 * 60 * 1000
        await handleDockInbound(s.deps, 'chatA', 'yes')
        expect(s.sent.at(-1)?.text).toContain('expired')
        expect(callsTo(s, '/api/connector/approvals/')).toHaveLength(0)
        expect(s.mem.approvals.get('ap1')?.status).toBe('expired')
    })

    it('when Dock is unreachable the decision is queued and sent once on replay', async () => {
        const s = setup({ [DECIDE]: () => 'unreachable' })
        const link = await pairA(s)
        await applyDockEvent(s.deps, approvalEvent(s, link.link_ref))
        await handleDockInbound(s.deps, 'chatA', 'yes')
        expect(s.sent.at(-1)?.text).toContain("isn't answering")
        expect(s.mem.approvals.get('ap1')?.status).toBe('decision_queued')
        expect(s.mem.queue).toHaveLength(1)

        s.routes[DECIDE] = () => ({ status: 200, json: { status: 'ok' } })
        expect(await drainDockQueue(s.deps)).toBe(1)
        expect(await drainDockQueue(s.deps)).toBe(0)
        expect(callsTo(s, '/api/connector/approvals/ap1/decision')).toHaveLength(2)
        expect(s.mem.approvals.get('ap1')?.status).toBe('approved')
    })

    it('a queued approval is never sent after it expired', async () => {
        const s = setup({ [DECIDE]: () => 'unreachable' })
        const link = await pairA(s)
        await applyDockEvent(s.deps, approvalEvent(s, link.link_ref, { expiresInMs: 10 * 60 * 1000 }))
        await handleDockInbound(s.deps, 'chatA', 'yes')
        s.routes[DECIDE] = () => ({ status: 200, json: {} })
        s.clock.t += 2 * 60 * 60 * 1000
        await drainDockQueue(s.deps)
        expect(callsTo(s, '/api/connector/approvals/')).toHaveLength(1)
        expect(s.mem.approvals.get('ap1')?.status).toBe('expired')
        expect(s.sent.at(-1)?.text).toContain('expired')
    })

    it('a queued approval is not sent when its details changed in Dock', async () => {
        const s = setup({ [DECIDE]: () => 'unreachable' })
        const link = await pairA(s)
        await applyDockEvent(s.deps, approvalEvent(s, link.link_ref))
        await handleDockInbound(s.deps, 'chatA', 'yes')
        s.mem.approvals.get('ap1')!.details_hash = 'hash_v2_cccccccccccc'
        s.routes[DECIDE] = () => ({ status: 200, json: {} })
        await drainDockQueue(s.deps)
        expect(callsTo(s, '/api/connector/approvals/')).toHaveLength(1)
        expect(s.mem.approvals.get('ap1')?.status).toBe('pending')
    })

    it('a reply with nothing pending gets a short answer and no Dock call', async () => {
        const s = setup()
        await pairA(s)
        await handleDockInbound(s.deps, 'chatA', 'approve')
        expect(s.sent.at(-1)?.text).toContain('Nothing is waiting')
        expect(callsTo(s, '/api/connector/approvals/')).toHaveLength(0)
    })

    it('Dinghy-own pending confirmations keep today\'s path', async () => {
        const s = setup()
        await pairA(s)
        const deps = { ...s.deps, hasOwnPending: async () => true }
        expect(await handleDockInbound(deps, 'chatA', 'yes')).toBe(false)
        expect(s.sent.length).toBe(1)
    })

    it('money: the Dock client exposes no spend or payout call', () => {
        expect(Object.keys(dockApi).sort()).toEqual(['decideApproval', 'pair', 'submitRun', 'unlink'])
    })
})

describe('@ routing to the Chief of Staff', () => {
    it('routes @<chief> to a Dock run and confirms the name', async () => {
        const s = setup()
        await pairA(s)
        expect(await handleDockInbound(s.deps, 'chatA', '@vic check my sales today')).toBe(true)
        const call = callsTo(s, RUNS)[0]
        expect(call.body.agent).toBe('Vic')
        expect(call.body.message).toBe('check my sales today')
        expect(s.sent.at(-1)?.text).toBe('Sent to Vic.')
    })

    it('an unknown @name falls back to Dinghy and makes no Dock call', async () => {
        const s = setup()
        await pairA(s)
        expect(await handleDockInbound(s.deps, 'chatA', '@Nova check sales')).toBe(false)
        expect(callsTo(s, RUNS)).toHaveLength(0)
    })

    it('a chat with no Dock link is untouched', async () => {
        const s = setup()
        expect(await handleDockInbound(s.deps, 'chatZ', '@Vic hi')).toBe(false)
        expect(s.sent).toHaveLength(0)
    })

    it('a bare @mention asks for the request', async () => {
        const s = setup()
        await pairA(s)
        await handleDockInbound(s.deps, 'chatA', '@Vic')
        expect(s.sent.at(-1)?.text).toContain('Tell Vic what you need')
        expect(callsTo(s, RUNS)).toHaveLength(0)
    })

    it('an offline run is queued, replayed once with the same id, and stays in order', async () => {
        const s = setup({ [RUNS]: () => 'unreachable' })
        await pairA(s)
        await handleDockInbound(s.deps, 'chatA', '@vic first')
        await handleDockInbound(s.deps, 'chatA', '@vic second')
        expect(s.mem.queue.map((r) => r.payload.message)).toEqual(['first', 'second'])
        const firstId = callsTo(s, RUNS)[0].body.client_message_id

        s.routes[RUNS] = (b) => ({ status: 201, json: { run_id: 'r_' + b.message, agent_name: 'Vic' } })
        await drainDockQueue(s.deps)
        await drainDockQueue(s.deps)
        const all = callsTo(s, RUNS)
        // calls 0 and 1 are the offline attempts from the message; calls 2 and 3 are the drain replays.
        const replayed = all.slice(2)
        expect(replayed.map((c) => c.body.message)).toEqual(['first', 'second'])
        expect(replayed[0].body.client_message_id).toBe(firstId)
        expect(s.mem.queue.every((r) => r.status === 'sent')).toBe(true)
    })

    it('a backed-off head holds back its chat until the retry time', async () => {
        const s = setup({ [RUNS]: () => 'unreachable' })
        await pairA(s)
        await handleDockInbound(s.deps, 'chatA', '@vic first')
        await handleDockInbound(s.deps, 'chatA', '@vic second')
        const before = callsTo(s, RUNS).length
        await drainDockQueue(s.deps)
        expect(callsTo(s, RUNS).length).toBe(before + 1)
        s.clock.t += 5_000
        await drainDockQueue(s.deps)
        expect(callsTo(s, RUNS).length).toBe(before + 1)
    })
})

describe('rename confirmation', () => {
    it('keeps routing to the old name until the user confirms the new one', async () => {
        const s = setup()
        const link = await pairA(s)
        await applyDockEvent(s.deps, { event_id: 'rn1', type: 'chief.renamed', link_ref: link.link_ref, workspace_id: 'ws1', data: { old_name: 'Vic', new_name: 'Nova' } })
        expect(s.sent.at(-1)?.text).toContain('Reply yes to start routing @Nova')
        expect(await handleDockInbound(s.deps, 'chatA', '@nova hi')).toBe(false)
        expect(await handleDockInbound(s.deps, 'chatA', '@vic hi')).toBe(true)
        await handleDockInbound(s.deps, 'chatA', 'yes')
        expect(s.mem.links.get('chatA')?.chief_name).toBe('Nova')
        expect(await handleDockInbound(s.deps, 'chatA', '@nova hi')).toBe(true)
    })

    it('a no keeps the old name', async () => {
        const s = setup()
        const link = await pairA(s)
        await applyDockEvent(s.deps, { event_id: 'rn2', type: 'chief.renamed', link_ref: link.link_ref, workspace_id: 'ws1', data: { old_name: 'Vic', new_name: 'Nova' } })
        await handleDockInbound(s.deps, 'chatA', 'no')
        expect(s.mem.links.get('chatA')?.chief_name).toBe('Vic')
        expect(s.mem.links.get('chatA')?.pending_chief_name).toBeNull()
    })
})

describe('webhook scoping', () => {
    it('an event for an unknown link or the wrong workspace is refused', async () => {
        const s = setup()
        const link = await pairA(s)
        const before = s.sent.length
        expect(await applyDockEvent(s.deps, { ...approvalEvent(s, 'ref_nope'), event_id: 'x1' })).toBe('unknown_link')
        expect(await applyDockEvent(s.deps, { ...approvalEvent(s, link.link_ref), event_id: 'x2', workspace_id: 'other' })).toBe('unknown_link')
        expect(s.sent.length).toBe(before)
    })

    it('run updates arrive as the agent name plus the text', async () => {
        const s = setup()
        const link = await pairA(s)
        await applyDockEvent(s.deps, { event_id: 'u1', type: 'run.update', link_ref: link.link_ref, workspace_id: 'ws1', data: { agent_name: 'Vic', text: 'Sales are up 4%.' } })
        expect(s.sent.at(-1)?.text).toBe('Vic: Sales are up 4%.')
    })
})

