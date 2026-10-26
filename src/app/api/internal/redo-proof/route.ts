import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'
import { redoMode } from '@/lib/spectrum/redo-jobs'
import { intakeRedo } from '@/lib/spectrum/redo-intake'
import { realIntakeDeps } from '@/lib/spectrum/redo-intake-runtime'
import { runOneRedoJob } from '@/lib/spectrum/redo-worker-runtime'
import { enqueueOutbox } from '@/lib/spectrum/outbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300
const headers = { 'Cache-Control': 'private, no-store' }

/**
 * Operator-run proof of ONE stored complaint, with no message authored as the user. It takes no input: the single armed one-shot
 * authorization row (created by an operator after approval) names the stored page and the stored complaint, and everything is checked
 * against that user's own rows. It feeds the same intake and worker a real complaint uses, and writes nothing into the user's chat history.
 * Auth is the existing scheduler secret. Inactive unless DINGHY_REDO_JOBS=proof and DINGHY_REDO_PROOF_CHAT is set.
 */
export async function POST(req: Request): Promise<Response> {
    const given = Buffer.from(req.headers.get('authorization') ?? ''), want = Buffer.from(`Bearer ${process.env.CRON_SECRET ?? ''}`)
    if (!process.env.CRON_SECRET || given.length !== want.length || !timingSafeEqual(given, want)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
    const chat = process.env.DINGHY_REDO_PROOF_CHAT
    if (redoMode() !== 'proof' || !chat) return NextResponse.json({ verdict: 'inactive' }, { status: 409, headers })
    const db = createServerClient()
    const { data: auth } = await db.from('dinghy_redo_authorizations').select('id, user_id, file_id, note_id').eq('chat_guid', chat).eq('state', 'armed').not('file_id', 'is', null).not('note_id', 'is', null).limit(1)
    const a = (auth as { id: string; user_id: string; file_id: string; note_id: string }[] | null)?.[0]
    if (!a) return NextResponse.json({ verdict: 'no_armed_authorization' }, { status: 409, headers })
    const { data: file } = await db.from('dinghy_files').select('url').eq('id', a.file_id).eq('user_id', a.user_id).or(`chat_guid.eq.${chat.replace(/[,()]/g, '')},chat_guid.is.null`).is('deleted_at', null).is('revoked_at', null).maybeSingle()
    const { data: note } = await db.from('spectrum_messages').select('content').eq('id', a.note_id).eq('chat_guid', chat).eq('role', 'user').maybeSingle()
    const url = (file as { url?: string } | null)?.url, complaint = (note as { content?: string } | null)?.content
    if (!url || !complaint) return NextResponse.json({ verdict: 'stored_references_not_found' }, { status: 409, headers })
    const reply = await intakeRedo(chat, url, complaint, realIntakeDeps(async () => 'new_instruction'), { replied: url, candidates: [], complaintNoteId: a.note_id })
    await enqueueOutbox(chat, 'reply', reply)
    const ran = await runOneRedoJob()
    return NextResponse.json({ verdict: ran.ran ? 'ran' : 'queued_for_cron_rescue', outcome: ran.outcome ?? null }, { headers })
}
