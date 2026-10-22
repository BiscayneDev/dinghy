/**
 * Pure decisions for the Dock connector: which approval a reply resolves, whether a queued decision may
 * still be sent, and which queued Dock request is due next. No I/O here, so the rules are unit-tested
 * directly.
 */

import type { ReplyIntent } from './parse'

export interface ApprovalView {
    id: string
    label: string
    status: string
    decision?: string | null
    details_hash: string
    shown_hash: string | null
    expires_at: string
}

export type ReplyPlan =
    | { type: 'decide'; approval: ApprovalView; decision: 'approve' | 'reject' }
    | { type: 'confirm_rename'; newName: string }
    | { type: 'cancel_rename'; newName: string }
    | { type: 'ask'; labels: string[] }
    | { type: 'expired'; approval: ApprovalView }
    | { type: 'changed'; approval: ApprovalView }
    | { type: 'unknown_label'; labels: string[] }
    | { type: 'none' }

/** Approvals a reply can resolve: pending in Dock, not yet decided here, not expired. */
export function actionableApprovals(list: ApprovalView[], nowMs: number): { live: ApprovalView[]; expired: ApprovalView[] } {
    const pending = list.filter((a) => a.status === 'pending')
    const live = pending.filter((a) => Date.parse(a.expires_at) > nowMs)
    const expired = pending.filter((a) => Date.parse(a.expires_at) <= nowMs)
    return { live, expired }
}

function normLabel(s: string): string {
    return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Chooses what a bare or labelled yes/no reply means. A reply resolves exactly one item:
 * one approval, or the pending chief rename. Anything ambiguous asks. Nothing pending says so.
 */
export function planReply(input: {
    intent: ReplyIntent
    approvals: ApprovalView[]
    pendingRename: string | null
    nowMs: number
}): ReplyPlan {
    const { intent, pendingRename, nowMs } = input
    const { live, expired } = actionableApprovals(input.approvals, nowMs)
    const label = intent.label ? normLabel(intent.label) : null

    if (label) {
        if (pendingRename && (label === 'rename' || label === 'name')) {
            return intent.decision === 'approve'
                ? { type: 'confirm_rename', newName: pendingRename }
                : { type: 'cancel_rename', newName: pendingRename }
        }
        const matches = live.filter((a) => normLabel(a.label) === label)
        if (matches.length === 1) {
            const a = matches[0]
            if (a.shown_hash !== a.details_hash) return { type: 'changed', approval: a }
            return { type: 'decide', approval: a, decision: intent.decision }
        }
        const expiredMatch = expired.find((a) => normLabel(a.label) === label)
        if (expiredMatch) return { type: 'expired', approval: expiredMatch }
        const labels = live.map((a) => a.label)
        if (labels.length === 0 && !pendingRename) return { type: 'none' }
        return { type: 'unknown_label', labels: pendingRename ? [...labels, 'rename'] : labels }
    }

    const liveLabels = live.map((a) => a.label)
    if (live.length === 0 && pendingRename) {
        return intent.decision === 'approve'
            ? { type: 'confirm_rename', newName: pendingRename }
            : { type: 'cancel_rename', newName: pendingRename }
    }
    if (live.length === 0) {
        if (expired.length > 0) return { type: 'expired', approval: expired[0] }
        return { type: 'none' }
    }
    if (live.length + (pendingRename ? 1 : 0) > 1) {
        return { type: 'ask', labels: pendingRename ? [...liveLabels, 'rename'] : liveLabels }
    }
    const only = live[0]
    if (only.shown_hash !== only.details_hash) return { type: 'changed', approval: only }
    return { type: 'decide', approval: only, decision: intent.decision }
}

/**
 * Replay guard for a queued approval decision. A queued decision is sent only if the approval is still
 * waiting for it, has not expired, and its details still match what the user was shown.
 */
export function replayCheck(
    approval: ApprovalView | null,
    expectedHash: string,
    nowMs: number
): 'send' | 'missing' | 'not_queued' | 'expired' | 'changed' {
    if (!approval) return 'missing'
    if (approval.status !== 'decision_queued') return 'not_queued'
    if (Date.parse(approval.expires_at) <= nowMs) return 'expired'
    if (approval.details_hash !== expectedHash) return 'changed'
    return 'send'
}

export interface QueueRowLite {
    id: string
    chat_guid: string
    created_at: string
    status: string
    next_attempt_at: string
    locked_until: string | null
}

/**
 * Due rows for the sweep, in order. Per chat only the oldest queued row can go, so a later message
 * never overtakes an earlier one. A backed-off head holds back its chat's later rows.
 */
export function dueQueueHeads<T extends QueueRowLite>(rows: T[], nowMs: number): T[] {
    const byChat = new Map<string, T[]>()
    for (const r of rows) {
        if (r.status !== 'queued') continue
        const list = byChat.get(r.chat_guid) ?? []
        list.push(r)
        byChat.set(r.chat_guid, list)
    }
    const due: T[] = []
    for (const list of byChat.values()) {
        list.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1))
        const head = list[0]
        const lockedUntil = head.locked_until ? Date.parse(head.locked_until) : 0
        if (Date.parse(head.next_attempt_at) <= nowMs && lockedUntil <= nowMs) due.push(head)
    }
    return due
}

/** Retry delay after the Nth failed attempt: 30s, doubling, capped at 30 minutes. */
export function queueBackoffMs(attempts: number): number {
    const base = 30_000 * Math.pow(2, Math.max(0, attempts - 1))
    return Math.min(base, 30 * 60_000)
}
