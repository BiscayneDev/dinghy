import { createServerClient } from '@/lib/supabase/server'

/**
 * The request a hosted file was made from, stored on that file's own dinghy_files row (migration 077):
 * not in chat history, so it never reaches the model, the memory summarizer or the chat export, and it
 * is erased and retained with the file. Google-derived requests are flagged so retention nulls them.
 * Best-effort: a failed save only means a later correction cannot be bound, and it says so.
 */
export async function saveFileOrigin(opts: { userId: string; chatGuid: string; url: string; request: string; googleDerived: boolean; kind?: string | null; messageId?: string | null; runId?: string | null; lineageId?: string | null }): Promise<boolean> {
    if (!opts.request.trim() || opts.request.length > 12_000) return false
    const { data, error } = await createServerClient().from('dinghy_files')
        .update({
            origin_request: opts.request, origin_google_derived: opts.googleDerived,
            ...(opts.kind ? { origin_kind: opts.kind } : {}), ...(opts.messageId ? { origin_message_id: opts.messageId } : {}), ...(opts.runId ? { origin_run_id: opts.runId } : {}), ...(opts.lineageId ? { lineage_id: opts.lineageId } : {}),
        })
        .eq('user_id', opts.userId).eq('chat_guid', opts.chatGuid).eq('url', opts.url).is('origin_request', null)
        .select('id')
    return !error && (data?.length ?? 0) > 0
}

export const fileUrlOf = (historyLine: string): string | null => historyLine.match(/https?:\/\/[^\s)]+/)?.[0] ?? null
