/**
 * Contrastive judging, harness2-style: no ground-truth answer exists for a
 * chat turn, so a candidate wins by being visibly better than the baseline
 * on the SAME replayed ask. Cheap deterministic rules run first; only an
 * inconclusive pair goes to the model judge (injected, routed through
 * Shipyard in live runs). Any doubt is a tie: no lesson without a clear win.
 */

import type { ReplayOutcome, Verdict } from './types'

/** Lines that read as the turn having failed the user. Kept narrow on purpose: these are admissions, not style. */
export const FAILURE_MARKERS = [
    /\bi (couldn'?t|can'?t|wasn'?t able to|am unable to)\b/i,
    /\bfailed to\b/i,
    /\bsomething went wrong\b/i,
    /\btry again (later|in a (moment|bit))\b/i,
    /\bhaving (trouble|issues) (with|getting)\b/i,
    /\btechnical difficulties\b/i,
]

export function hasFailureMarkers(reply: string): string[] {
    return FAILURE_MARKERS.filter((re) => re.test(reply)).map((re) => re.source)
}

/** Deterministic contrast. Returns null when rules can't call it and the model judge must decide. */
export function ruleVerdict(baseline: ReplayOutcome, candidate: ReplayOutcome): Verdict | null {
    const baseFail = hasFailureMarkers(baseline.reply)
    const candFail = hasFailureMarkers(candidate.reply)
    if (baseFail.length > 0 && candFail.length === 0) {
        return { winner: 'candidate', reason: `baseline admitted failure (${baseFail.join(', ')}); candidate answered without one` }
    }
    if (candFail.length > 0 && baseFail.length === 0) {
        return { winner: 'baseline', reason: `candidate introduced a failure admission (${candFail.join(', ')})` }
    }
    if (baseline.reply.trim().length === 0 && candidate.reply.trim().length > 0) {
        return { winner: 'candidate', reason: 'baseline replied empty; candidate produced a reply' }
    }
    if (candidate.reply.trim().length === 0 && baseline.reply.trim().length > 0) {
        return { winner: 'baseline', reason: 'candidate replied empty' }
    }
    return null
}

export interface JudgeInput {
    ask: string
    failureStage: string
    failureDetail: string | null
    baselineReply: string
    candidateReply: string
    candidateOverlay: string
}

/** Injected model judge: returns raw text expected to be JSON {winner, reason}. */
export type JudgeFn = (input: JudgeInput) => Promise<string>

export function parseJudgeVerdict(raw: string): Verdict {
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return { winner: 'tie', reason: 'judge returned no verdict object; treating as tie' }
    try {
        const parsed = JSON.parse(match[0]) as { winner?: string; reason?: string }
        if (parsed.winner === 'baseline' || parsed.winner === 'candidate' || parsed.winner === 'tie') {
            return { winner: parsed.winner, reason: String(parsed.reason ?? '').slice(0, 300) || 'no reason given' }
        }
        return { winner: 'tie', reason: `judge returned unknown winner "${String(parsed.winner)}"; treating as tie` }
    } catch {
        return { winner: 'tie', reason: 'judge verdict was not parseable; treating as tie' }
    }
}

export async function judgeContrast(input: JudgeInput, judgeFn?: JudgeFn): Promise<Verdict> {
    const ruled = ruleVerdict(
        { label: 'baseline', reply: input.baselineReply, toolCalls: [], iterations: 0, overlay: null },
        { label: 'candidate', reply: input.candidateReply, toolCalls: [], iterations: 0, overlay: input.candidateOverlay }
    )
    if (ruled) return ruled
    if (!judgeFn) return { winner: 'tie', reason: 'no deterministic call and no judge supplied; treating as tie' }
    return parseJudgeVerdict(await judgeFn(input))
}
