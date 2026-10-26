import { createHash } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'

/**
 * Artifact -> originating request association on existing durable storage, no schema change.
 * When a deliverable job ships a hosted file, one hidden marker row is saved in the chat history table in the form the history loader already filters out ("[sent file: ...]", see isFileMarker): "[sent file: origin <hash of url> <base64 of the exact request the job ran on>]".
 * A later redo of that file reads the exact request back by url, so it does not guess it from the chat.
 */
const urlHash = (url: string) => createHash('sha1').update(url).digest('hex').slice(0, 16)
export const fileUrlOf = (historyLine: string): string | null => historyLine.match(/https?:\/\/[^\s)]+/)?.[0] ?? null
export const originMarker = (url: string, request: string) => `[sent file: origin ${urlHash(url)} ${Buffer.from(request, 'utf8').toString('base64')}]`

export async function loadFileOrigin(chatGuid: string, url: string): Promise<string | null> {
    try {
        const { data, error } = await createServerClient()
            .from('spectrum_messages')
            .select('content')
            .eq('chat_guid', chatGuid)
            .eq('role', 'assistant')
            .like('content', `[sent file: origin ${urlHash(url)} %`)
            .order('created_at', { ascending: false })
            .limit(1)
        const content = (data as { content?: string }[] | null)?.[0]?.content
        if (error || !content) return null
        const b64 = content.trim().replace(/^\[sent file: origin \S+ /, '').replace(/\]$/, '')
        const text = Buffer.from(b64, 'base64').toString('utf8')
        return text.trim() ? text : null
    } catch {
        return null
    }
}
