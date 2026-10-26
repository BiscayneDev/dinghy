import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ intake: vi.fn(), run: vi.fn(), jobs: [] as unknown[], tables: {} as Record<string, unknown>, update: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: (t: string) => {
    const q: any = { select: () => q, eq: () => q, not: () => q, or: () => q, is: () => q, in: () => q, lte: () => q, order: () => q, update: () => { h.update(t); return q }, limit: async () => ({ data: t === 'dinghy_redo_jobs' ? h.jobs : t === 'spectrum_messages' ? [{ role: 'user', content: 'c' }] : (h.tables[t] as unknown[]) ?? [] }),
        maybeSingle: async () => ({ data: h.tables[t] ?? null }), then: (r: (v: unknown) => void) => r({ data: null }) }
    return q } }) }))
vi.mock('@/lib/spectrum/redo-jobs', () => ({ redoMode: () => 'proof' }))
vi.mock('@/lib/spectrum/redo-intake', () => ({ intakeRedo: h.intake }))
vi.mock('@/lib/spectrum/redo-intake-runtime', () => ({ realIntakeDeps: () => ({}) }))
vi.mock('@/lib/spectrum/redo-worker-runtime', () => ({ runOneRedoJob: h.run }))
vi.mock('@/lib/spectrum/outbox', () => ({ enqueueOutbox: vi.fn() }))
vi.mock('@/lib/spectrum/deliverable-turn', () => ({ decideTurnDeliverable: async () => ({ kind: 'itinerary', request: 'x', redo: true }) }))
vi.mock('@/lib/files/deliverable-intent', () => ({ deliveredFileContext: () => ({ line: 'Page: https://p.example/a' }) }))
vi.mock('@/lib/files/origin', () => ({ fileUrlOf: () => 'https://p.example/a' }))
import { POST } from '@/app/api/internal/redo-proof/route'
const req = () => new Request('https://x.test/api/internal/redo-proof', { method: 'POST', headers: { authorization: 'Bearer s' } })
beforeEach(() => { vi.clearAllMocks(); process.env.CRON_SECRET = 's'; process.env.DINGHY_REDO_PROOF_CHAT = 'chat-x'; h.jobs = []; h.intake.mockResolvedValue('reply')
    h.tables = { dinghy_redo_authorizations: [{ id: 'a1', user_id: 'u', file_id: 'f', note_id: 'n' }], dinghy_files: { url: 'https://p.example/a' }, spectrum_messages: { content: 'c', created_at: '2026-01-01T00:00:00Z' }, spectrum_identities: { handle: 'h' } } })
describe('redo proof route', () => {
    it('passes the authorized page as the explicit target with no candidate list, so it never asks which page', async () => {
        h.tables.spectrum_messages = { content: 'c', created_at: '2026-01-01T00:00:00Z' }
        await POST(req()); const call = h.intake.mock.calls[0]
        expect(call[4]).toMatchObject({ replied: 'https://p.example/a', candidates: [] })
    })
    it('intake made no job: reports no_job_created, does not run the worker, never claims a queued job', async () => {
        const r = await POST(req()); const b = await r.json()
        expect(h.intake).toHaveBeenCalled(); expect(b.verdict).toBe('no_job_created'); expect(h.run).not.toHaveBeenCalled()
    })
    it('a created job that the worker did not pick up is the only queued verdict', async () => {
        h.jobs = [{ id: 'j1' }]; h.run.mockResolvedValue({ ran: false }); const r = await POST(req())
        expect(h.intake).toHaveBeenCalled(); expect((await r.json()).verdict).toBe('queued_for_cron_rescue')
    })
})
