import type { ClaimedJob, CloseResult, FenceResult } from './redo-jobs'
import { redoInstruction } from '@/lib/files/deliverable-intent'

/**
 * Runs one claimed redo job. Authority comes from the job's owner (checked against the chat's bound user), the model gets the file's own
 * stored request plus the user's notes (never the whole chat), only read tools and file tools are offered (no spend, reminders, invites or
 * account actions), and every external step is fenced in the database. Nothing here retries an unknown external outcome.
 */
export class RedoCancelled extends Error {}
export class RedoLost extends Error {}
export class RedoNoteUnavailable extends Error {}

export interface WorkerFile { id: string; origin_request: string | null; origin_google_derived: boolean; origin_kind: string | null; kind: string | null }
export interface MadeRedoFile { url: string | null; hosted: boolean }
export interface WorkerDeps {
    boundUser(chatGuid: string): Promise<string | null>
    file(userId: string, fileId: string): Promise<WorkerFile | null>
    /** Notes by id, owner and chat scoped, user rows only. Throws RedoNoteUnavailable via a missing id. Returns text and whether it was Google-derived. */
    notes(userId: string, chatGuid: string, ids: string[]): Promise<{ text: string; google: boolean }[] | null>
    jobRow(jobId: string): Promise<{ note_ids: string[]; note_revision: number } | null>
    advance(phase: 'building' | 'publishing' | 'published' | 'sending' | 'sent', consumed: number): Promise<FenceResult>
    close(): Promise<CloseResult>
    fail(reason: string): Promise<boolean>
    notify(text: string): Promise<boolean>
    /** Runs the model job with the gate. Returns the files it made (already stored with redo_op_id) and whether input was Google-derived. */
    build(args: { instruction: string; kind: string; google: boolean; gate: (close: boolean) => Promise<{ notes: string[]; cancelled: boolean }> }): Promise<{ files: MadeRedoFile[]; tainted: boolean }>
    send(file: MadeRedoFile): Promise<void>
    /** Takes down only the page this job made and never sent. 'removed' only when the host confirmed it. */
    discard(url: string): Promise<'removed' | 'failed'>
    saveOrigin(url: string, request: string, google: boolean, kind: string): Promise<boolean>
}

export type WorkerOutcome = 'done' | 'requeued' | 'failed' | 'cancelled' | 'blocked' | 'note_unapplied'

export async function executeRedoJob(job: ClaimedJob, deps: WorkerDeps): Promise<WorkerOutcome> {
    const finish = async (reason: string, text: string): Promise<WorkerOutcome> => {
        await deps.fail(reason)
        await deps.notify(text)
        return 'failed'
    }
    const user = await deps.boundUser(job.chat_guid)
    if (!user || user !== job.user_id) return finish('owner_mismatch', 'I could not rebuild that page because I could not confirm it is yours, so nothing was changed.')
    const file = await deps.file(job.user_id, job.file_id)
    if (!file?.origin_request) return finish('origin_unavailable', 'I could not rebuild that page because the request it was made from is no longer stored, so nothing was changed.')
    const kind = file.origin_kind ?? (file.kind === 'itinerary' ? 'itinerary' : null)
    if (!kind) return finish('kind_unknown', 'I could not tell what kind of page that was, so I have not redone it. Nothing was changed.')

    let consumedRev = 0
    const seen = new Set<string>()
    const noteTexts: string[] = []
    let google = file.origin_google_derived
    const loadNotes = async (): Promise<string[]> => {
        const row = await deps.jobRow(job.id)
        if (!row) throw new RedoLost()
        const fresh = row.note_ids.filter((id) => !seen.has(id))
        const loaded = fresh.length ? await deps.notes(job.user_id, job.chat_guid, fresh) : []
        if (!loaded || loaded.length !== fresh.length) throw new RedoNoteUnavailable()
        fresh.forEach((id) => seen.add(id))
        const texts = loaded.map((n) => n.text)
        if (loaded.some((n) => n.google)) google = true
        noteTexts.push(...texts)
        consumedRev = row.note_revision
        return texts
    }
    try {
        await loadNotes()
        const built = await deps.build({
            instruction: redoInstruction(file.origin_request, noteTexts), kind, google,
            gate: async (close) => {
                const notes = await loadNotes()
                const verdict = await deps.advance(close ? 'publishing' : 'building', consumedRev)
                if (verdict === 'cancelled') return { notes: [], cancelled: true }
                if (verdict === 'stale') return { notes: notes.length ? notes : await loadNotes(), cancelled: false }
                if (verdict !== 'ok') throw new RedoLost()
                return { notes, cancelled: false }
            },
        })
        const made = built.files.find((f) => f.url)
        if (!made?.url) return finish('no_file', 'I could not rebuild that page just now. The earlier version is unchanged.')
        if (built.tainted) google = true
        const ok1 = await deps.advance('published', consumedRev)
        if (ok1 !== 'ok') throw new RedoLost()
        const ok2 = await deps.advance('sending', consumedRev)
        if (ok2 === 'cancelled') {
            const gone = await deps.discard(made.url).catch(() => 'failed' as const)
            await deps.notify(gone === 'removed'
                ? 'A new version was built before your stop reached it. I did not send it and I took that page down. The earlier version is unchanged.'
                : 'A new version was built before your stop reached it. I did not send it, but I could not take that page down, so its link stays live until it expires. The earlier version is unchanged.')
            return 'cancelled'
        }
        if (ok2 !== 'ok') throw new RedoLost()
        // Stored before the send so a later correction can bind to this version.
        await deps.saveOrigin(made.url, redoInstruction(file.origin_request, noteTexts), google, kind).catch(() => false)
        await deps.send(made)
        if ((await deps.advance('sent', consumedRev)) !== 'ok') throw new RedoLost()
        const closed = await deps.close()
        if (closed === 'note_unapplied') { await deps.notify('I sent a new version, but a later note of yours is not in it. I stopped after two passes, so that note was not applied and nothing more is queued.'); return 'note_unapplied' }
        return closed === 'requeued' ? 'requeued' : 'done'
    } catch (err) {
        if (err instanceof RedoCancelled) { await deps.notify('Stopped that redo. Nothing new was sent from it.'); return 'cancelled' }
        if (err instanceof RedoNoteUnavailable) return finish('note_unavailable', 'I could not rebuild that page because one of your notes is no longer available, so nothing was changed.')
        if (err instanceof RedoLost) return 'blocked'
        // Unknown error after possible external effects: never retried. The lease expires and the database blocks or fails it by phase.
        throw err
    }
}
