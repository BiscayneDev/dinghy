/**
 * In-memory DockStore and scripted fake Dock for the connector tests. Mirrors the Supabase store's
 * conditional updates (transitionApproval, lockQueueRow) so the single-resolution rules are exercised.
 */

import type { DockApprovalRow, DockLinkRow, DockQueueRow, DockStore } from '@/lib/dock/store'
import type { DockDeps } from '@/lib/dock/service'

export function memStore(clock: { t: number }) {
    const links = new Map<string, DockLinkRow>()
    const codes = new Map<string, string>()
    const events = new Set<string>()
    const approvals = new Map<string, DockApprovalRow>()
    const grants = new Map<string, string>()
    const queue: DockQueueRow[] = []
    let seq = 0
    const iso = (ms: number) => new Date(ms).toISOString()

    const store: DockStore = {
        async getLinkByChat(c) {
            const l = links.get(c)
            return l && l.status === 'linked' ? { ...l } : null
        },
        async getLinkByRef(r) {
            for (const l of links.values()) if (l.link_ref === r) return { ...l }
            return null
        },
        async saveLink(row) {
            links.set(row.chat_guid, { ...row })
        },
        async markUnlinked(c) {
            const l = links.get(c)
            if (l) links.set(c, { ...l, status: 'unlinked', pending_chief_name: null, token_ciphertext: 'revoked' })
        },
        async setChiefName(c, name, pending) {
            const l = links.get(c)
            if (!l) return
            links.set(c, { ...l, chief_name: name ?? l.chief_name, pending_chief_name: pending })
        },
        async reserveCode(hash, chat) {
            if (codes.has(hash)) return false
            codes.set(hash, chat)
            return true
        },
        async releaseCode(hash) {
            codes.delete(hash)
        },
        async recordEvent(id) {
            if (events.has(id)) return false
            events.add(id)
            return true
        },
        async getGrant(chat, ws) {
            const at = grants.get(`${chat}${ws}`)
            return at ? { granted_at: at } : null
        },
        async saveGrant(chat, ws) {
            grants.set(`${chat}${ws}`, iso(clock.t))
        },
        async deleteGrants(chat) {
            for (const k of [...grants.keys()]) if (k.startsWith(chat + '')) grants.delete(k)
        },
        async listApprovals(c) {
            return [...approvals.values()].filter((a) => a.chat_guid === c && (a.status === 'pending' || a.status === 'decision_queued'))
        },
        async getApproval(id) {
            const a = approvals.get(id)
            return a ? { ...a } : null
        },
        async upsertApproval(row) {
            const prev = approvals.get(row.id)
            approvals.set(row.id, {
                ...row,
                status: row.status ?? prev?.status ?? 'pending',
                decision: prev?.decision ?? null,
                shown_hash: null,
            } as DockApprovalRow)
        },
        async setShownHash(id, hash) {
            const a = approvals.get(id)
            if (a) approvals.set(id, { ...a, shown_hash: hash })
        },
        async transitionApproval(id, from, to) {
            const a = approvals.get(id)
            if (!a || !from.includes(a.status)) return false
            approvals.set(id, {
                ...a,
                status: to.status,
                decision: to.decision !== undefined ? to.decision : a.decision,
            })
            return true
        },
        async enqueue(row) {
            seq++
            queue.push({
                id: `q${seq}`,
                chat_guid: row.chat_guid,
                kind: row.kind,
                payload: row.payload,
                status: 'queued',
                attempts: 0,
                next_attempt_at: iso(clock.t),
                locked_until: null,
                expires_at: row.expires_at,
                created_at: iso(1_000_000 + seq),
            })
        },
        async listQueued(limit) {
            return queue.filter((r) => r.status === 'queued').slice(0, limit).map((r) => ({ ...r }))
        },
        async lockQueueRow(id, until) {
            const r = queue.find((x) => x.id === id)
            if (!r || r.status !== 'queued') return false
            if (r.locked_until && Date.parse(r.locked_until) > clock.t) return false
            r.locked_until = until
            return true
        },
        async updateQueueRow(id, patch) {
            const r = queue.find((x) => x.id === id)
            if (!r) return
            const { last_error, sent_at, ...rest } = patch
            Object.assign(r, rest)
            if (last_error !== undefined) r.last_error = last_error
            if (sent_at !== undefined) r.sent_at = sent_at
        },
    } as DockStore & { _last?: never }

    return { store, links, approvals, queue, codes, events, grants }
}

export type Route = (body: Record<string, unknown>, auth: string | null) => { status: number; json?: unknown } | 'unreachable'

export function fakeDock(routes: Record<string, Route>) {
    const calls: Array<{ path: string; body: Record<string, unknown>; auth: string | null }> = []
    const fetchImpl = (async (url: string, init: RequestInit) => {
        const path = new URL(url).pathname
        const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>
        const headers = init.headers as Record<string, string>
        const auth = headers.authorization ?? null
        calls.push({ path, body, auth })
        const route = routes[path] ?? routes[path.replace(/\/approvals\/[^/]+\//, '/approvals/:id/')]
        if (!route) return new Response('{}', { status: 404 })
        const out = route(body, auth)
        if (out === 'unreachable') throw new TypeError('fetch failed')
        return new Response(JSON.stringify(out.json ?? {}), { status: out.status, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch
    return { calls, fetchImpl }
}

export function harness(opts: { routes: Record<string, Route>; sent?: Array<{ chat: string; text: string }> }) {
    const clock = { t: Date.parse('2026-10-22T14:00:00Z') }
    const mem = memStore(clock)
    const dock = fakeDock(opts.routes)
    const sent = opts.sent ?? []
    const deps: DockDeps = {
        store: mem.store,
        send: async (chat, text) => {
            sent.push({ chat, text })
        },
        baseUrl: 'https://dock.test',
        fetchImpl: dock.fetchImpl,
        now: () => clock.t,
        newLinkRef: () => 'ref_' + 'a'.repeat(28),
    }
    return { clock, mem, dock, deps, sent }
}
