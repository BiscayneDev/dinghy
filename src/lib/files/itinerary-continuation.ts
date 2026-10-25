import { deliverableCancelled, type DeliverableContract } from './deliverable-contract'

/** Saved in front of the question in chat history only (the user never sees it). It is the durable state that says
 * "the last assistant message asked something that the itinerary work is waiting on", so the next turn continues
 * the same task instead of guessing from the shape of the answer. */
export const CLARIFY_MARK = '[itinerary clarification pending] '

type Line = { role: string; content?: unknown }

/** The original request, when the last assistant message is a pending itinerary question. */
export function pendingItineraryClarification(history: Line[]): { request: string } | null {
    const last = history.at(-1)
    if (!last || last.role !== 'assistant' || typeof last.content !== 'string' || !last.content.startsWith(CLARIFY_MARK)) return null
    for (let i = history.length - 2; i >= 0; i--) {
        const m = history[i]
        if (m.role === 'user' && typeof m.content === 'string' && m.content.trim()) return { request: m.content }
    }
    return null
}

/**
 * The next turn after a pending question. The answer is applied to the original request; the original is never lost.
 * Another explicit deliverable keeps its own contract; a withdrawal stays withdrawn.
 */
export function continueAfterClarification(pending: { request: string } | null, answer: string, own: DeliverableContract | null): DeliverableContract | null {
    if (!pending) return own
    if (deliverableCancelled(answer)) return own
    if (own && own.kind !== 'itinerary') return own
    return { kind: 'itinerary', request: `${pending.request}\n\nTheir answer to your question: ${answer}` }
}
