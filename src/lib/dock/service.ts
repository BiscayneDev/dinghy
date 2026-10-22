/**
 * Dinghy <-> Dock connector flows: pairing, @ routing, approval replies, Dock events, and the offline
 * queue drain. Every function takes its dependencies (store, send, fetch, clock) so the tests run the
 * whole flow against an in-memory store.
 *
 * Money: Dinghy never starts a money action. Dock creates approvals and Dinghy relays them. The only
 * writes Dinghy makes toward Dock are chat runs, pairing, unlink, and yes/no decisions on an approval
 * that Dock already created.
 */

import { createHash, randomBytes } from 'crypto'
import { decryptTokenFromDb, encryptTokenForDb } from '@/lib/crypto'
import { dockApi, type DockResult } from './client'
import { dueQueueHeads, planReply, queueBackoffMs, replayCheck, type ApprovalView } from './logic'
import { matchChiefMention, parsePairCommand, parseReply } from './parse'
import type { DockApprovalRow, DockLinkRow, DockQueueRow, DockStore } from './store'

export const DEFAULT_DOCK_BASE_URL = 'https://dock-harness.vercel.app'
const QUEUE_LOCK_MS = 60_000
const QUEUE_MAX_ATTEMPTS = 20
const RUN_TTL_MS = 24 * 60 * 60 * 1000
const MAX_RUN_TEXT = 900

export interface DockDeps {
    store: DockStore
    /** Sends a text into a chat (outbox-backed in production). */
    send: (chatGuid: string, text: string) => Promise<void>
    /** True when Dinghy itself is waiting on a yes or no in this chat (its own money confirmations). */
    hasOwnPending?: (chatGuid: string) => Promise<boolean>
    baseUrl: string
    fetchImpl?: typeof fetch
    now?: () => number
    newLinkRef?: () => string
}

function nowOf(deps: DockDeps): number {
    return deps.now ? deps.now() : Date.now()
}

function sha256Hex(s: string): string {
    return createHash('sha256').update(s, 'utf8').digest('hex')
}

function unreachableLine(name: string): string {
    return `Dock isn't answering. I'll send that to ${name} when it's back.`
}

function errorLine(kind: string): string {
    switch (kind) {
        case 'unauthorized':
            return 'Dock no longer accepts this link. Text "unlink dock" and pair again.'
        case 'conflict':
            return 'That was already decided in Dock.'
        case 'expired':
            return 'That approval expired, so I did not send it.'
        case 'changed':
            return 'That approval changed in Dock, so I did not send it.'
        default:
            return "Dock didn't take that. Try again in a moment."
    }
}

// ---------------------------------------------------------------- pairing

/**
 * Exchanges a one-time code for a connector token. The code is reserved here before the call (single
 * use on Dinghy's side as well) and released only when Dock was unreachable, so the user can retry.
 * Dock enforces the 10-minute expiry and the single use on its side (410 and 409).
 */
export async function pairChat(deps: DockDeps, chatGuid: string, code: string): Promise<string> {
    const existing = await deps.store.getLinkByChat(chatGuid)
    if (existing) return 'This chat is already linked to Dock. Text "unlink dock" first.'

    const codeHash = sha256Hex(code)
    const reserved = await deps.store.reserveCode(codeHash, chatGuid)
    if (!reserved) return 'That code was already used. Make a new one in Dock settings.'

    const linkRef = deps.newLinkRef ? deps.newLinkRef() : randomBytes(16).toString('hex')
    const res: DockResult<{ connector_token: string; workspace_id: string; chief_name: string }> = await dockApi.pair(
        deps.baseUrl,
        code,
        linkRef,
        deps.fetchImpl
    )
    if (!res.ok) {
        if (res.kind === 'unreachable') {
            await deps.store.releaseCode(codeHash)
            return "Dock didn't answer. Send the code again in a minute."
        }
        if (res.kind === 'expired') return 'That code expired. Make a new one in Dock settings.'
        return "That code didn't work. Make a new one in Dock settings."
    }

    const chief = res.data.chief_name?.trim()
    if (!chief || !res.data.connector_token || !res.data.workspace_id) {
        return "Dock sent back something I couldn't read. Try again in a minute."
    }
    const link: DockLinkRow = {
        chat_guid: chatGuid,
        user_id: null,
        link_ref: linkRef,
        dock_base_url: deps.baseUrl,
        workspace_ref: res.data.workspace_id,
        chief_name: chief,
        pending_chief_name: null,
        token_ciphertext: encryptTokenForDb(res.data.connector_token),
        status: 'linked',
    }
    await deps.store.saveLink(link)
    return `Dock is linked. Your Chief of Staff is ${chief}. Text @${chief} to send it a request.`
}

/** Removes the link. Dock is told best-effort; the local link is removed either way. */
export async function unlinkChat(deps: DockDeps, chatGuid: string): Promise<string> {
    const link = await deps.store.getLinkByChat(chatGuid)
    if (!link) return ''
    try {
        const token = decryptTokenFromDb(link.token_ciphertext)
        await dockApi.unlink(link.dock_base_url, token, deps.fetchImpl)
    } catch {
        // Dock unreachable or token unreadable: the local unlink still happens.
    }
    await deps.store.markUnlinked(chatGuid)
    return 'Unlinked from Dock. Dinghy stays as it was.'
}

// ---------------------------------------------------------------- inbound text

/**
 * Handles one inbound message for the connector. Returns true when the message was a connector message
 * (answered here), false when it must take today's Dinghy path.
 */
export async function handleDockInbound(deps: DockDeps, chatGuid: string, text: string): Promise<boolean> {
    const cmd = parsePairCommand(text)
    if (cmd?.kind === 'pair') {
        await deps.send(chatGuid, await pairChat(deps, chatGuid, cmd.code))
        return true
    }
    if (cmd?.kind === 'unlink') {
        const msg = await unlinkChat(deps, chatGuid)
        if (!msg) return false
        await deps.send(chatGuid, msg)
        return true
    }

    const hasAt = text.includes('@')
    const intent = parseReply(text)
    if (!hasAt && !intent) return false

    const link = await deps.store.getLinkByChat(chatGuid)
    if (!link) return false

    if (hasAt) {
        const mention = matchChiefMention(text, link.chief_name)
        if (mention) {
            await routeToChief(deps, link, chatGuid, mention.body)
            return true
        }
    }
    if (!intent) return false

    // Dinghy's own yes/no confirmations (money actions it asked for itself) keep today's handling.
    if (deps.hasOwnPending && (await deps.hasOwnPending(chatGuid))) return false

    await handleReply(deps, link, chatGuid, intent)
    return true
}

async function routeToChief(deps: DockDeps, link: DockLinkRow, chatGuid: string, body: string): Promise<void> {
    const name = link.chief_name
    if (!body) {
        await deps.send(chatGuid, `Tell ${name} what you need after the @${name}.`)
        return
    }
    // One client_message_id per message: Dock dedupes on it, so a replay after a timeout never runs twice.
    const clientMessageId = randomBytes(12).toString('hex')
    const token = decryptTokenFromDb(link.token_ciphertext)
    const res = await dockApi.submitRun(link.dock_base_url, token, name, body, clientMessageId, deps.fetchImpl)
    if (res.ok) {
        await deps.send(chatGuid, `Sent to ${res.data.agent_name || name}.`)
        return
    }
    if (res.kind === 'unreachable') {
        await deps.store.enqueue({
            chat_guid: chatGuid,
            kind: 'run',
            payload: { agent: name, message: body, client_message_id: clientMessageId },
            expires_at: new Date(nowOf(deps) + RUN_TTL_MS).toISOString(),
        })
        await deps.send(chatGuid, unreachableLine(name))
        return
    }
    await deps.send(chatGuid, errorLine(res.kind))
}

async function handleReply(
    deps: DockDeps,
    link: DockLinkRow,
    chatGuid: string,
    intent: NonNullable<ReturnType<typeof parseReply>>
): Promise<void> {
    const now = nowOf(deps)
    const approvals = await deps.store.listApprovals(chatGuid)
    const views: ApprovalView[] = approvals.map(toView)
    const plan = planReply({ intent, approvals: views, pendingRename: link.pending_chief_name, nowMs: now })

    switch (plan.type) {
        case 'none':
            await deps.send(chatGuid, 'Nothing is waiting on a yes or no from you.')
            return
        case 'ask':
            await deps.send(chatGuid, `Which one? ${plan.labels.join(', ')}. Reply "yes <name>" or "no <name>".`)
            return
        case 'unknown_label':
            await deps.send(chatGuid, `Nothing called that is waiting. Waiting: ${plan.labels.join(', ')}.`)
            return
        case 'confirm_rename':
            await deps.store.setChiefName(chatGuid, plan.newName, null)
            await deps.send(chatGuid, `Routing @${plan.newName} to Dock now.`)
            return
        case 'cancel_rename':
            await deps.store.setChiefName(chatGuid, null, null)
            await deps.send(chatGuid, `Keeping ${link.chief_name}.`)
            return
        case 'expired': {
            await deps.store.transitionApproval(plan.approval.id, ['pending', 'decision_queued'], { status: 'expired', resolved: true })
            await deps.send(chatGuid, errorLine('expired'))
            return
        }
        case 'changed': {
            // The user saw an older version. Show the current one again; the next reply is for it.
            const row = approvals.find((a) => a.id === plan.approval.id)
            if (row) {
                await deps.store.setShownHash(row.id, row.details_hash)
                await deps.send(chatGuid, approvalCard(link.chief_name, row, true))
            }
            await deps.send(chatGuid, errorLine('changed'))
            return
        }
        case 'decide':
            await decideApproval(deps, link, chatGuid, plan.approval.id, plan.decision)
            return
    }
}

async function decideApproval(
    deps: DockDeps,
    link: DockLinkRow,
    chatGuid: string,
    approvalId: string,
    decision: 'approve' | 'reject'
): Promise<void> {
    const row = await deps.store.getApproval(approvalId)
    if (!row) return
    // Single resolution: only one reply can move the approval out of 'pending'.
    const claimed = await deps.store.transitionApproval(approvalId, ['pending'], { status: 'decision_queued', decision })
    if (!claimed) {
        await deps.send(chatGuid, 'That one is already being handled.')
        return
    }
    const token = decryptTokenFromDb(link.token_ciphertext)
    const res = await dockApi.decideApproval(link.dock_base_url, token, approvalId, decision, row.details_hash, deps.fetchImpl)
    if (res.ok) {
        await deps.store.transitionApproval(approvalId, ['decision_queued'], { status: decision === 'approve' ? 'approved' : 'rejected', decision, resolved: true })
        await deps.send(chatGuid, decision === 'approve' ? `Approved. ${row.label} is going through.` : `Rejected. ${row.label} is cancelled.`)
        return
    }
    if (res.kind === 'unreachable') {
        // Queued with the details the user approved. The drain re-checks expiry and details before sending.
        await deps.store.enqueue({
            chat_guid: chatGuid,
            kind: 'approval_decision',
            payload: { approval_id: approvalId, decision, expected_details_hash: row.details_hash },
            expires_at: row.expires_at,
        })
        await deps.send(chatGuid, unreachableLine(link.chief_name))
        return
    }
    if (res.kind === 'expired') {
        await deps.store.transitionApproval(approvalId, ['decision_queued'], { status: 'expired', resolved: true })
    } else if (res.kind === 'changed') {
        await deps.store.transitionApproval(approvalId, ['decision_queued'], { status: 'pending' })
        await deps.store.setShownHash(approvalId, null)
    } else {
        await deps.store.transitionApproval(approvalId, ['decision_queued'], { status: 'closed', resolved: true })
    }
    await deps.send(chatGuid, errorLine(res.kind))
}

function toView(a: DockApprovalRow): ApprovalView {
    return {
        id: a.id,
        label: a.label,
        status: a.status,
        decision: a.decision,
        details_hash: a.details_hash,
        shown_hash: a.shown_hash,
        expires_at: a.expires_at,
    }
}

function approvalCard(chief: string, a: DockApprovalRow, again = false): string {
    const amount = a.amount_text ? ` for ${a.amount_text}` : ''
    const dest = a.destination ? ` to ${a.destination}` : ''
    const lead = again ? 'Updated approval' : `${chief} needs a yes or no`
    const card = a.card_url ? ` Details: ${a.card_url}` : ''
    return `${lead} (${a.label}): ${a.action}${amount}${dest}. Reply yes or no.${card}`
}

// ---------------------------------------------------------------- Dock -> Dinghy events

export interface DockEvent {
    event_id: string
    type: string
    link_ref: string
    workspace_id: string
    data: Record<string, unknown>
}

export type DockEventOutcome = 'applied' | 'duplicate' | 'unknown_link' | 'ignored'

function str(v: unknown, max: number): string | null {
    if (typeof v !== 'string') return null
    const t = v.trim()
    return t ? t.slice(0, max) : null
}

export async function applyDockEvent(deps: DockDeps, event: DockEvent): Promise<DockEventOutcome> {
    const fresh = await deps.store.recordEvent(event.event_id)
    if (!fresh) return 'duplicate'

    const link = await deps.store.getLinkByRef(event.link_ref)
    if (!link || link.status !== 'linked' || link.workspace_ref !== event.workspace_id) return 'unknown_link'
    const chat = link.chat_guid
    const d = event.data ?? {}

    switch (event.type) {
        case 'approval.requested': {
            const id = str(d.approval_id, 80)
            const label = str(d.label, 80)
            const action = str(d.action, 300)
            const hash = str(d.details_hash, 128)
            const expires = str(d.expires_at, 40)
            if (!id || !label || !action || !hash || !expires || Number.isNaN(Date.parse(expires))) return 'ignored'
            const row = {
                id,
                chat_guid: chat,
                label,
                action,
                amount_text: str(d.amount_text, 80),
                destination: str(d.destination, 200),
                details_hash: hash,
                card_url: str(d.card_url, 500),
                expires_at: new Date(expires).toISOString(),
            }
            // A decided approval never returns to 'pending' from a late or repeated Dock event.
            const before = await deps.store.getApproval(id)
            if (before && before.status !== 'pending') return 'ignored'
            await deps.store.upsertApproval(row)
            const saved = await deps.store.getApproval(id)
            if (!saved || saved.status !== 'pending') return 'ignored'
            await deps.send(chat, approvalCard(link.chief_name, { ...saved, shown_hash: null } as DockApprovalRow))
            await deps.store.setShownHash(id, hash)
            return 'applied'
        }
        case 'approval.closed': {
            const id = str(d.approval_id, 80)
            if (!id) return 'ignored'
            const moved = await deps.store.transitionApproval(id, ['pending', 'decision_queued'], { status: 'closed', resolved: true })
            if (moved) await deps.send(chat, 'An approval was closed in Dock.')
            return 'applied'
        }
        case 'run.update': {
            const text = str(d.text, MAX_RUN_TEXT)
            if (!text) return 'ignored'
            const who = str(d.agent_name, 40) ?? link.chief_name
            await deps.send(chat, `${who}: ${text}`)
            return 'applied'
        }
        case 'chief.renamed': {
            const newName = str(d.new_name, 40)
            const oldName = str(d.old_name, 40) ?? link.chief_name
            if (!newName || newName === link.chief_name) return 'ignored'
            // Routing keeps the old name until the user confirms the new one.
            await deps.store.setChiefName(chat, null, newName)
            await deps.send(
                chat,
                `Dock renamed ${oldName} to ${newName}. Reply yes to start routing @${newName} to Dock, or no to keep ${oldName}.`
            )
            return 'applied'
        }
        case 'link.revoked': {
            await deps.store.markUnlinked(chat)
            await deps.send(chat, 'Dock unlinked this chat. Dinghy stays as it was.')
            return 'applied'
        }
        default:
            return 'ignored'
    }
}

// ---------------------------------------------------------------- offline queue

/**
 * Replays queued Dock requests, oldest first per chat. Approval decisions are re-checked against the
 * approval before sending: an expired, changed, or already-decided approval is never sent. Returns the
 * number of rows it sent.
 */
export async function drainDockQueue(deps: DockDeps): Promise<number> {
    const now = nowOf(deps)
    const rows = await deps.store.listQueued(200)
    const due = dueQueueHeads(rows, now)
    let sent = 0
    for (const row of due) {
        const locked = await deps.store.lockQueueRow(row.id, new Date(now + QUEUE_LOCK_MS).toISOString())
        if (!locked) continue
        const ok = await sendQueued(deps, row, now)
        if (ok) sent++
    }
    return sent
}

async function failQueued(deps: DockDeps, row: DockQueueRow, status: 'dropped' | 'failed', error: string | null): Promise<void> {
    await deps.store.updateQueueRow(row.id, { status, last_error: error, locked_until: null })
}

async function retryLater(deps: DockDeps, row: DockQueueRow, now: number, error: string): Promise<boolean> {
    const attempts = row.attempts + 1
    if (attempts >= QUEUE_MAX_ATTEMPTS) {
        await failQueued(deps, row, 'failed', error)
        return false
    }
    await deps.store.updateQueueRow(row.id, {
        attempts,
        next_attempt_at: new Date(now + queueBackoffMs(attempts)).toISOString(),
        locked_until: null,
        last_error: error,
    })
    return false
}

async function sendQueued(deps: DockDeps, row: DockQueueRow, now: number): Promise<boolean> {
    if (Date.parse(row.expires_at) <= now) {
        await failQueued(deps, row, 'dropped', 'expired')
        if (row.kind === 'approval_decision') {
            await deps.store.transitionApproval(String(row.payload.approval_id), ['decision_queued'], { status: 'expired', resolved: true })
        }
        await deps.send(row.chat_guid, errorLine('expired'))
        return false
    }
    const link = await deps.store.getLinkByChat(row.chat_guid)
    if (!link) {
        await failQueued(deps, row, 'dropped', 'unlinked')
        return false
    }
    const token = decryptTokenFromDb(link.token_ciphertext)

    if (row.kind === 'run') {
        const p = row.payload as { agent: string; message: string; client_message_id: string }
        const res = await dockApi.submitRun(link.dock_base_url, token, p.agent, p.message, p.client_message_id, deps.fetchImpl)
        if (res.ok) {
            await deps.store.updateQueueRow(row.id, { status: 'sent', sent_at: new Date(now).toISOString(), locked_until: null })
            await deps.send(row.chat_guid, `Sent to ${res.data.agent_name || p.agent}.`)
            return true
        }
        if (res.kind === 'unreachable') return retryLater(deps, row, now, 'unreachable')
        await failQueued(deps, row, 'failed', res.kind)
        await deps.send(row.chat_guid, errorLine(res.kind))
        return false
    }

    // approval_decision: the approval must still be waiting for this decision, unexpired, same details.
    const approvalId = String(row.payload.approval_id)
    const decision = row.payload.decision as 'approve' | 'reject'
    const expectedHash = String(row.payload.expected_details_hash)
    const approval = await deps.store.getApproval(approvalId)
    const check = replayCheck(approval ? toView(approval) : null, expectedHash, now)
    if (check !== 'send') {
        if (check === 'expired') {
            await deps.store.transitionApproval(approvalId, ['decision_queued'], { status: 'expired', resolved: true })
            await deps.send(row.chat_guid, errorLine('expired'))
        } else if (check === 'changed') {
            await deps.store.transitionApproval(approvalId, ['decision_queued'], { status: 'pending' })
            await deps.store.setShownHash(approvalId, null)
            await deps.send(row.chat_guid, errorLine('changed'))
        }
        await failQueued(deps, row, 'dropped', check)
        return false
    }
    const res = await dockApi.decideApproval(link.dock_base_url, token, approvalId, decision, expectedHash, deps.fetchImpl)
    if (res.ok) {
        await deps.store.transitionApproval(approvalId, ['decision_queued'], {
            status: decision === 'approve' ? 'approved' : 'rejected',
            decision,
            resolved: true,
        })
        await deps.store.updateQueueRow(row.id, { status: 'sent', sent_at: new Date(now).toISOString(), locked_until: null })
        await deps.send(row.chat_guid, decision === 'approve' ? `Approved. ${approval?.label ?? 'It'} is going through.` : `Rejected. ${approval?.label ?? 'It'} is cancelled.`)
        return true
    }
    if (res.kind === 'unreachable') return retryLater(deps, row, now, 'unreachable')
    await deps.store.transitionApproval(approvalId, ['decision_queued'], { status: res.kind === 'changed' ? 'pending' : 'closed', resolved: true })
    await failQueued(deps, row, 'failed', res.kind)
    await deps.send(row.chat_guid, errorLine(res.kind))
    return false
}
