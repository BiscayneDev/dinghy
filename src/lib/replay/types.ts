/**
 * Offline replay loop ("propose -> probe -> compose", borrowed from
 * google-research/harness2). Replays one LOGGED Dinghy turn against candidate
 * harness edits, keeps what wins, and records the lesson. Nothing here runs
 * inside a user request: it is driven by scripts/replay-turn.mts, offline,
 * against rows already logged in Supabase (dinghy_run_stages +
 * spectrum_messages). Replaying never touches the database, sandbox, browser
 * or any send path: tools run against the dry-run in-memory world.
 */

import type { Message } from '@/lib/spectrum/dinghy'

/** One logged turn, reconstructed for replay. Content stays on the operator's machine (the .replay dir is gitignored). */
export interface TurnCapture {
    runId: string
    /** Chat identifier as logged; pseudonymous, never a phone number. */
    chatGuid: string
    /** ISO time of the failed turn (from the run-stage rows). */
    capturedAt: string
    /** Why this turn was captured: the stage the run died on (or the last stage seen) and its short detail. */
    failure: { stage: string; detail: string | null }
    /** Windowed history exactly as the model saw it; the last message is the ask being replayed. */
    history: Message[]
}

export interface ReplayOutcome {
    /** 'baseline' for the unmodified harness, otherwise the candidate's id. */
    label: string
    reply: string
    toolCalls: { name: string; input: Record<string, unknown>; status: string }[]
    iterations: number
    /** The harness-edit note this replay ran with (baseline: none). */
    overlay: string | null
}

/** One candidate harness edit to probe. */
export interface Candidate {
    id: string
    /** Steering note injected for this probe only. */
    overlay: string
    rationale: string
    /** True when the edit touches tone/voice: a win still needs Halsey's review before it ships. */
    voice: boolean
}

export interface Verdict {
    winner: 'baseline' | 'candidate' | 'tie'
    reason: string
}

/** An evidence-supported lesson. Written by compose; shipped only after review (status stays needs_review). */
export interface Lesson {
    id: string
    createdAt: string
    failureStage: string
    failureDetail: string | null
    /** Generalized rule, in plain words. Must never quote the user's message. */
    lesson: string
    /** The winning steering note - the raw material for a future reviewed prompt patch. */
    overlay: string
    evidence: { runId: string; contrast: string }
    voice: boolean
    status: 'needs_review' | 'accepted'
}
