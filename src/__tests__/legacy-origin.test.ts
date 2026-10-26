import { describe, it, expect } from 'vitest'
import { bindLegacyOrigin, type ChatRow, type RunStage } from '@/lib/spectrum/legacy-origin'

// Fictional ids and request text only. Times in ms from an arbitrary zero.
const file = { id: 'file-1', createdAt: 120_000 }
const stage = (run: string, at: number, s: string, detail: string | null = null, mid: string | null = 'msg-1'): RunStage => ({ run_id: run, message_id: mid, stage: s, detail, at })
const base: RunStage[] = [stage('run-1', 2_000, 'context', 'deliverable:itinerary'), stage('run-1', 119_000, 'reply_ready', 'deliverable:itinerary:completed')]
const rows: ChatRow[] = [
    { id: 'u0', role: 'user', content: 'older unrelated message', at: -500_000 },
    { id: 'u1', role: 'user', content: 'Plan a fictional trip to Atlantis with two stops, leaving on the first Monday.', at: 1_000 },
    { id: 'a1', role: 'assistant', content: 'On it.', at: 1_500 },
]
describe('legacy origin binding', () => {
    it('binds to the one user message that started the one completed deliverable run, verbatim, with source ids', () => {
        const r = bindLegacyOrigin(file, base, rows)
        expect(r).toMatchObject({ ok: true, request: 'Plan a fictional trip to Atlantis with two stops, leaving on the first Monday.', evidence: { fileId: 'file-1', runId: 'run-1', messageId: 'msg-1', userRowId: 'u1' } })
    })
    it('no deliverable run near the file: a specific gap', () => {
        expect(bindLegacyOrigin({ ...file, createdAt: 900_000 }, base, rows)).toEqual({ ok: false, gap: 'no_deliverable_run' })
    })
    it('two completed runs near the file: ambiguous', () => {
        const two = [...base, stage('run-2', 118_000, 'reply_ready', 'deliverable:itinerary:completed', 'msg-2')]
        expect(bindLegacyOrigin(file, two, rows)).toEqual({ ok: false, gap: 'ambiguous_run' })
    })
    it('no user message just before the run: gap', () => {
        expect(bindLegacyOrigin(file, base, rows.filter((r) => r.id !== 'u1'))).toEqual({ ok: false, gap: 'no_user_message' })
    })
    it('another user message between the request and the file: ambiguous, not a guess', () => {
        const more = [...rows, { id: 'u2', role: 'user' as const, content: 'also add a spa day', at: 60_000 }]
        expect(bindLegacyOrigin(file, base, more)).toEqual({ ok: false, gap: 'ambiguous_user_message' })
    })
    it('does not resolve or alter dates in the request', () => {
        const r = bindLegacyOrigin(file, base, [{ ...rows[1], content: 'Leave Sunday the 16th, back after the 20th' }])
        expect(r.ok && r.request).toBe('Leave Sunday the 16th, back after the 20th')
    })
})
