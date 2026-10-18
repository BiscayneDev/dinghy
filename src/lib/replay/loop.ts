/**
 * The loop itself: propose candidate harness edits, probe each by replaying
 * the same logged turn, compose the contrast into a lesson. One clear winner
 * writes one lesson; ties write nothing. Everything lands as needs_review -
 * shipping any winning edit is a separate, human, reviewed step.
 */

import type { Candidate, Lesson, ReplayOutcome, TurnCapture, Verdict } from './types'
import { replayTurn, type ReplayDeps } from './runner'
import { judgeContrast, type JudgeFn } from './judge'
import { makeLesson } from './lessons'

/** Injected proposer: given the failed turn and prior accepted lessons, suggest 1-3 candidate edits. */
export type ProposeFn = (input: {
    ask: string
    failureStage: string
    failureDetail: string | null
    baselineReply: string
    acceptedLessons: string[]
}) => Promise<Candidate[]>

export interface LoopResult {
    capture: TurnCapture
    baseline: ReplayOutcome
    candidates: { candidate: Candidate; outcome: ReplayOutcome; verdict: Verdict }[]
    winner: { candidate: Candidate; outcome: ReplayOutcome; verdict: Verdict } | null
    lesson: Lesson | null
    report: string
}

export async function replayLoop(
    capture: TurnCapture,
    deps: ReplayDeps & { propose: ProposeFn; judge?: JudgeFn; acceptedLessons?: string[] }
): Promise<LoopResult> {
    const ask = String(capture.history[capture.history.length - 1]!.content ?? '')
    const baseline = await replayTurn(capture, { ...deps, overlay: null, label: 'baseline' })
    const proposals = (await deps.propose({
        ask,
        failureStage: capture.failure.stage,
        failureDetail: capture.failure.detail,
        baselineReply: baseline.reply,
        acceptedLessons: deps.acceptedLessons ?? [],
    })).slice(0, 3)

    const tried: LoopResult['candidates'] = []
    for (const candidate of proposals) {
        const outcome = await replayTurn(capture, { ...deps, overlay: candidate.overlay, label: candidate.id })
        const verdict = await judgeContrast({
            ask,
            failureStage: capture.failure.stage,
            failureDetail: capture.failure.detail,
            baselineReply: baseline.reply,
            candidateReply: outcome.reply,
            candidateOverlay: candidate.overlay,
        }, deps.judge)
        tried.push({ candidate, outcome, verdict })
    }

    const wins = tried.filter((t) => t.verdict.winner === 'candidate')
    const winner = wins.length === 1 ? wins[0]! : null
    const lesson = winner
        ? makeLesson(
              {
                  failureStage: capture.failure.stage,
                  failureDetail: capture.failure.detail,
                  lesson: winner.candidate.rationale,
                  overlay: winner.candidate.overlay,
                  evidence: { runId: capture.runId, contrast: winner.verdict.reason },
                  voice: winner.candidate.voice,
              },
              ask
          )
        : null

    return { capture, baseline, candidates: tried, winner, lesson, report: renderReport(capture, baseline, tried, winner, lesson) }
}

function renderReport(
    capture: TurnCapture,
    baseline: ReplayOutcome,
    tried: LoopResult['candidates'],
    winner: LoopResult['winner'],
    lesson: Lesson | null
): string {
    const lines: string[] = [
        `# Replay report - run ${capture.runId}`,
        '',
        `captured: ${capture.capturedAt}`,
        `failure: ${capture.failure.stage}${capture.failure.detail ? ` (${capture.failure.detail})` : ''}`,
        '',
        `## baseline`,
        baseline.reply || '(empty reply)',
        '',
    ]
    for (const t of tried) {
        lines.push(`## candidate ${t.candidate.id}${t.candidate.voice ? ' [voice - review gate]' : ''}`)
        lines.push(`overlay: ${t.candidate.overlay}`)
        lines.push(`verdict: ${t.verdict.winner} - ${t.verdict.reason}`)
        lines.push(t.outcome.reply || '(empty reply)')
        lines.push('')
    }
    lines.push(winner ? `winner: ${winner.candidate.id}` : 'winner: none (no single clear improvement; no lesson written)')
    if (lesson) {
        lines.push('', `lesson (needs_review${lesson.voice ? ', voice' : ''}): ${lesson.lesson}`)
    }
    return lines.join('\n')
}
