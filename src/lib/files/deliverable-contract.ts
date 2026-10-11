import { mapArtifactTurn, mapPageError } from './map-artifact'
import { weeklyListRequest, weeklyPageError } from './weekly-standard'
type Line = { role: string; content: string }
export type DeliverableKind = 'map' | 'comparison' | 'list' | 'itinerary' | 'note'
export type DeliverableContract = { kind: DeliverableKind; request: string }
export type DeliverableState = 'completed' | 'unfulfilled'
const artifact = /\b(?:make|create|build|prepare|write|put together|send|give|show)\b/i
function classify(request: string): DeliverableContract | null {
    let kind: DeliverableKind | null = null
    if (/\b(?:itinerary|day.by.day plan)\b/i.test(request) && /\b(?:make|create|build|prepare|write|plan|put together|send|give|show)\b/i.test(request)) kind = 'itinerary'
    else if (/\bcompare\b/i.test(request) || (artifact.test(request) && /\b(?:comparison|versus|vs\.?)\b/i.test(request))) kind = 'comparison'
    else if ((artifact.test(request) && /\b(?:list|checklist)\b/i.test(request)) || /\b(?:top|best|popular|trending)\s+\d+\b/i.test(request) || weeklyListRequest(request)) kind = 'list'
    else if (artifact.test(request) && /\b(?:note|notes|document|page|file|pdf)\b/i.test(request)) kind = 'note'
    return kind ? { kind, request } : null
}
/** Original user asks select work. Assistant prose never selects a contract.
 * Retry referents stop at the immediately previous user ask. */
export function selectDeliverable(history: Line[]): DeliverableContract | null {
    const users = history.filter(m => m.role === 'user').slice(-2)
    const current = users.at(-1)?.content ?? ''
    if (/\b(?:don't|do not|no need to)\s+(?:make|create|send)|\b(?:just|only)\s+(?:answer|text)|\b(?:cancel|never mind)\b/i.test(current)) return null
    if (mapArtifactTurn(history)) return { kind: 'map', request: current }
    const own = classify(current)
    if (own) return own
    return /\b(?:make|create|send|do|try)\b[^.!?\n]{0,50}\b(?:one|it|again)\b/i.test(current) ? classify(users.at(-2)?.content ?? '') : null
}
export function contractNote(c: DeliverableContract): string {
    const shape = {
        map: 'A source-linked locator, not a generic list; follow the map evidence and uncertainty rules.',
        comparison: 'At least two named options in a markdown table or :::options block, with the differences and catches visible.',
        list: 'A real numbered/bulleted list, checklist or structured option/media rows, not a prose announcement.',
        itinerary: 'A day/stop sequence with headings or :::route rows, not a generic travel essay. Unknown dates and times stay unknown.',
        note: 'The requested note/document body, not an announcement that a file exists.',
    }[c.kind]
    return `Deliverable contract: ${c.kind}. ${shape} Use create_file with the full body. A chat answer alone does not complete this requested deliverable. Existing confirmations and privacy rules still apply. Ask only for information that actually blocks the requested work. Never claim completion before the file tool succeeds.`
}
function blockRows(body: string, kinds: string): number {
    const block = body.match(new RegExp(`(?:^|\\n)\\s*:::(?:${kinds})\\s*\\n([\\s\\S]*?)\\n\\s*:::`, 'i'))?.[1] ?? ''
    return block.split('\n').filter(line => line.split('|').filter(cell => cell.trim()).length >= 2).length
}
function listRows(body: string): boolean {
    return /(?:^|\n)\s*(?:[-*] |\d+[.)] )\S/.test(body)
}
export function deliverablePageError(c: DeliverableContract | null, input: unknown, urls: string[]): string | null {
    if (!c) return null
    const i = input as { body?: unknown; title?: unknown }
    const body = typeof i?.body === 'string' ? i.body.trim() : ''
    if (!body || /^(?:here you go\.?|done\.?|i (?:made|created) (?:the|a) (?:file|page|document)\.?)$/i.test(body)) return 'The requested deliverable needs its actual body, not a completion announcement.'
    if (c.kind === 'map') {
        const evidenceError = mapPageError(input, urls)
        if (evidenceError) return evidenceError
        // Structure only, not verification of names or factual accuracy.
        const locatorBody = body.replace(/:::sources\s*\n[\s\S]*?\n\s*:::/gi, '')
        if (!listRows(locatorBody) && !blockRows(locatorBody, 'places|options') && !/\|[^|\n]+\|[^|\n]+\|/.test(locatorBody)) return 'Map contract: include named venue/location rows in a list, table or :::places/:::options block. Sources and disclaimers alone are not a locator. Keep unsupported positions unknown.'
        return null
    }
    if (c.kind === 'comparison') {
        const optionRows = blockRows(body, 'options')
        const tableRows = body.split('\n').filter(l => /^\s*\|/.test(l) && !/^\s*\|[\s:|-]+\|\s*$/.test(l)).length - 1
        if (Math.max(optionRows, tableRows) < 2) return 'Comparison contract: supply at least two named options in a markdown table or :::options block. Show differences and catches; never invent missing values.'
    }
    if (c.kind === 'list' && !listRows(body) && !blockRows(body, 'media|options|places|briefing')) return 'List contract: supply actual list/checklist items or structured rows, not a generic paragraph.'
    if (c.kind === 'itinerary' && !blockRows(body, 'route') && !/(?:^|\n)\s*#{2,3}\s+(?:day\s+\d|mon|tue|wed|thu|fri|sat|sun|\d{4}-\d{2}-\d{2}|stop\s+\d)/i.test(body)) return 'Itinerary contract: organize by day or numbered stop headings, or use :::route legs. Unknown timings stay unknown.'
    return weeklyPageError(input, c.request, urls)
}
/** Successful tool settlement, not an attempt or model-written assertion. */
export function deliverableOutcome(c: DeliverableContract | null, completed: boolean) {
    return c ? { kind: c.kind, state: (completed ? 'completed' : 'unfulfilled') as DeliverableState } : undefined
}
export function truthfulDeliverableReply(reply: string, c: DeliverableContract | null, completed: boolean): string {
    if (!c || completed) return reply
    const clean = reply.replace(/\[\s*(?:sent )?file:[^\]]*\]/gi, '').trim()
    if (/\b(?:I(?:'ve| have)?|we(?:'ve| have)?)\s+(?:compiled|created|made|prepared|updated|put together)\b[\s\S]*\b(?:document|file|page|pdf|map)\b/i.test(clean) || !clean || clean === '(no response)') return `The ${c.kind === 'map' ? 'locator' : c.kind} wasn't completed. There is no new file to send.`
    return `${clean}\n\nThe ${c.kind === 'map' ? 'locator' : c.kind} wasn't completed; no new file was created.`
}
