import { selectDeliverable, type DeliverableContract } from '@/lib/files/deliverable-contract'
import { decideFollowUpDeliverable, deliverableIntentEnabled, selectDeliverableModelOwned } from '@/lib/files/deliverable-intent'
import { GATEWAY_URL, SHIPYARD_API_KEY } from './config'

type Line = { role: string; content: string }
const ctx = (full: Line[], n: number) => JSON.stringify(full.slice(-n).map((m) => ({ role: m.role, content: m.content }))).slice(0, 10000)

/**
 * The one place a turn's deliverable (including "redo the page I just got") is decided. The webhook handler and the operator proof route both
 * call it, so a proof exercises the same recognition a real complaint gets. A redo is only returned when redo jobs are allowed here.
 */
export async function decideTurnDeliverable(o: { text: string; full: Line[]; afterFile: boolean; redoAllowed: boolean; sender?: string }): Promise<(DeliverableContract & { redo?: true }) | null> {
    if (deliverableIntentEnabled(o.sender)) {
        // Flag on: the model already judges every turn; after a delivered file the same call also offers "redo" (no extra call).
        return selectDeliverableModelOwned({ gatewayUrl: GATEWAY_URL, apiKey: SHIPYARD_API_KEY, request: o.text, context: o.afterFile ? ctx(o.full, 8) : ctx(o.full, 4), signal: AbortSignal.timeout(8000), legacy: () => selectDeliverable(o.full as never), afterFile: o.afterFile && o.redoAllowed })
    }
    const kw = selectDeliverable(o.full as never) as (DeliverableContract & { redo?: true }) | null
    // Flag off: when a delivered file is in recent history and the keyword matcher saw nothing, one bounded model call decides whether this is a redo request. Only a redo acts.
    if (!kw && o.afterFile && o.redoAllowed) return decideFollowUpDeliverable({ gatewayUrl: GATEWAY_URL, apiKey: SHIPYARD_API_KEY, request: o.text, context: ctx(o.full, 8), signal: AbortSignal.timeout(8000) })
    return kw
}
