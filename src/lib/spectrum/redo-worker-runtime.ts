import { createServerClient } from '@/lib/supabase/server'
import { advanceRedoJob, claimRedoJob, closeRedoJob, failRedoJob, notifyRedoOutcome, TERMINAL_TEXT, unreportedTerminalJobs, type ClaimedJob } from './redo-jobs'
import { executeRedoJob, RedoCancelled, type WorkerDeps, type WorkerFile, type WorkerOutcome } from './redo-worker'
import type { DeliverableKind } from '@/lib/files/deliverable-contract'
import { EMPTY_MEMORY, loadMemoryContext, renderMemoryBlock } from './memory'
import { RedoCancelled as DinghyRedoCancelled, chatWithTools, productFactsFor } from './dinghy'
import { capabilitiesFor, loadImessageToolContext, toolsFor } from './imessage-tools'
import { fileToolsFor } from '@/lib/files/tool'
import { saveFileOrigin } from '@/lib/files/origin'
import { revokeSite } from '@/lib/files/share'
import { briefableUserId } from './briefing'
import { getBetaRole } from './beta-gate'
import { routingFor } from './routing'
import { GATEWAY_URL, SHIPYARD_API_KEY, SHIPYARD_MODEL } from './config'
import { recordUsage, type GatewayUsage } from './metering'
import { loadFacts } from '@/spectrum/store'
import { getSpectrumApp, getImessage } from './app'
import { demoSpace, isDemoGuid } from './demo-chat'
import { sendFile, type InboundSpace } from './handler'

const BUDGET_MS = 240_000
/** The webhook function lives 300s from its start. A kick only runs a job when a full build still fits, otherwise the cron rescue takes it. */
const HOST_WINDOW_MS = 285_000
const MIN_KICK_BUDGET_MS = 150_000

/** Claims and runs at most one job. Unknown external outcomes are never retried here; the database blocks or fails them by phase. */
export async function runOneRedoJob(budgetMs = BUDGET_MS): Promise<{ ran: boolean; outcome?: WorkerOutcome }> {
    // Claiming also moves crashed jobs to blocked/failed in the database, so report after it: one deduped status per terminal job.
    const job = await claimRedoJob()
    for (const j of await unreportedTerminalJobs()) await notifyRedoOutcome(j.id, TERMINAL_TEXT[j.failure ?? ''] ?? 'I could not finish the redo of that page. Nothing new was sent.')
    if (!job) return { ran: false }
    return { ran: true, outcome: await executeRedoJob(job, realDeps(job, budgetMs)) }
}

/** Immediate start from the webhook tail. Claims through the same lease as the cron route, so the two can never run one job twice. */
export async function kickRedoJobs(handlerStartedAt: number): Promise<{ kicked: boolean; reason?: string }> {
    const remaining = HOST_WINDOW_MS - (Date.now() - handlerStartedAt)
    if (remaining < MIN_KICK_BUDGET_MS + 30_000) return { kicked: false, reason: 'not_enough_time_left_cron_will_run_it' }
    await runOneRedoJob(Math.min(BUDGET_MS, remaining - 30_000))
    return { kicked: true }
}

function realDeps(job: ClaimedJob, budgetMs: number): WorkerDeps {
    const db = createServerClient()
    let madeFull: ReturnType<ReturnType<typeof fileToolsFor>['files']> = []
    return {
        boundUser: (chatGuid) => briefableUserId(chatGuid).catch(() => null),
        async file(userId, fileId) {
            const { data } = await db.from('dinghy_files').select('id, origin_request, origin_google_derived, origin_kind, kind').eq('id', fileId).eq('user_id', userId).is('deleted_at', null).is('revoked_at', null).maybeSingle()
            return (data as WorkerFile | null) ?? null
        },
        async notes(userId, chatGuid, ids) {
            const owned = await db.from('spectrum_identities').select('chat_guid').eq('user_id', userId).eq('chat_guid', chatGuid).limit(1)
            if (owned.error || !owned.data?.length) return null
            const { data, error } = await db.from('spectrum_messages').select('id, content, google_derived, created_at').eq('chat_guid', chatGuid).eq('role', 'user').in('id', ids)
            if (error || !data) return null
            const byId = new Map((data as { id: string | number; content: string; google_derived?: boolean }[]).map((r) => [String(r.id), r]))
            const out: { text: string; google: boolean }[] = []
            for (const id of ids) { const r = byId.get(id); if (!r) return null; out.push({ text: r.content, google: Boolean(r.google_derived) }) }
            return out
        },
        async jobRow(jobId) {
            const { data } = await db.from('dinghy_redo_jobs').select('note_ids, note_revision').eq('id', jobId).maybeSingle()
            return (data as { note_ids: string[]; note_revision: number } | null) ?? null
        },
        advance: (phase, consumed) => advanceRedoJob(job.id, job.claim_id, phase, consumed),
        close: () => closeRedoJob(job.id, job.claim_id),
        fail: (reason) => failRedoJob(job.id, job.claim_id, reason),
        notify: (text) => notifyRedoOutcome(job.id, text),
        async build({ instruction, kind, google, gate }) {
            const toolCtx = await loadImessageToolContext(job.chat_guid)
            const role = await getBetaRole(job.chat_guid)
            if (!toolCtx || !role) throw new RedoCancelled()
            // File tools and read tools only: no spend, reminders, invites or account actions are offered to a redo.
            const files = fileToolsFor({ opId: job.op_id, googleDerived: google })
            const usage: GatewayUsage[] = []
            const loaded = await loadFacts().catch(() => [])
            // The same bounded, authorized profile and memory an ordinary turn gets, queried by this job's own request. No chat history.
            const memory = await loadMemoryContext(job.chat_guid, instruction.slice(0, 2000)).catch(() => EMPTY_MEMORY)
            try {
                const r = await chatWithTools([{ role: 'user', content: instruction }], {
                    deadlineAt: Date.now() + budgetMs, gatewayUrl: GATEWAY_URL, apiKey: SHIPYARD_API_KEY ?? '', model: SHIPYARD_MODEL, routing: routingFor(),
                    deliverable: { kind: kind as DeliverableKind, request: instruction }, facts: productFactsFor(role, loaded), clarified: true,
                    capabilities: capabilitiesFor(toolCtx), memory: renderMemoryBlock(memory), onUsage: (u: GatewayUsage) => usage.push(u), redoGate: gate,
                }, [...toolsFor(toolCtx), ...files.tools], toolCtx)
                madeFull = files.files()
                files.close()
                return { files: madeFull.map((f) => ({ url: f.hosted?.url ?? null, hosted: Boolean(f.hosted) })), tainted: Boolean(r.tainted) }
            } catch (e) {
                if (e instanceof DinghyRedoCancelled) throw new RedoCancelled()
                throw e
            } finally { await recordUsage(job.chat_guid, 'reply', usage).catch(() => undefined) }
        },
        async send(file) {
            const app = await getSpectrumApp()
            const space = isDemoGuid(job.chat_guid) ? demoSpace(job.chat_guid, { persist: true }) : await (await getImessage(app)).space.get(job.chat_guid)
            const full = madeFull.find((m) => m.hosted?.url === file.url)
            if (!full) throw new Error('made file not found for send')
            await sendFile(space as unknown as InboundSpace, job.chat_guid, full)
        },
        saveOrigin: (url, request, google, kind) => saveFileOrigin({ userId: job.user_id, chatGuid: job.chat_guid, url, request, googleDerived: google, kind, lineageId: job.lineage_id }),
        async discard(url) {
            // Only the page this very job attempt made (bound by its op id) and never sent. Nothing else is touched.
            const { data } = await db.from('dinghy_files').select('id').eq('user_id', job.user_id).eq('redo_op_id', job.op_id).eq('url', url).is('revoked_at', null).maybeSingle()
            const id = (data as { id?: string } | null)?.id
            if (!id) return 'failed'
            try { await revokeSite(url, job.user_id) } catch { return 'failed' }
            await db.from('dinghy_files').update({ revoked_at: new Date().toISOString() }).eq('id', id).eq('user_id', job.user_id)
            return 'removed'
        },
    }
}
