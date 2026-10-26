import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'
import { redoMode } from '@/lib/spectrum/redo-jobs'
import { intakeRedo } from '@/lib/spectrum/redo-intake'
import { realIntakeDeps } from '@/lib/spectrum/redo-intake-runtime'
import { runOneRedoJob } from '@/lib/spectrum/redo-worker-runtime'
import { enqueueOutbox } from '@/lib/spectrum/outbox'
import { decideTurnDeliverable } from '@/lib/spectrum/deliverable-turn'
import { deliveredFileContext, deliveredFileUrls } from '@/lib/files/deliverable-intent'
import { fileUrlOf } from '@/lib/files/origin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300
const headers = { 'Cache-Control': 'private, no-store' }

/**
 * Operator-run proof of ONE stored complaint, with no message authored as the user. It takes no input: the single armed one-shot
 * authorization row (created by an operator after approval) names the stored page and the stored complaint, and everything is checked
 * against that user's own rows. The stored complaint first goes through the SAME recognition a real message gets (decideTurnDeliverable,
 * with the chat history as it stood at that message). Only if that says redo does it reach the same intake and worker. If recognition says
 * ordinary chat or is unsure, that is reported as a failed recognition and nothing is forced. Nothing is written into the user's chat history.
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
    // Recognition: the chat as it stood when the complaint arrived (messages up to and including it), decided by the same logic the webhook handler uses.
    const { data: at } = await db.from('spectrum_messages').select('created_at').eq('id', a.note_id).eq('chat_guid', chat).maybeSingle()
    const { data: hist } = await db.from('spectrum_messages').select('role, content').eq('chat_guid', chat).in('role', ['user', 'assistant']).lte('created_at', (at as { created_at?: string } | null)?.created_at ?? '').order('created_at', { ascending: false }).limit(40)
    const full = ((hist ?? []) as { role: string; content: string }[]).reverse()
    const { data: ident } = await db.from('spectrum_identities').select('handle').eq('chat_guid', chat).eq('user_id', a.user_id).maybeSingle()
    const retire = (state: 'revoked') => db.from('dinghy_redo_authorizations').update({ state }).eq('id', a.id).eq('state', 'armed')
    const afterFile = deliveredFileContext(full)
    if (!afterFile || full.at(-1)?.content !== complaint) { await retire('revoked'); return NextResponse.json({ verdict: 'history_does_not_end_at_complaint_or_has_no_page' }, { status: 409, headers }) }
    if (fileUrlOf(afterFile.line) !== url) { await retire('revoked'); return NextResponse.json({ verdict: 'latest_page_is_not_the_authorized_page' }, { status: 409, headers }) }
    const deliverable = await decideTurnDeliverable({ text: complaint, full, afterFile: true, redoAllowed: true, sender: (ident as { handle?: string } | null)?.handle ?? undefined })
    // The authorization is spent by this model call whatever it says: never a second automatic try.
    if (!deliverable?.redo) { await retire('revoked'); return NextResponse.json({ verdict: 'recognition_failed', recognized: deliverable ? deliverable.kind : null }, { status: 200, headers }) }
    const reply = await intakeRedo(chat, url, complaint, realIntakeDeps(async () => 'new_instruction'), { replied: null, candidates: deliveredFileUrls(full), complaintNoteId: a.note_id })
    await enqueueOutbox(chat, 'reply', reply)
    const ran = await runOneRedoJob()
    return NextResponse.json({ verdict: ran.ran ? 'ran' : 'queued_for_cron_rescue', outcome: ran.outcome ?? null }, { headers })
}
