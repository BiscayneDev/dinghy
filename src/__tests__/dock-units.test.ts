import { describe, expect, it } from 'vitest'
import { signDockPayload, verifyDockSignature, DOCK_REPLAY_WINDOW_SECONDS } from '@/lib/dock/hmac'
import { matchChiefMention, parsePairCommand, parseReply } from '@/lib/dock/parse'
import { dueQueueHeads, planReply, queueBackoffMs, replayCheck, type ApprovalView } from '@/lib/dock/logic'
import { mapStatus } from '@/lib/dock/client'

const SECRET = 'whsec_test_0123456789abcdef'
const NOW = 1_800_000_000

describe('HMAC webhook signatures', () => {
    const body = '{"event_id":"e1"}'
    const sig = signDockPayload(SECRET, NOW, body)

    it('accepts a correctly signed, fresh request', () => {
        expect(verifyDockSignature({ secret: SECRET, timestamp: String(NOW), signature: sig, rawBody: body, nowSeconds: NOW })).toEqual({ ok: true })
    })
    it('rejects a tampered body', () => {
        const r = verifyDockSignature({ secret: SECRET, timestamp: String(NOW), signature: sig, rawBody: body + ' ', nowSeconds: NOW })
        expect(r).toEqual({ ok: false, reason: 'bad_signature' })
    })
    it('rejects a wrong secret', () => {
        const r = verifyDockSignature({ secret: 'other', timestamp: String(NOW), signature: sig, rawBody: body, nowSeconds: NOW })
        expect(r).toEqual({ ok: false, reason: 'bad_signature' })
    })
    it('rejects a timestamp outside the replay window, both directions', () => {
        const old = NOW - DOCK_REPLAY_WINDOW_SECONDS - 1
        const oldSig = signDockPayload(SECRET, old, body)
        expect(verifyDockSignature({ secret: SECRET, timestamp: String(old), signature: oldSig, rawBody: body, nowSeconds: NOW })).toEqual({ ok: false, reason: 'stale' })
        const future = NOW + DOCK_REPLAY_WINDOW_SECONDS + 1
        const fSig = signDockPayload(SECRET, future, body)
        expect(verifyDockSignature({ secret: SECRET, timestamp: String(future), signature: fSig, rawBody: body, nowSeconds: NOW })).toEqual({ ok: false, reason: 'stale' })
    })
    it('accepts the edge of the window', () => {
        const edge = NOW - DOCK_REPLAY_WINDOW_SECONDS
        const s = signDockPayload(SECRET, edge, body)
        expect(verifyDockSignature({ secret: SECRET, timestamp: String(edge), signature: s, rawBody: body, nowSeconds: NOW }).ok).toBe(true)
    })
    it('fails closed: no secret, missing headers, malformed timestamp or signature', () => {
        expect(verifyDockSignature({ secret: undefined, timestamp: String(NOW), signature: sig, rawBody: body, nowSeconds: NOW })).toEqual({ ok: false, reason: 'no_secret' })
        expect(verifyDockSignature({ secret: SECRET, timestamp: null, signature: sig, rawBody: body, nowSeconds: NOW })).toEqual({ ok: false, reason: 'missing' })
        expect(verifyDockSignature({ secret: SECRET, timestamp: 'abc', signature: sig, rawBody: body, nowSeconds: NOW })).toEqual({ ok: false, reason: 'bad_timestamp' })
        expect(verifyDockSignature({ secret: SECRET, timestamp: String(NOW), signature: 'zz', rawBody: body, nowSeconds: NOW })).toEqual({ ok: false, reason: 'bad_signature' })
    })
})

describe('message parsing', () => {
    it('pair codes and unlink', () => {
        expect(parsePairCommand('pair abcd-1234')).toEqual({ kind: 'pair', code: 'ABCD-1234' })
        expect(parsePairCommand('Pair ABCD-1234.')).toEqual({ kind: 'pair', code: 'ABCD-1234' })
        expect(parsePairCommand('pair')).toBeNull()
        expect(parsePairCommand('please pair ABCD-1234')).toBeNull()
        expect(parsePairCommand('unlink dock')).toEqual({ kind: 'unlink' })
    })
    it('yes/no and labelled replies', () => {
        expect(parseReply('Yes.')).toEqual({ decision: 'approve', label: null })
        expect(parseReply('ok')).toEqual({ decision: 'approve', label: null })
        expect(parseReply('no')).toEqual({ decision: 'reject', label: null })
        expect(parseReply('cancel')).toEqual({ decision: 'reject', label: null })
        expect(parseReply('yes refund #3')).toEqual({ decision: 'approve', label: 'refund #3' })
        expect(parseReply('yes ')).toEqual({ decision: 'approve', label: null })
        expect(parseReply('yesterday was fine')).toBeNull()
        expect(parseReply('hello there')).toBeNull()
    })
    it('@ mention matches the chief only, whole word, case-insensitive', () => {
        expect(matchChiefMention('@vic check my sales', 'Vic')).toEqual({ body: 'check my sales' })
        expect(matchChiefMention('hey @Vic, status?', 'Vic')).toEqual({ body: 'hey, status?' })
        expect(matchChiefMention('@Vicky check sales', 'Vic')).toBeNull()
        expect(matchChiefMention('email vic@example.com', 'Vic')).toBeNull()
        expect(matchChiefMention('@Nova check sales', 'Vic')).toBeNull()
        expect(matchChiefMention('@Vic', 'Vic')).toEqual({ body: '' })
    })
})

const appr = (o: Partial<ApprovalView> = {}): ApprovalView => ({
    id: 'a1', label: 'Refund #3', status: 'pending', decision: null,
    details_hash: 'h1', shown_hash: 'h1', expires_at: new Date(NOW * 1000 + 600_000).toISOString(), ...o,
})
const T = NOW * 1000
const yes = { decision: 'approve' as const, label: null }

describe('reply planning', () => {
    it('one live approval, shown current details: decide', () => {
        expect(planReply({ intent: yes, approvals: [appr()], pendingRename: null, nowMs: T })).toMatchObject({ type: 'decide', decision: 'approve' })
    })
    it('nothing pending: none', () => {
        expect(planReply({ intent: yes, approvals: [], pendingRename: null, nowMs: T })).toEqual({ type: 'none' })
    })
    it('expired: refused with the approval', () => {
        const a = appr({ expires_at: new Date(T - 1).toISOString() })
        expect(planReply({ intent: yes, approvals: [a], pendingRename: null, nowMs: T })).toMatchObject({ type: 'expired' })
    })
    it('details changed after the user was shown them: refused', () => {
        const a = appr({ details_hash: 'h2', shown_hash: null })
        expect(planReply({ intent: yes, approvals: [a], pendingRename: null, nowMs: T })).toMatchObject({ type: 'changed' })
    })
    it('two live approvals: asks with labels', () => {
        const r = planReply({ intent: yes, approvals: [appr(), appr({ id: 'a2', label: 'Payout #9' })], pendingRename: null, nowMs: T })
        expect(r).toEqual({ type: 'ask', labels: ['Refund #3', 'Payout #9'] })
    })
    it('a label picks exactly one approval', () => {
        const r = planReply({ intent: { decision: 'reject', label: 'payout #9' }, approvals: [appr(), appr({ id: 'a2', label: 'Payout #9' })], pendingRename: null, nowMs: T })
        expect(r).toMatchObject({ type: 'decide', decision: 'reject', approval: { id: 'a2' } })
    })
    it('an unknown label is refused and lists what is waiting', () => {
        expect(planReply({ intent: { decision: 'approve', label: 'nope' }, approvals: [appr()], pendingRename: null, nowMs: T })).toEqual({ type: 'unknown_label', labels: ['Refund #3'] })
    })
    it('a pending rename is confirmed or cancelled by yes/no when no approval is live', () => {
        expect(planReply({ intent: yes, approvals: [], pendingRename: 'Nova', nowMs: T })).toEqual({ type: 'confirm_rename', newName: 'Nova' })
        expect(planReply({ intent: { decision: 'reject', label: null }, approvals: [], pendingRename: 'Nova', nowMs: T })).toEqual({ type: 'cancel_rename', newName: 'Nova' })
    })
    it('an approval plus a rename pending asks which one', () => {
        expect(planReply({ intent: yes, approvals: [appr()], pendingRename: 'Nova', nowMs: T })).toEqual({ type: 'ask', labels: ['Refund #3', 'rename'] })
    })
    it('a decided approval is never resolved again', () => {
        expect(planReply({ intent: yes, approvals: [appr({ status: 'approved' })], pendingRename: null, nowMs: T })).toEqual({ type: 'none' })
    })
})

describe('queued decision replay', () => {
    it('sends only while still waiting, unexpired, and unchanged', () => {
        const q = appr({ status: 'decision_queued' })
        expect(replayCheck(q, 'h1', T)).toBe('send')
        expect(replayCheck(q, 'h1', T + 3_600_000)).toBe('expired')
        expect(replayCheck({ ...q, details_hash: 'h2' }, 'h1', T)).toBe('changed')
        expect(replayCheck(appr({ status: 'approved' }), 'h1', T)).toBe('not_queued')
        expect(replayCheck(null, 'h1', T)).toBe('missing')
    })
})

describe('queue ordering', () => {
    const row = (id: string, chat: string, created: number, o: Record<string, string | null> = {}) => ({
        id, chat_guid: chat, status: 'queued', created_at: new Date(created).toISOString(),
        next_attempt_at: new Date(o.next ? Date.parse(o.next) : 0).toISOString(), locked_until: (o.locked as string) ?? null,
    })
    it('only the oldest queued row per chat is due', () => {
        const rows = [row('b', 'A', 2000), row('a', 'A', 1000), row('c', 'B', 1500)]
        expect(dueQueueHeads(rows, T).map((r) => r.id).sort()).toEqual(['a', 'c'])
    })
    it('a backed-off head holds back its chat', () => {
        const rows = [row('a', 'A', 1000, { next: new Date(T + 60_000).toISOString() }), row('b', 'A', 2000)]
        expect(dueQueueHeads(rows, T)).toEqual([])
    })
    it('a locked head is not due', () => {
        const rows = [row('a', 'A', 1000, { locked: new Date(T + 60_000).toISOString() })]
        expect(dueQueueHeads(rows, T)).toEqual([])
    })
    it('backoff doubles and caps at 30 minutes', () => {
        expect(queueBackoffMs(1)).toBe(30_000)
        expect(queueBackoffMs(2)).toBe(60_000)
        expect(queueBackoffMs(20)).toBe(30 * 60_000)
    })
})

describe('Dock status mapping', () => {
    it('maps statuses to outcomes', () => {
        expect(mapStatus(401)).toBe('unauthorized')
        expect(mapStatus(404)).toBe('not_found')
        expect(mapStatus(409)).toBe('conflict')
        expect(mapStatus(410)).toBe('expired')
        expect(mapStatus(422)).toBe('changed')
        expect(mapStatus(503)).toBe('unreachable')
        expect(mapStatus(400)).toBe('rejected')
    })
})
