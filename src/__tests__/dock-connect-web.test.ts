/**
 * The signed-in web consent flow for the Dock connector (/connect/dock). Identity and security
 * cases: the link binds to the session owner's own thread, grants are per-workspace and never
 * survive unlink, the workspace hint is only trusted when Dock signed it, and the CSRF nonce is
 * bound to user + code.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { harness, type Route } from './dock-harness'
import { applyDockEvent, handleDockInbound, redeemPairing, unlinkChat, type DockDeps } from '@/lib/dock/service'
import { consentNonce, verifyConsentNonce } from '@/lib/dock/connect'
import { signConnectHint, verifyConnectHint } from '@/lib/dock/connect-hint'
import { safeNextPath } from '@/lib/auth/redirect'

beforeAll(() => {
    process.env.ENCRYPTION_KEY = 'ab'.repeat(32)
})

const PAIR = '/api/connector/pair'
const UNLINK = '/api/connector/unlink'

function setup(over: Record<string, Route> = {}) {
    const routes: Record<string, Route> = {
        [PAIR]: () => ({ status: 200, json: { connector_token: 'tok_SECRET_web', workspace_id: 'ws1', chief_name: 'Vic' } }),
        [UNLINK]: () => ({ status: 200, json: { ok: true } }),
        ...over,
    }
    const h = harness({ routes })
    let n = 0
    const deps: DockDeps = { ...h.deps, newLinkRef: () => 'ref_' + String(++n).padStart(28, '0') }
    return { ...h, deps, routes }
}

describe('web redemption', () => {
    it('links the session owner thread and records the authenticated user id', async () => {
        const s = setup()
        const out = await redeemPairing(s.deps, { chatGuid: 'chatA', code: 'ABCD-1234', userId: 'user-1' })
        expect(out).toEqual({ ok: true, chief: 'Vic', workspaceRef: 'ws1' })
        const link = s.mem.links.get('chatA')!
        expect(link.user_id).toBe('user-1')
        expect(link.workspace_ref).toBe('ws1')
        // the workspace on the link comes from Dock's redemption response, never the URL
        expect(s.dock.calls[0].body.code).toBe('ABCD-1234')
    })

    it('a chat that is already linked cannot be re-redeemed over the web', async () => {
        const s = setup()
        await redeemPairing(s.deps, { chatGuid: 'chatA', code: 'ABCD-1234', userId: 'user-1' })
        const again = await redeemPairing(s.deps, { chatGuid: 'chatA', code: 'WXYZ-9876', userId: 'user-1' })
        expect(again).toEqual({ ok: false, reason: 'already_linked' })
        expect(s.dock.calls.filter((c) => c.path === PAIR)).toHaveLength(1)
    })

    it('one code cannot link two different threads', async () => {
        const s = setup()
        await redeemPairing(s.deps, { chatGuid: 'chatA', code: 'ABCD-1234', userId: 'user-1' })
        const stolen = await redeemPairing(s.deps, { chatGuid: 'chatB', code: 'ABCD-1234', userId: 'user-2' })
        expect(stolen).toEqual({ ok: false, reason: 'used' })
        expect(s.mem.links.get('chatB')).toBeUndefined()
    })

    it('an unreachable Dock releases the code so the owner can retry', async () => {
        const s = setup({ [PAIR]: () => 'unreachable' })
        const first = await redeemPairing(s.deps, { chatGuid: 'chatA', code: 'ABCD-1234', userId: 'user-1' })
        expect(first).toEqual({ ok: false, reason: 'unreachable' })
        expect(s.mem.codes.size).toBe(0)
        s.routes[PAIR] = () => ({ status: 200, json: { connector_token: 'tok', workspace_id: 'ws1', chief_name: 'Vic' } })
        const retry = await redeemPairing(s.deps, { chatGuid: 'chatA', code: 'ABCD-1234', userId: 'user-1' })
        expect(retry.ok).toBe(true)
    })

    it('maps expired and invalid codes without linking', async () => {
        const s = setup({ [PAIR]: () => ({ status: 410 }) })
        expect(await redeemPairing(s.deps, { chatGuid: 'chatA', code: 'ABCD-1234' })).toEqual({ ok: false, reason: 'expired' })
        const s2 = setup({ [PAIR]: () => ({ status: 401 }) })
        expect(await redeemPairing(s2.deps, { chatGuid: 'chatA', code: 'ABCD-1234' })).toEqual({ ok: false, reason: 'invalid' })
        expect(s.mem.links.size + s2.mem.links.size).toBe(0)
    })

    it('a malformed Dock response links nothing', async () => {
        const s = setup({ [PAIR]: () => ({ status: 200, json: { connector_token: '', workspace_id: 'ws1', chief_name: '' } }) })
        expect(await redeemPairing(s.deps, { chatGuid: 'chatA', code: 'ABCD-1234' })).toEqual({ ok: false, reason: 'bad_response' })
        expect(s.mem.links.size).toBe(0)
    })
})

describe('always-allow grants', () => {
    it('grants are per thread and per workspace', async () => {
        const s = setup()
        await s.mem.store.saveGrant('chatA', 'ws1')
        expect(await s.mem.store.getGrant('chatA', 'ws1')).not.toBeNull()
        expect(await s.mem.store.getGrant('chatA', 'ws2')).toBeNull()
        expect(await s.mem.store.getGrant('chatB', 'ws1')).toBeNull()
    })

    it('texting "unlink dock" deletes the grant, so auto-reconnect cannot undo it', async () => {
        const s = setup()
        await handleDockInbound(s.deps, 'chatA', 'pair ABCD-1234')
        await s.mem.store.saveGrant('chatA', 'ws1')
        await handleDockInbound(s.deps, 'chatA', 'unlink dock')
        expect(await s.mem.store.getGrant('chatA', 'ws1')).toBeNull()
    })

    it('a service-layer unlink deletes the grant too', async () => {
        const s = setup()
        await redeemPairing(s.deps, { chatGuid: 'chatA', code: 'ABCD-1234' })
        await s.mem.store.saveGrant('chatA', 'ws1')
        await unlinkChat(s.deps, 'chatA')
        expect(await s.mem.store.getGrant('chatA', 'ws1')).toBeNull()
    })

    it('Dock severing the link (link.revoked) deletes the grant', async () => {
        const s = setup()
        await redeemPairing(s.deps, { chatGuid: 'chatA', code: 'ABCD-1234' })
        await s.mem.store.saveGrant('chatA', 'ws1')
        const link = s.mem.links.get('chatA')!
        const outcome = await applyDockEvent(s.deps, {
            event_id: 'ev_revoke_1',
            type: 'link.revoked',
            link_ref: link.link_ref,
            workspace_id: 'ws1',
            data: {},
        })
        expect(outcome).toBe('applied')
        expect(await s.mem.store.getGrant('chatA', 'ws1')).toBeNull()
    })
})

describe('workspace hint signature', () => {
    const secret = 'shared-webhook-secret'
    it('round-trips a Dock-made hint', () => {
        const sig = signConnectHint(secret, 'ABCD-1234', 'ws1')
        expect(verifyConnectHint(secret, 'ABCD-1234', 'ws1', sig)).toBe(true)
    })
    it('rejects a forged workspace claim on someone else’s code', () => {
        const sig = signConnectHint(secret, 'ABCD-1234', 'ws1')
        // attacker swaps in their own code or workspace, or guesses a signature
        expect(verifyConnectHint(secret, 'EVIL-0000', 'ws1', sig)).toBe(false)
        expect(verifyConnectHint(secret, 'ABCD-1234', 'ws_evil', sig)).toBe(false)
        expect(verifyConnectHint(secret, 'ABCD-1234', 'ws1', 'f'.repeat(64))).toBe(false)
        expect(verifyConnectHint('wrong-secret', 'ABCD-1234', 'ws1', sig)).toBe(false)
        expect(verifyConnectHint(secret, 'ABCD-1234', 'ws1', 'not-hex')).toBe(false)
    })
})

describe('consent nonce (CSRF)', () => {
    it('is bound to the signed-in user and the exact code', () => {
        const n = consentNonce('user-1', 'ABCD-1234')
        expect(verifyConsentNonce('user-1', 'ABCD-1234', n)).toBe(true)
        expect(verifyConsentNonce('user-2', 'ABCD-1234', n)).toBe(false)
        expect(verifyConsentNonce('user-1', 'WXYZ-9876', n)).toBe(false)
        expect(verifyConsentNonce('user-1', 'ABCD-1234', '0'.repeat(64))).toBe(false)
        expect(verifyConsentNonce('user-1', 'ABCD-1234', 'junk')).toBe(false)
    })
})

describe('post-login redirect target', () => {
    it('keeps same-origin paths, rejects anything else', () => {
        expect(safeNextPath('/connect/dock?pair=ABCD-1234')).toBe('/connect/dock?pair=ABCD-1234')
        expect(safeNextPath('//evil.com')).toBeNull()
        expect(safeNextPath('https://evil.com')).toBeNull()
        expect(safeNextPath('/\\evil')).toBeNull()
        expect(safeNextPath('connect/dock')).toBeNull()
        expect(safeNextPath('')).toBeNull()
        expect(safeNextPath(undefined)).toBeNull()
        expect(safeNextPath('/' + 'a'.repeat(300))).toBeNull()
    })
})
