import { describe, it, expect, vi } from 'vitest'
import { intakeRedo, type IntakeDeps, type RedoFileRow } from '@/lib/spectrum/redo-intake'
import { executeRedoJob, RedoCancelled, type WorkerDeps } from '@/lib/spectrum/redo-worker'
import { redoInstruction } from '@/lib/files/deliverable-intent'

// Fictional data only.
const FILE: RedoFileRow = { id: 'f1', created_at: '2026-01-01T00:00:00Z', origin_request: 'ORIGIN: plan a fictional two-stop trip', origin_google_derived: false, origin_kind: 'itinerary', kind: 'itinerary' }
function intakeDeps(over: Partial<IntakeDeps> = {}): IntakeDeps {
    return {
        userId: async () => 'u1', file: async () => FILE, legacy: async () => null, saveLegacyOrigin: async () => true, noteId: async () => 'm9',
        active: async () => null, upsert: vi.fn(async () => ({ status: 'created' as const, jobId: 'j1', revision: 1 })), cancel: vi.fn(async () => ({ status: 'running', phase: 'building' })),
        heldVerdict: async () => 'new_instruction', ...over,
    }
}
describe('redo intake', () => {
    it('creates a durable job and answers without waiting or promising a retry', async () => {
        const d = intakeDeps(); const r = await intakeRedo('chat', 'https://x.here.now/', 'this is wrong', d)
        expect(r).toMatch(/rebuilding that page and will send it/); expect(d.upsert).toHaveBeenCalledWith('u1', 'chat', 'f1', 'm9')
        expect(r).not.toMatch(/tell me again|next time|saved/i)
    })
    it('refuses with a specific honest reply when the page is not the user’s or has no file row', async () => {
        expect(await intakeRedo('chat', 'https://x.here.now/', 't', intakeDeps({ file: async () => null }))).toMatch(/Nothing was changed/)
        expect(await intakeRedo('chat', null, 't', intakeDeps())).toMatch(/Nothing was changed/)
    })
    it('no origin and no reliable legacy binding: specific gap, no job', async () => {
        const d = intakeDeps({ file: async () => ({ ...FILE, origin_request: null }), legacy: async () => ({ origin: { ok: false, gap: 'ambiguous_run' }, google: false }) })
        expect(await intakeRedo('chat', 'https://x.here.now/', 't', d)).toMatch(/tie that page back/); expect(d.upsert).not.toHaveBeenCalled()
    })
    it('legacy file with a reliable binding saves the origin then queues the job', async () => {
        const save = vi.fn(async () => true)
        const d = intakeDeps({ file: async () => ({ ...FILE, origin_request: null }), saveLegacyOrigin: save, legacy: async () => ({ origin: { ok: true, request: 'VERBATIM', evidence: { fileId: 'f1', runId: 'r1', messageId: 'mm', userRowId: 'u' } }, google: true }) })
        expect(await intakeRedo('chat', 'https://x.here.now/', 't', d)).toMatch(/rebuilding/)
        expect(save).toHaveBeenCalledWith('u1', 'chat', expect.anything(), 'VERBATIM', true, { runId: 'r1', messageId: 'mm' })
    })
    it('a missing stored note id means no job and an honest reply', async () => {
        const d = intakeDeps({ noteId: async () => null }); expect(await intakeRedo('chat', 'https://x.here.now/', 't', d)).toMatch(/nothing was changed/i); expect(d.upsert).not.toHaveBeenCalled()
    })
    it('active job: repeat adds nothing, stop cancels honestly, new instruction appends and says if it will need another version', async () => {
        const active = async () => ({ id: 'j1', phase: 'building' })
        const rep = intakeDeps({ active, heldVerdict: async () => 'repeat' }); expect(await intakeRedo('c', 'https://x.here.now/', 't', rep)).toMatch(/Still on it/); expect(rep.upsert).not.toHaveBeenCalled()
        const stop = intakeDeps({ active, heldVerdict: async () => 'stop' }); expect(await intakeRedo('c', 'https://x.here.now/', 't', stop)).toMatch(/Stopping it now/); expect(stop.cancel).toHaveBeenCalled()
        const late = intakeDeps({ active, heldVerdict: async () => 'stop', cancel: async () => ({ status: 'running', phase: 'sending' }) }); expect(await intakeRedo('c', 'https://x.here.now/', 't', late)).toMatch(/cannot unsend/)
        const add = intakeDeps({ active, upsert: vi.fn(async () => ({ status: 'appended' as const, jobId: 'j1', revision: 2, phase: 'building' })) }); expect(await intakeRedo('c', 'https://x.here.now/', 't', add)).toMatch(/adding that/)
        const lateAdd = intakeDeps({ active, upsert: vi.fn(async () => ({ status: 'appended' as const, jobId: 'j1', revision: 2, phase: 'sending' })) }); expect(await intakeRedo('c', 'https://x.here.now/', 't', lateAdd)).toMatch(/one more version/)
        const unsure = intakeDeps({ active, heldVerdict: async () => null }); await intakeRedo('c', 'https://x.here.now/', 't', unsure); expect(unsure.upsert).toHaveBeenCalled()
    })
    it('unknown active state or failed upsert never claims success', async () => {
        expect(await intakeRedo('c', 'https://x.here.now/', 't', intakeDeps({ active: async () => 'unknown' }))).toMatch(/could not start/)
        expect(await intakeRedo('c', 'https://x.here.now/', 't', intakeDeps({ upsert: async () => ({ status: 'unknown' as const }) }))).toMatch(/could not start/)
    })
})

const JOB = { id: 'j1', user_id: 'u1', chat_guid: 'chat', file_id: 'f1', lineage_id: 'f1', claim_id: 'c1', op_id: 'o1', note_ids: ['m1'], note_revision: 1, consumed_revision: 0, passes: 1, resumes: 0 }
function workerDeps(over: Partial<WorkerDeps> = {}) {
    const calls: string[] = []
    const base: WorkerDeps = {
        boundUser: async () => 'u1', file: async () => ({ id: 'f1', origin_request: 'ORIGIN', origin_google_derived: false, origin_kind: 'itinerary', kind: 'itinerary' }),
        notes: async (_u, _c, ids) => ids.map((i) => ({ text: 'note ' + i, google: false })), jobRow: async () => ({ note_ids: ['m1'], note_revision: 1 }),
        advance: async (p) => { calls.push('advance:' + p); return 'ok' }, close: async () => { calls.push('close'); return 'done' }, fail: async (r) => { calls.push('fail:' + r); return true },
        notify: async (t) => { calls.push('notify'); void t; return true },
        build: async ({ instruction, gate }) => { calls.push('build'); if ((await gate(false)).cancelled) throw new RedoCancelled(); if ((await gate(true)).cancelled) throw new RedoCancelled(); calls.push('instr:' + instruction.includes('ORIGIN') + instruction.includes('note m1')); return { files: [{ url: 'https://n.here.now/', hosted: true }], tainted: false } },
        send: async () => { calls.push('send') }, discard: async () => { calls.push('discard'); return 'removed' }, saveOrigin: async () => { calls.push('saveOrigin'); return true },
    }
    return { deps: { ...base, ...over }, calls }
}
describe('redo worker', () => {
    it('builds from the stored origin plus notes only, fences publish and send, binds origin before send, closes', async () => {
        const { deps, calls } = workerDeps(); expect(await executeRedoJob(JOB as never, deps)).toBe('done')
        expect(calls).toEqual(['build', 'advance:building', 'advance:publishing', 'instr:truetrue', 'advance:published', 'advance:sending', 'saveOrigin', 'send', 'advance:sent', 'close'])
        expect(redoInstruction('O', ['n'])).toContain('Original request:\nO')
    })
    it('owner mismatch, missing origin, unknown kind: terminal, notified, nothing built', async () => {
        for (const [over, reason] of [[{ boundUser: async () => 'other' }, 'owner_mismatch'], [{ file: async () => ({ id: 'f1', origin_request: null, origin_google_derived: false, origin_kind: null, kind: 'file' }) }, 'origin_unavailable'], [{ file: async () => ({ id: 'f1', origin_request: 'O', origin_google_derived: false, origin_kind: null, kind: 'file' }) }, 'kind_unknown']] as const) {
            const { deps, calls } = workerDeps(over as never); expect(await executeRedoJob(JOB as never, deps)).toBe('failed'); expect(calls).toContain('fail:' + reason); expect(calls).not.toContain('build')
        }
    })
    it('a required note that is gone fails terminally and names the cause, it is never dropped', async () => {
        const { deps, calls } = workerDeps({ notes: async () => null }); expect(await executeRedoJob(JOB as never, deps)).toBe('failed'); expect(calls).toContain('fail:note_unavailable'); expect(calls).not.toContain('send')
    })
    it('cancel at the gate stops before send', async () => {
        const { deps, calls } = workerDeps({ advance: async (p) => (p === 'publishing' ? 'cancelled' : 'ok') }); expect(await executeRedoJob(JOB as never, deps)).toBe('cancelled'); expect(calls).not.toContain('send')
    })
    it('cancel at the send fence: built but not sent, honest notice', async () => {
        const { deps, calls } = workerDeps({ advance: async (p) => (p === 'sending' ? 'cancelled' : 'ok') }); expect(await executeRedoJob(JOB as never, deps)).toBe('cancelled'); expect(calls).toContain('discard'); expect(calls).toContain('notify'); expect(calls).not.toContain('send')
    })
    it('a stale claim (lost lease) sends nothing', async () => {
        const { deps, calls } = workerDeps({ advance: async (p) => (p === 'building' ? 'ok' : 'lost') }); expect(await executeRedoJob(JOB as never, deps)).toBe('blocked'); expect(calls).not.toContain('send')
    })
    it('a late note after send requeues another pass instead of claiming the version had it', async () => {
        const { deps } = workerDeps({ close: async () => 'requeued' }); expect(await executeRedoJob(JOB as never, deps)).toBe('requeued')
    })
    it('pass cap with an unapplied note tells the user which gap remains', async () => {
        const { deps, calls } = workerDeps({ close: async () => 'note_unapplied' }); expect(await executeRedoJob(JOB as never, deps)).toBe('note_unapplied'); expect(calls.filter((c) => c === 'notify')).toHaveLength(1)
    })
    it('no file made: fail without claiming anything was sent', async () => {
        const { deps, calls } = workerDeps({ build: async () => ({ files: [], tainted: false }) }); expect(await executeRedoJob(JOB as never, deps)).toBe('failed'); expect(calls).toContain('fail:no_file'); expect(calls).not.toContain('send')
    })
    it('Google-derived input (note or origin or tainted result) carries into the new origin', async () => {
        let flagged: boolean | null = null
        const { deps } = workerDeps({ notes: async (_u, _c, ids) => ids.map((i) => ({ text: i, google: true })), saveOrigin: async (_u, _r, g) => { flagged = g; return true } })
        await executeRedoJob(JOB as never, deps); expect(flagged).toBe(true)
    })
    it('an unexpected error after work began is rethrown, never retried here', async () => {
        const { deps } = workerDeps({ send: async () => { throw new Error('transport') } }); await expect(executeRedoJob(JOB as never, deps)).rejects.toThrow('transport')
    })
    it('the worker’s own cancel class is honoured', async () => {
        const { deps } = workerDeps({ build: async () => { throw new RedoCancelled() } }); expect(await executeRedoJob(JOB as never, deps)).toBe('cancelled')
    })
})
