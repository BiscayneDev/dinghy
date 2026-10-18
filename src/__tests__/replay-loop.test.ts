import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Same guard as the dry-run tests: once armed, ANY database client use during a replay fails the test.
const db = vi.hoisted(() => ({ armed: false, uses: 0 }))
const supa = vi.hoisted(() => vi.fn(() => new Proxy(function () {}, { get() { if (db.armed) { db.uses++; throw new Error('replay touched the database') } return () => ({}) }, apply() { if (db.armed) db.uses++; return {} } })))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: supa }))

import { buildCapture, selectFailure, fetchRunCapture, type RunStageRow } from '@/lib/replay/capture'
import { replayTurn } from '@/lib/replay/runner'
import { ruleVerdict, parseJudgeVerdict, hasFailureMarkers } from '@/lib/replay/judge'
import { makeLesson, appendLesson, loadLessons, acceptedOverlays, quotesUserText } from '@/lib/replay/lessons'
import { replayLoop } from '@/lib/replay/loop'
import type { TurnCapture } from '@/lib/replay/types'
import type { Tool, UserContext } from '@/lib/llm/types'

beforeEach(() => { supa.mockClear(); db.armed = true; db.uses = 0 })

// Fictional failed turn: "weather" ask, tool stage timed out. No real user data.
const RUN_ROWS: RunStageRow[] = [
    { run_id: 'fictional-weather-stall', chat_guid: 'chat-fictional-001', message_id: 'm1', stage: 'context', detail: 'preflight_ms=120', created_at: '2026-10-18T19:43:15.000Z' },
    { run_id: 'fictional-weather-stall', chat_guid: 'chat-fictional-001', message_id: 'm1', stage: 'gateway', detail: '1', created_at: '2026-10-18T19:43:16.000Z' },
    { run_id: 'fictional-weather-stall', chat_guid: 'chat-fictional-001', message_id: 'm1', stage: 'failed', detail: 'weather:timeout', created_at: '2026-10-18T19:43:24.000Z' },
]
const MSG_ROWS = [
    { role: 'user' as const, content: 'hi, what can you do?', created_at: '2026-10-18T19:40:00.000Z' },
    { role: 'assistant' as const, content: 'I can look things up, set reminders, make files and more.', created_at: '2026-10-18T19:40:04.000Z' },
    { role: 'user' as const, content: 'what is the weather in Bay Harbor this weekend', created_at: '2026-10-18T19:43:14.000Z' },
]
const CAPTURE: TurnCapture = {
    runId: 'fictional-weather-stall',
    chatGuid: 'chat-fictional-001',
    capturedAt: '2026-10-18T19:43:24.000Z',
    failure: { stage: 'failed', detail: 'weather:timeout' },
    history: MSG_ROWS.map((m) => ({ role: m.role, content: m.content })),
}

type Llm = (h: unknown, o: { volatile?: string }, tools: Tool[], ctx: UserContext) => Promise<{ reply: string; toolCalls: number; iterations: number }>
/** Scripted model: baseline admits failure; any overlay makes it call the (stubbed) weather tool and answer. */
const scriptedWeather: Llm = async (_h, opts, tools, ctx) => {
    if (!opts.volatile) return { reply: "I couldn't pull the weather just now - try again in a moment.", toolCalls: 0, iterations: 1 }
    const t = tools.find((x) => x.name === 'weather')
    if (!t) throw new Error('weather tool not offered')
    await t.execute({ place: 'Bay Harbor' }, ctx)
    return { reply: 'Bay Harbor this weekend: Saturday 79 and sunny, Sunday 81 with a late storm chance.', toolCalls: 1, iterations: 2 }
}

describe('capture', () => {
    it('selectFailure prefers the failed row and keeps its detail', () => {
        const f = selectFailure(RUN_ROWS)
        expect(f.stage).toBe('failed')
        expect(f.detail).toBe('weather:timeout')
    })

    it('selectFailure falls back to the last stage seen', () => {
        const f = selectFailure(RUN_ROWS.filter((r) => r.stage !== 'failed'))
        expect(f.stage).toBe('gateway')
    })

    it('buildCapture reconstructs the windowed history ending on the ask', () => {
        const c = buildCapture({ runId: 'r', chatGuid: 'g' }, selectFailure(RUN_ROWS), MSG_ROWS)
        expect(c.history[c.history.length - 1]!.role).toBe('user')
        expect(c.history.length).toBe(3)
        expect(c.failure.stage).toBe('failed')
    })

    it('buildCapture refuses a cut that ends on an assistant message', () => {
        expect(() => buildCapture({ runId: 'r', chatGuid: 'g' }, selectFailure(RUN_ROWS), MSG_ROWS.slice(0, 2))).toThrow(/assistant message/)
    })

    it('fetchRunCapture joins run stages to messages via the injected fetch', async () => {
        const seen: string[] = []
        const fetchImpl = async (url: string) => {
            seen.push(url)
            const rows = url.includes('dinghy_run_stages') ? RUN_ROWS : MSG_ROWS
            return { ok: true, status: 200, json: async () => rows }
        }
        const c = await fetchRunCapture({ supabaseUrl: 'https://fictional.supabase.co', serviceKey: 'k', runId: 'fictional-weather-stall', fetchImpl })
        expect(c.runId).toBe('fictional-weather-stall')
        expect(c.history.length).toBe(3)
        expect(seen[0]).toContain('dinghy_run_stages')
        expect(seen[1]).toContain('spectrum_messages')
    })
})

describe('replay', () => {
    it('replays baseline and candidate without touching the database', async () => {
        const baseline = await replayTurn(CAPTURE, { chat: scriptedWeather as never })
        const candidate = await replayTurn(CAPTURE, { chat: scriptedWeather as never, overlay: 'Retry a stalled tool once before admitting failure.' })
        expect(supa).not.toHaveBeenCalled()
        expect(db.uses).toBe(0)
        expect(baseline.label).toBe('baseline')
        expect(hasFailureMarkers(baseline.reply).length).toBeGreaterThan(0)
        expect(candidate.toolCalls[0]?.name).toBe('weather')
        expect(candidate.toolCalls[0]?.status).toBe('ok')
        expect(candidate.reply).toContain('Bay Harbor')
    })
})

describe('judge', () => {
    it('rules for the candidate when only the baseline admits failure', () => {
        const v = ruleVerdict(
            { label: 'baseline', reply: "I couldn't pull the weather just now.", toolCalls: [], iterations: 1, overlay: null },
            { label: 'c', reply: 'Bay Harbor: 79 and sunny Saturday.', toolCalls: [], iterations: 2, overlay: 'x' }
        )
        expect(v?.winner).toBe('candidate')
    })

    it('rules for the baseline when the candidate introduces the failure admission', () => {
        const v = ruleVerdict(
            { label: 'baseline', reply: 'Bay Harbor: 79 and sunny Saturday.', toolCalls: [], iterations: 1, overlay: null },
            { label: 'c', reply: 'Something went wrong, try again later.', toolCalls: [], iterations: 1, overlay: 'x' }
        )
        expect(v?.winner).toBe('baseline')
    })

    it('returns null when rules cannot call it', () => {
        const v = ruleVerdict(
            { label: 'baseline', reply: 'Here is one take.', toolCalls: [], iterations: 1, overlay: null },
            { label: 'c', reply: 'Here is another take.', toolCalls: [], iterations: 1, overlay: 'x' }
        )
        expect(v).toBeNull()
    })

    it('treats an unparseable model verdict as a tie', () => {
        expect(parseJudgeVerdict('not json').winner).toBe('tie')
        expect(parseJudgeVerdict('{"winner":"nobody"}').winner).toBe('tie')
        expect(parseJudgeVerdict('{"winner":"candidate","reason":"it answers"}').winner).toBe('candidate')
    })
})

describe('lessons', () => {
    const draft = {
        failureStage: 'failed',
        failureDetail: 'weather:timeout',
        lesson: 'Retry a stalled live-info tool once before admitting failure.',
        overlay: 'If a live-info tool call stalls or errors, call it once more before answering.',
        evidence: { runId: 'fictional-weather-stall', contrast: 'baseline admitted failure; candidate answered' },
        voice: false,
    }

    it('writes a lesson as needs_review and round-trips the store', () => {
        const dir = mkdtempSync(join(tmpdir(), 'replay-'))
        const path = join(dir, 'lessons.jsonl')
        const lesson = makeLesson(draft, 'what is the weather in Bay Harbor this weekend')
        expect(lesson.status).toBe('needs_review')
        appendLesson(path, lesson)
        const loaded = loadLessons(path)
        expect(loaded.length).toBe(1)
        expect(loaded[0]!.failureDetail).toBe('weather:timeout')
        expect(acceptedOverlays(loaded)).toEqual([])
        expect(acceptedOverlays([{ ...lesson, status: 'accepted' as const }])).toEqual([lesson.overlay])
    })

    it('refuses a lesson or overlay that quotes the user', () => {
        expect(quotesUserText('when asked about the weather in bay harbor this weekend, retry', 'what is the weather in Bay Harbor this weekend')).toBe(true)
        expect(() => makeLesson({ ...draft, lesson: 'For what is the weather in Bay Harbor this weekend, retry.' }, 'what is the weather in Bay Harbor this weekend')).toThrow(/quotes/)
    })

    it('keeps voice-flagged lessons gated', () => {
        const lesson = makeLesson({ ...draft, voice: true }, 'what is the weather in Bay Harbor this weekend')
        expect(lesson.voice).toBe(true)
        expect(lesson.status).toBe('needs_review')
    })
})

describe('loop', () => {
    it('probes a retry candidate on the same turn, picks it, and writes one lesson', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'replay-'))
        const path = join(dir, 'lessons.jsonl')
        const result = await replayLoop(CAPTURE, {
            chat: scriptedWeather as never,
            propose: async () => [
                {
                    id: 'retry-after-tool-stall',
                    overlay: 'If a live-info tool call stalls or errors, call it once more before answering. Never admit failure after a single attempt.',
                    rationale: 'Single-attempt tool calls turn one network stall into a user-visible failure; retry before admitting failure.',
                    voice: false,
                },
            ],
        })
        expect(db.uses).toBe(0)
        expect(result.baseline.reply).toContain("couldn't")
        expect(result.winner?.candidate.id).toBe('retry-after-tool-stall')
        expect(result.lesson).not.toBeNull()
        expect(result.lesson!.status).toBe('needs_review')
        expect(result.lesson!.failureStage).toBe('failed')
        appendLesson(path, result.lesson!)
        const stored = loadLessons(path)
        expect(stored.length).toBe(1)
        expect(readFileSync(path, 'utf8')).not.toContain('Bay Harbor')
        expect(result.report).toContain('weather:timeout')
        expect(result.report).toContain('winner: retry-after-tool-stall')
    })

    it('writes no lesson when no candidate clearly wins', async () => {
        const flat: Llm = async () => ({ reply: 'Here is a plain answer.', toolCalls: 0, iterations: 1 })
        const result = await replayLoop(CAPTURE, {
            chat: flat as never,
            propose: async () => [
                { id: 'noop', overlay: 'Answer plainly.', rationale: 'Plain answers.', voice: false },
            ],
        })
        expect(result.winner).toBeNull()
        expect(result.lesson).toBeNull()
        expect(result.report).toContain('winner: none')
    })
})
