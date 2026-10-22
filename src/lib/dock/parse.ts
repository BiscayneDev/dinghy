/**
 * Message parsing for the Dock connector. Pure functions, no I/O.
 *
 *   pair <CODE>          link this chat to a Dock workspace (one-time code from Dock settings)
 *   unlink dock          remove the link from this chat
 *   yes / no / approve / reject (optionally followed by an approval label)
 *   @<chief name> ...    route the rest of the message to Dock as a run request
 */

export type PairCommand = { kind: 'pair'; code: string } | { kind: 'unlink' }

const PAIR_RE = /^pair\s+([A-Za-z0-9][A-Za-z0-9-]{5,15})$/i

export function parsePairCommand(text: string): PairCommand | null {
    const t = text.trim().replace(/[.!]+$/, '')
    const m = PAIR_RE.exec(t)
    if (m) return { kind: 'pair', code: m[1].toUpperCase() }
    if (/^unlink\s+dock$/i.test(t)) return { kind: 'unlink' }
    return null
}

export type ReplyIntent = { decision: 'approve' | 'reject'; label: string | null }

const APPROVE_WORDS = ['approve', 'yes', 'y', 'ok', 'okay', 'send it']
const REJECT_WORDS = ['reject', 'no', 'n', 'cancel', 'stop', 'deny']

/** Parses a bare yes/no reply. Returns null for anything else (the message is not a Dock reply). */
export function parseReply(text: string): ReplyIntent | null {
    const t = text.trim().toLowerCase().replace(/[.!?]+$/, '').replace(/\s+/g, ' ')
    if (!t) return null
    const words = [...APPROVE_WORDS, ...REJECT_WORDS].sort((a, b) => b.length - a.length)
    for (const w of words) {
        if (t === w) return { decision: APPROVE_WORDS.includes(w) ? 'approve' : 'reject', label: null }
        if (t.startsWith(w + ' ')) {
            const label = t.slice(w.length + 1).trim()
            if (!label) return null
            return { decision: APPROVE_WORDS.includes(w) ? 'approve' : 'reject', label }
        }
    }
    return null
}

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Finds `@<name>` (case-insensitive, whole word) in the message. Returns the message with the mention
 * removed, or null when the name is not the user's chief. Unknown names return null, so the message
 * takes today's Dinghy path.
 */
export function matchChiefMention(text: string, chiefName: string): { body: string } | null {
    const name = chiefName.trim()
    if (!name) return null
    const re = new RegExp(`(^|[^\\w@])@${escapeRe(name)}(?![\\w-])`, 'i')
    if (!re.test(text)) return null
    const body = text
        .replace(new RegExp(`(^|[^\\w@])@${escapeRe(name)}(?![\\w-])`, 'ig'), '$1')
        .replace(/\s+([,.!?;:])/g, '$1')
        .replace(/\s+/g, ' ')
        .trim()
    return { body }
}
