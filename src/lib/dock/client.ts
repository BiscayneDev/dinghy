/**
 * HTTP client for Dock's connector endpoints. Dinghy calls Dock with the connector token (Bearer).
 *
 * Contract (Dock side must provide these; see docs/dock-connector.md):
 *   POST {base}/api/connector/pair                       {code, link_ref}          -> 200 {connector_token, workspace_id, chief_name}
 *   POST {base}/api/connector/unlink                     (bearer)                  -> 200
 *   POST {base}/api/connector/runs                       (bearer) {agent, message, client_message_id} -> 201 {run_id, agent_name}
 *   POST {base}/api/connector/approvals/{id}/decision    (bearer) {decision, expected_details_hash}   -> 200 {status}
 *
 * Status mapping: 404 not_found, 409 conflict, 410 expired, 422 changed, 401/403 unauthorized,
 * 5xx and network errors unreachable (queued and retried), any other 4xx rejected (not retried).
 */

export type DockFailure = 'unreachable' | 'unauthorized' | 'not_found' | 'conflict' | 'expired' | 'changed' | 'rejected'

export type DockResult<T> = { ok: true; data: T } | { ok: false; kind: DockFailure; status?: number }

const TIMEOUT_MS = 10_000

export function mapStatus(status: number): DockFailure {
    if (status === 401 || status === 403) return 'unauthorized'
    if (status === 404) return 'not_found'
    if (status === 409) return 'conflict'
    if (status === 410) return 'expired'
    if (status === 422) return 'changed'
    if (status >= 500) return 'unreachable'
    return 'rejected'
}

export async function dockRequest<T>(
    baseUrl: string,
    path: string,
    body: unknown,
    token: string | null,
    fetchImpl: typeof fetch = fetch
): Promise<DockResult<T>> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
        const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' }
        if (token) headers.authorization = `Bearer ${token}`
        const res = await fetchImpl(new URL(path, baseUrl).toString(), {
            method: 'POST',
            headers,
            body: JSON.stringify(body ?? {}),
            signal: controller.signal,
            redirect: 'error',
        })
        if (!res.ok) return { ok: false, kind: mapStatus(res.status), status: res.status }
        const data = (await res.json().catch(() => ({}))) as T
        return { ok: true, data }
    } catch {
        // Network failure or timeout. The message text is not kept: it can include the URL and headers.
        return { ok: false, kind: 'unreachable' }
    } finally {
        clearTimeout(timer)
    }
}

export interface PairResponse {
    connector_token: string
    workspace_id: string
    chief_name: string
}

export const dockApi = {
    pair: (baseUrl: string, code: string, linkRef: string, f?: typeof fetch) =>
        dockRequest<PairResponse>(baseUrl, '/api/connector/pair', { code, link_ref: linkRef }, null, f),
    unlink: (baseUrl: string, token: string, f?: typeof fetch) =>
        dockRequest<{ ok?: boolean }>(baseUrl, '/api/connector/unlink', {}, token, f),
    submitRun: (baseUrl: string, token: string, agent: string, message: string, clientMessageId: string, f?: typeof fetch) =>
        dockRequest<{ run_id: string; agent_name: string }>(
            baseUrl,
            '/api/connector/runs',
            { agent, message, client_message_id: clientMessageId },
            token,
            f
        ),
    decideApproval: (
        baseUrl: string,
        token: string,
        approvalId: string,
        decision: 'approve' | 'reject',
        expectedDetailsHash: string,
        f?: typeof fetch
    ) =>
        dockRequest<{ status: string }>(
            baseUrl,
            `/api/connector/approvals/${encodeURIComponent(approvalId)}/decision`,
            { decision, expected_details_hash: expectedDetailsHash },
            token,
            f
        ),
}
