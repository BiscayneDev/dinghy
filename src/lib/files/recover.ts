import { createServerClient } from '@/lib/supabase/server'
import { sendLink, type LinkSender } from '@/lib/spectrum/links'

export function wantsPageResend(text: string, lastAssistant = ''): boolean {
    if (/^\s*\?+\s*$/.test(text)) return /\[file:|here\.now|here you go/i.test(lastAssistant)
    return /\b(?:resend|send(?: me)? (?:the|that|my)|where(?:'s| is)|did(?:n['’]?t| not) (?:send|receive|get)|don['’]?t see|missing)\b[^.!?\n]{0,70}\b(?:page|file|document|pdf|link)\b/i.test(text)
}

export interface RecoverableFile { title: string; url: string; expires_at: string }
/** New records are chat-bound. Legacy records must also match this chat's exact history URL. */
export async function latestChatFile(userId: string, chatGuid: string, history: string[], now = Date.now()): Promise<RecoverableFile | null> {
    const { data, error } = await createServerClient().from('dinghy_files')
        .select('title,url,expires_at,chat_guid').eq('user_id', userId)
        .or(`chat_guid.eq.${chatGuid.replace(/[,()]/g, '')},chat_guid.is.null`).is('deleted_at', null).is('revoked_at', null).order('created_at', { ascending: false }).limit(30)
    if (error) throw new Error('file lookup failed')
    const historyUrls = new Set(history.flatMap((s) => s.match(/https:\/\/[a-z0-9-]+\.here\.now\//gi) ?? []))
    return (data ?? []).find((f) => f.url && /^https:\/\/[a-z0-9-]+\.here\.now\/$/.test(f.url)
        && Number.isFinite(Date.parse(f.expires_at ?? '')) && Date.parse(f.expires_at!) > now
        && (f.chat_guid === chatGuid || (f.chat_guid === null && historyUrls.has(f.url)))) ?? null
}

export async function verifiedPage(file: RecoverableFile): Promise<boolean> {
    const res = await fetch(file.url, { redirect: 'error', signal: AbortSignal.timeout(8000) })
    if (!res.ok || !res.headers.get('content-type')?.includes('text/html')) return false
    const html = await res.text()
    const escaped = file.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    return html.includes(`<title>${escaped} · Dinghy</title>`)
}

/** Relay acceptance is not a read receipt. The URL is durable even if both sends fail. */
export async function deliverHostedLink(space: LinkSender, chatGuid: string, url: string): Promise<boolean> {
    return sendLink(space, chatGuid, 'reply', url)
}
