/**
 * Reconstruct a replayable turn from what production already logs.
 * dinghy_run_stages carries metadata only (no content); spectrum_messages
 * carries the conversation. Joined offline, they reproduce the exact input
 * the failed turn ran on - no production schema change needed.
 */

import { windowHistory, WINDOW_MESSAGES, WINDOW_CHARS } from '@/lib/spectrum/history-window'
import type { Message } from '@/lib/spectrum/dinghy'
import type { TurnCapture } from './types'

export interface RunStageRow {
    run_id: string
    chat_guid: string
    message_id: string | null
    stage: string
    detail: string | null
    created_at: string
}

export interface MessageRow {
    role: 'user' | 'assistant'
    content: string
    created_at: string
}

export interface FailureSignature {
    stage: string
    detail: string | null
    at: string
}

/** The failure signature of a run: the 'failed' row when present, else the last stage the run reached. */
export function selectFailure(rows: RunStageRow[]): FailureSignature {
    if (rows.length === 0) throw new Error('no run-stage rows for this run_id')
    const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))
    const pick = sorted.find((r) => r.stage === 'failed') ?? sorted[sorted.length - 1]!
    return { stage: pick.stage, detail: pick.detail, at: pick.created_at }
}

/**
 * Build the capture: history is every message up to and including the failed
 * turn, trimmed by the same window the live path uses. The last message must
 * be the user's ask - a captured turn whose tail is an assistant reply was
 * cut at the wrong place and is refused.
 */
export function buildCapture(
    run: { runId: string; chatGuid: string },
    failure: FailureSignature,
    messages: MessageRow[]
): TurnCapture {
    const prior = messages.filter((m) => m.created_at <= failure.at)
    if (prior.length === 0) throw new Error('no messages at or before the failed turn')
    const history: Message[] = prior.map((m) => ({ role: m.role, content: m.content }))
    if (history[history.length - 1]!.role !== 'user') {
        throw new Error('capture ends on an assistant message; cannot identify the ask to replay')
    }
    return {
        runId: run.runId,
        chatGuid: run.chatGuid,
        capturedAt: failure.at,
        failure: { stage: failure.stage, detail: failure.detail },
        history: windowHistory(history, WINDOW_MESSAGES, WINDOW_CHARS),
    }
}

type FetchImpl = (url: string, init: Record<string, unknown>) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

/**
 * Pull one run from Supabase (PostgREST, service key from the environment -
 * offline operator use only) and build its capture. `fetchImpl` is injected
 * so tests never touch the network.
 */
export async function fetchRunCapture(
    opts: { supabaseUrl: string; serviceKey: string; runId: string; fetchImpl?: FetchImpl }
): Promise<TurnCapture> {
    const f: FetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchImpl)
    const headers = { apikey: opts.serviceKey, Authorization: `Bearer ${opts.serviceKey}` }
    const base = opts.supabaseUrl.replace(/\/$/, '')

    const stageRes = await f(`${base}/rest/v1/dinghy_run_stages?run_id=eq.${encodeURIComponent(opts.runId)}&order=created_at`, { headers })
    if (!stageRes.ok) throw new Error(`run stages read failed: ${stageRes.status}`)
    const stageRows = (await stageRes.json()) as RunStageRow[]
    const failure = selectFailure(stageRows)
    const chatGuid = stageRows[0]!.chat_guid

    const msgRes = await f(
        `${base}/rest/v1/spectrum_messages?chat_guid=eq.${encodeURIComponent(chatGuid)}&created_at=lte.${encodeURIComponent(failure.at)}&order=created_at.desc&limit=${WINDOW_MESSAGES + 2}`,
        { headers }
    )
    if (!msgRes.ok) throw new Error(`messages read failed: ${msgRes.status}`)
    const msgRows = ((await msgRes.json()) as MessageRow[]).reverse()
    return buildCapture({ runId: opts.runId, chatGuid }, failure, msgRows)
}
