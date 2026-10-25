import type { DeliverableContract } from './deliverable-contract'

/** Saved in front of the question in chat history only (the user never sees it, and sent text never carries it). It is the
 * durable state that says "the last assistant message asked something the itinerary work is waiting on". It only counts on an
 * assistant row, so nothing a user types can create it, and any copy a model puts in its own reply is stripped before sending. */
export const CLARIFY_MARK = '[itinerary clarification pending] '
/** A pending question is only resumed while it is fresh. After this the next message is just a new message. */
export const CLARIFY_TTL_MS = 3 * 60 * 60 * 1000

type Line = { role: string; content?: unknown; at?: string }

export const stripClarifyMark = (text: string): string => text.split(CLARIFY_MARK).join('')

export interface PendingClarification { request: string; question: string }

/** The original request and question, when the last assistant message is a fresh pending itinerary question. */
export function pendingItineraryClarification(history: Line[], now: number = Date.now()): PendingClarification | null {
    const last = history.at(-1)
    if (!last || last.role !== 'assistant' || typeof last.content !== 'string' || !last.content.startsWith(CLARIFY_MARK)) return null
    const at = last.at ? Date.parse(last.at) : NaN
    if (!Number.isFinite(at) || now - at > CLARIFY_TTL_MS || at - now > 60_000) return null
    for (let i = history.length - 2; i >= 0; i--) {
        const m = history[i]
        if (m.role === 'user' && typeof m.content === 'string' && m.content.trim()) return { request: m.content, question: last.content.slice(CLARIFY_MARK.length) }
    }
    return null
}

export type ReplyVerdict = 'answer' | 'new_topic' | 'cancel'

/** One bounded model judgment: is the new message the answer to the question, a new topic, or a withdrawal? Throws when unavailable or uncertain. */
export async function decideClarificationReply(opts: { gatewayUrl: string; apiKey: string; pending: PendingClarification; reply: string; signal?: AbortSignal; fetch?: typeof fetch }): Promise<ReplyVerdict> {
    const res = await (opts.fetch ?? fetch)(`${opts.gatewayUrl}/v1/decisions`, {
        method: 'POST', signal: opts.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({
            state: { original_request: opts.pending.request.slice(0, 4000), question_asked: opts.pending.question.slice(0, 600), latest_user_message: opts.reply.slice(0, 2000) },
            questions: { reply: { type: 'choice', instructions: 'The assistant asked the user the question above before it could work on the original request. Decide what the latest user message is.', criteria: { answer: 'It answers the question (fully or partly) so the original request can go ahead.', new_topic: 'It is about something else, or asks for something different.', cancel: 'It withdraws the original request or says not to do it.' } } },
        }),
    })
    if (!res.ok) throw new Error('reply decision unavailable')
    const r = (await res.json()) as { provider?: string; model?: string; answers?: { reply?: { type?: string; choice?: string; confidence?: number; probabilities?: Record<string, number> } } }
    const a = r?.answers?.reply
    if (/stub/i.test(r?.provider ?? '') || /stub/i.test(r?.model ?? '') || a?.type !== 'choice' || !Number.isFinite(a.confidence) || a.confidence! < 0.6 || !a.choice || !a.probabilities || !Number.isFinite(a.probabilities[a.choice]) || a.probabilities[a.choice] < 0.6) throw new Error('reply decision unavailable or uncertain')
    if (a.choice === 'answer' || a.choice === 'new_topic' || a.choice === 'cancel') return a.choice
    throw new Error('unknown reply decision')
}

/** The contract for the turn after a pending question, from the model's verdict. Without a pending question or a verdict, nothing changes. */
export function continueAfterClarification(pending: PendingClarification | null, verdict: ReplyVerdict | null, answer: string, own: DeliverableContract | null): DeliverableContract | null {
    if (!pending || !verdict) return own
    if (verdict === 'cancel') return null
    if (verdict === 'new_topic') return own
    return { kind: 'itinerary', request: `${pending.request}\n\nTheir answer to your question: ${answer}` }
}
