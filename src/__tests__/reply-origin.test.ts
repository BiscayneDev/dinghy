import { describe, it, expect, vi } from 'vitest'
import type { IntakeDeps, RedoFileRow } from '@/lib/spectrum/redo-intake'
import { bindLegacyOrigin } from '@/lib/spectrum/legacy-origin'
import { recoverRepliedPageRequest, withPageRequest } from '@/lib/spectrum/reply-origin'

// Fictional data only. Shape: a page made before origins were stored (origin columns null), then a bare native reply.
const LEGACY: RedoFileRow = { id: 'f1', created_at: '2026-01-01T10:00:10Z', origin_request: null, origin_google_derived: false, origin_kind: null, kind: 'itinerary' }
const at = Date.parse('2026-01-01T10:00:10Z')
const ORIGINAL = 'Plan Saturday in Fictionville: 9am coffee, 11am museum, 4pm ceremony.'
const stages = [{ run_id: 'r1', message_id: 'm1', stage: 'reply_ready', detail: 'deliverable:itinerary:completed', at: at - 500 }, { run_id: 'r1', message_id: 'm1', stage: 'context', detail: 'x', at: at - 40_000 }]
const rows = [{ id: 'u-1', role: 'user' as const, content: ORIGINAL, at: at - 40_500 }]
function deps(over: Partial<IntakeDeps> = {}): IntakeDeps {
    return {
        userId: async () => 'u1', file: async () => LEGACY,
        legacy: async (file) => ({ origin: bindLegacyOrigin({ id: file.id, createdAt: Date.parse(file.created_at) }, stages, rows), google: false }),
        saveLegacyOrigin: vi.fn(async () => true), noteId: async () => null, active: async () => null,
        upsert: vi.fn(async () => ({ status: 'created' as const, jobId: 'j', revision: 1 })), cancel: async () => null, heldVerdict: async () => null, openPending: async () => null, ...over,
    }
}
describe('request behind a natively replied page', () => {
    it('legacy page with null origin: strict binder recovers the full original request and saves it with its Google flag', async () => {
        const d = deps(); const r = await recoverRepliedPageRequest(d, 'chat', 'https://p.example/a')
        expect(r).toEqual({ ok: true, request: ORIGINAL })
        expect(d.saveLegacyOrigin).toHaveBeenCalledWith('u1', 'chat', LEGACY, ORIGINAL, false, { runId: 'r1', messageId: 'm1' })
        const combined = withPageRequest(ORIGINAL, 'This one')
        expect(combined).toContain('9am coffee'); expect(combined).toContain('This one'); expect(combined.startsWith(ORIGINAL)).toBe(true)
    })
    it('Google-derived binding is saved flagged so retention expiry applies', async () => {
        const save = vi.fn(async (..._a: unknown[]) => true); const d = deps({ legacy: async (f) => ({ origin: bindLegacyOrigin({ id: f.id, createdAt: Date.parse(f.created_at) }, stages, rows), google: true }), saveLegacyOrigin: save })
        await recoverRepliedPageRequest(d, 'chat', 'https://p.example/a', at + 86_400_000); expect(save.mock.calls[0][4]).toBe(true)
    })
    it('stored origin is used verbatim without touching the binder', async () => {
        const legacy = vi.fn(async () => null); const r = await recoverRepliedPageRequest(deps({ file: async () => ({ ...LEGACY, origin_request: 'ORIGIN: x' }), legacy }), 'chat', 'u')
        expect(r).toEqual({ ok: true, request: 'ORIGIN: x' }); expect(legacy).not.toHaveBeenCalled()
    })
    it('refuses, never guesses: another user, another chat or deleted page (no row), ambiguous run, unsaved binding, no user', async () => {
        expect(await recoverRepliedPageRequest(deps({ file: async () => null }), 'chat', 'u')).toEqual({ ok: false, reason: 'page_not_found' })
        expect(await recoverRepliedPageRequest(deps({ userId: async () => null }), 'chat', 'u')).toEqual({ ok: false, reason: 'no_user' })
        const two = [...stages, { run_id: 'r2', message_id: 'm2', stage: 'reply_ready', detail: 'deliverable:itinerary:completed', at: at + 100 }]
        const amb = deps({ legacy: async (f) => ({ origin: bindLegacyOrigin({ id: f.id, createdAt: Date.parse(f.created_at) }, two, rows), google: false }) })
        expect(await recoverRepliedPageRequest(amb, 'chat', 'u')).toEqual({ ok: false, reason: 'origin_unrecoverable' })
        expect(await recoverRepliedPageRequest(deps({ saveLegacyOrigin: async () => false }), 'chat', 'u')).toEqual({ ok: false, reason: 'origin_not_saved' })
        expect(await recoverRepliedPageRequest(deps({ legacy: async () => null }), 'chat', 'u')).toEqual({ ok: false, reason: 'origin_unrecoverable' })
    })
})
describe('retention before any recovery', () => {
    const DAY = 86_400_000, NOW = Date.parse('2026-03-01T00:00:00Z'), OLD = new Date(NOW - 45 * DAY).toISOString(), RECENT = new Date(NOW - 2 * DAY).toISOString()
    const oldStages = stages.map((s) => ({ ...s, at: Date.parse(OLD) + (s.at - at) })), oldRows = rows.map((r) => ({ ...r, at: Date.parse(OLD) + (r.at - at) }))
    const legacyDeps = (file: RedoFileRow, google: boolean, save = vi.fn(async (..._a: unknown[]) => true)) => deps({ file: async () => file, saveLegacyOrigin: save,
        legacy: async (f) => ({ origin: bindLegacyOrigin({ id: f.id, createdAt: Date.parse(f.created_at) }, oldStages.map((s) => ({ ...s, at: s.at + (Date.parse(f.created_at) - Date.parse(OLD)) })), oldRows.map((r) => ({ ...r, at: r.at + (Date.parse(f.created_at) - Date.parse(OLD)) }))), google }) })
    it('expired Google-derived origin with a recoverable old source: refused, binder never read, nothing saved', async () => {
        const legacy = vi.fn(async () => null), save = vi.fn(async (..._a: unknown[]) => true)
        const d = deps({ file: async () => ({ ...LEGACY, created_at: OLD, origin_request: 'GOOGLE-DERIVED TEXT', origin_google_derived: true }), legacy, saveLegacyOrigin: save })
        const r = await recoverRepliedPageRequest(d, 'chat', 'u', NOW); expect(r).toEqual({ ok: false, reason: 'retention' })
        expect(JSON.stringify(r)).not.toContain('GOOGLE-DERIVED'); expect(legacy).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled()
    })
    it('legacy page past the Google window whose old chat rows are still readable: refused, not re-bound or saved', async () => {
        const save = vi.fn(async (..._a: unknown[]) => true)
        const r = await recoverRepliedPageRequest(legacyDeps({ ...LEGACY, created_at: OLD }, true, save), 'chat', 'u', NOW)
        expect(r).toEqual({ ok: false, reason: 'retention' }); expect(save).not.toHaveBeenCalled()
    })
    it('ordinary expired page (expires_at passed): refused before any read, even with a stored origin', async () => {
        const legacy = vi.fn(async () => null)
        const r = await recoverRepliedPageRequest(deps({ file: async () => ({ ...LEGACY, expires_at: new Date(NOW - 1000).toISOString(), origin_request: 'ORIGIN: x' }), legacy }), 'chat', 'u', NOW)
        expect(r).toEqual({ ok: false, reason: 'expired' }); expect(legacy).not.toHaveBeenCalled()
    })
    it('valid non-Google legacy page, even older than the Google window, still recovers; a recent Google one recovers and is saved flagged', async () => {
        expect(await recoverRepliedPageRequest(legacyDeps({ ...LEGACY, created_at: OLD }, false), 'chat', 'u', NOW)).toEqual({ ok: true, request: ORIGINAL })
        const save = vi.fn(async (..._a: unknown[]) => true)
        expect(await recoverRepliedPageRequest(legacyDeps({ ...LEGACY, created_at: RECENT }, true, save), 'chat', 'u', NOW)).toEqual({ ok: true, request: ORIGINAL }); expect(save.mock.calls[0][4]).toBe(true)
    })
})
