/**
 * Storage for the Dock connector. Service role only (the Dinghy app writes through createServerClient).
 * The service layer depends on the DockStore interface, so the tests run against an in-memory store.
 */

import { createServerClient } from '@/lib/supabase/server'

export interface DockLinkRow {
    chat_guid: string
    user_id: string | null
    link_ref: string
    dock_base_url: string
    workspace_ref: string
    chief_name: string
    pending_chief_name: string | null
    token_ciphertext: string
    status: 'linked' | 'unlinked'
}

export interface DockApprovalRow {
    id: string
    chat_guid: string
    label: string
    action: string
    amount_text: string | null
    destination: string | null
    details_hash: string
    shown_hash: string | null
    card_url: string | null
    status: string
    decision: string | null
    expires_at: string
}

export interface DockQueueRow {
    id: string
    chat_guid: string
    kind: 'run' | 'approval_decision'
    payload: Record<string, unknown>
    status: string
    attempts: number
    next_attempt_at: string
    locked_until: string | null
    expires_at: string
    created_at: string
    last_error?: string | null
    sent_at?: string | null
}

export interface DockStore {
    getLinkByChat(chatGuid: string): Promise<DockLinkRow | null>
    getLinkByRef(linkRef: string): Promise<DockLinkRow | null>
    saveLink(row: DockLinkRow): Promise<void>
    markUnlinked(chatGuid: string): Promise<void>
    setChiefName(chatGuid: string, name: string | null, pendingName: string | null): Promise<void>
    /** Returns false when the code was already reserved (single use). */
    reserveCode(codeHash: string, chatGuid: string): Promise<boolean>
    releaseCode(codeHash: string): Promise<void>
    /** Records an event id. Returns false when it was seen before (replay). */
    recordEvent(eventId: string): Promise<boolean>

    /** The owner's "Always allow" memory for one Dock workspace, if they chose it. */
    getGrant(chatGuid: string, workspaceRef: string): Promise<{ granted_at: string } | null>
    saveGrant(chatGuid: string, workspaceRef: string): Promise<void>
    /** Every unlink path drops the workspace grants so auto-reconnect can never undo a revocation. */
    deleteGrants(chatGuid: string): Promise<void>

    listApprovals(chatGuid: string): Promise<DockApprovalRow[]>
    getApproval(id: string): Promise<DockApprovalRow | null>
    upsertApproval(row: Omit<DockApprovalRow, 'status' | 'decision' | 'shown_hash'> & { status?: string }): Promise<void>
    setShownHash(id: string, hash: string | null): Promise<void>
    /** Moves an approval from one of `from` to `to` only if its status is still in `from`. Returns false otherwise. */
    transitionApproval(id: string, from: string[], to: { status: string; decision?: string | null; resolved?: boolean }): Promise<boolean>

    enqueue(row: { chat_guid: string; kind: 'run' | 'approval_decision'; payload: Record<string, unknown>; expires_at: string }): Promise<void>
    listQueued(limit: number): Promise<DockQueueRow[]>
    lockQueueRow(id: string, lockedUntilIso: string): Promise<boolean>
    updateQueueRow(id: string, patch: Partial<Pick<DockQueueRow, 'status' | 'attempts' | 'next_attempt_at' | 'locked_until'>> & { last_error?: string | null; sent_at?: string | null }): Promise<void>
}

const TABLE_LINKS = 'dock_links'

export function supabaseDockStore(): DockStore {
    const db = () => createServerClient()

    return {
        async getLinkByChat(chatGuid) {
            const { data, error } = await db().from(TABLE_LINKS).select('*').eq('chat_guid', chatGuid).eq('status', 'linked').maybeSingle()
            if (error) throw new Error(`dock link read failed: ${error.message}`)
            return (data as DockLinkRow | null) ?? null
        },
        async getLinkByRef(linkRef) {
            const { data, error } = await db().from(TABLE_LINKS).select('*').eq('link_ref', linkRef).maybeSingle()
            if (error) throw new Error(`dock link read failed: ${error.message}`)
            return (data as DockLinkRow | null) ?? null
        },
        async saveLink(row) {
            const { error } = await db()
                .from(TABLE_LINKS)
                .upsert({ ...row, status: 'linked', unlinked_at: null, updated_at: new Date().toISOString() }, { onConflict: 'chat_guid' })
            if (error) throw new Error(`dock link save failed: ${error.message}`)
        },
        async markUnlinked(chatGuid) {
            const { error } = await db()
                .from(TABLE_LINKS)
                .update({ status: 'unlinked', unlinked_at: new Date().toISOString(), pending_chief_name: null, token_ciphertext: 'revoked', updated_at: new Date().toISOString() })
                .eq('chat_guid', chatGuid)
            if (error) throw new Error(`dock unlink failed: ${error.message}`)
        },
        async setChiefName(chatGuid, name, pendingName) {
            const patch: Record<string, unknown> = { pending_chief_name: pendingName, updated_at: new Date().toISOString() }
            if (name) patch.chief_name = name
            const { error } = await db().from(TABLE_LINKS).update(patch).eq('chat_guid', chatGuid)
            if (error) throw new Error(`dock chief update failed: ${error.message}`)
        },
        async reserveCode(codeHash, chatGuid) {
            const { error } = await db().from('dock_pair_codes').insert({ code_hash: codeHash, chat_guid: chatGuid })
            if (error) {
                if (error.code === '23505') return false
                throw new Error(`dock code reserve failed: ${error.message}`)
            }
            return true
        },
        async releaseCode(codeHash) {
            await db().from('dock_pair_codes').delete().eq('code_hash', codeHash)
        },
        async recordEvent(eventId) {
            const { error } = await db().from('dock_events').insert({ event_id: eventId })
            if (error) {
                if (error.code === '23505') return false
                throw new Error(`dock event record failed: ${error.message}`)
            }
            return true
        },
        async getGrant(chatGuid, workspaceRef) {
            const { data, error } = await db()
                .from('dock_connect_grants')
                .select('granted_at')
                .eq('chat_guid', chatGuid)
                .eq('workspace_ref', workspaceRef)
                .maybeSingle()
            if (error) throw new Error(`dock grant read failed: ${error.message}`)
            return (data as { granted_at: string } | null) ?? null
        },
        async saveGrant(chatGuid, workspaceRef) {
            const { error } = await db()
                .from('dock_connect_grants')
                .upsert({ chat_guid: chatGuid, workspace_ref: workspaceRef }, { onConflict: 'chat_guid,workspace_ref' })
            if (error) throw new Error(`dock grant save failed: ${error.message}`)
        },
        async deleteGrants(chatGuid) {
            const { error } = await db().from('dock_connect_grants').delete().eq('chat_guid', chatGuid)
            if (error) throw new Error(`dock grant delete failed: ${error.message}`)
        },
        async listApprovals(chatGuid) {
            const { data, error } = await db()
                .from('dock_approvals')
                .select('*')
                .eq('chat_guid', chatGuid)
                .in('status', ['pending', 'decision_queued'])
                .order('created_at', { ascending: true })
            if (error) throw new Error(`dock approvals read failed: ${error.message}`)
            return (data ?? []) as DockApprovalRow[]
        },
        async getApproval(id) {
            const { data, error } = await db().from('dock_approvals').select('*').eq('id', id).maybeSingle()
            if (error) throw new Error(`dock approval read failed: ${error.message}`)
            return (data as DockApprovalRow | null) ?? null
        },
        async upsertApproval(row) {
            const { error } = await db().from('dock_approvals').upsert(
                { ...row, status: row.status ?? 'pending', shown_hash: null },
                { onConflict: 'id' }
            )
            if (error) throw new Error(`dock approval save failed: ${error.message}`)
        },
        async setShownHash(id, hash) {
            const { error } = await db().from('dock_approvals').update({ shown_hash: hash }).eq('id', id)
            if (error) throw new Error(`dock approval update failed: ${error.message}`)
        },
        async transitionApproval(id, from, to) {
            const patch: Record<string, unknown> = { status: to.status }
            if (to.decision !== undefined) patch.decision = to.decision
            if (to.resolved) patch.resolved_at = new Date().toISOString()
            const { data, error } = await db().from('dock_approvals').update(patch).eq('id', id).in('status', from).select('id')
            if (error) throw new Error(`dock approval transition failed: ${error.message}`)
            return (data ?? []).length === 1
        },
        async enqueue(row) {
            const { error } = await db().from('dock_outbound').insert(row)
            if (error) throw new Error(`dock enqueue failed: ${error.message}`)
        },
        async listQueued(limit) {
            const { data, error } = await db()
                .from('dock_outbound')
                .select('*')
                .eq('status', 'queued')
                .order('created_at', { ascending: true })
                .limit(limit)
            if (error) throw new Error(`dock queue read failed: ${error.message}`)
            return (data ?? []) as DockQueueRow[]
        },
        async lockQueueRow(id, lockedUntilIso) {
            const nowIso = new Date().toISOString()
            const { data, error } = await db()
                .from('dock_outbound')
                .update({ locked_until: lockedUntilIso })
                .eq('id', id)
                .eq('status', 'queued')
                .or(`locked_until.is.null,locked_until.lt.${nowIso}`)
                .select('id')
            if (error) throw new Error(`dock queue lock failed: ${error.message}`)
            return (data ?? []).length === 1
        },
        async updateQueueRow(id, patch) {
            const { last_error, sent_at, ...rest } = patch
            const row: Record<string, unknown> = { ...rest }
            if (last_error !== undefined) row.last_error = last_error
            if (sent_at !== undefined) row.sent_at = sent_at
            const { error } = await db().from('dock_outbound').update(row).eq('id', id)
            if (error) throw new Error(`dock queue update failed: ${error.message}`)
        },
    }
}
