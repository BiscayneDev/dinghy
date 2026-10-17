/**
 * Minimal Photon 2.0 REST client (api.photon.codes/v1) for the Dinghy
 * transport adapter. Only what the adapter uses: send text / reaction /
 * attachment, typing, attachment upload+download, message fetch.
 *
 * Every write takes an Idempotency-Key. Callers build keys from stable
 * identities (outbox row id, inbound message id) so a retried sweep or a
 * redelivered webhook never double-sends.
 */

import { getPhotonV2Config, type PhotonV2Config } from './config'

export class PhotonV2Error extends Error {
    constructor(
        public status: number,
        public code: string | undefined,
        message: string
    ) {
        super(message)
    }
}

async function request<T>(cfg: PhotonV2Config, method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${cfg.apiKey}` }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
    const res = await fetch(`${cfg.apiBase}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) {
        let code: string | undefined
        let title = res.statusText
        try {
            const problem = (await res.json()) as { code?: string; title?: string }
            code = problem.code
            title = problem.title ?? title
        } catch { /* non-JSON error body */ }
        throw new PhotonV2Error(res.status, code, `photon v2 ${method} ${path}: ${res.status} ${title}`)
    }
    return (await res.json()) as T
}

export interface V2SendContent {
    type: 'text' | 'reaction' | 'attachment'
    format?: string
    text?: string
    reaction?: string
    action?: 'add' | 'remove'
    attachmentId?: string
}

interface V2Message {
    id: string
    content?: { type?: string; text?: string }
    sentBy?: { id?: string; kind?: string; handle?: string }
    space?: { id?: string }
}

export async function sendMessage(
    cfg: PhotonV2Config,
    args: { spaceId: string; senderId: string; content: V2SendContent; parentMessageId?: string; idempotencyKey: string }
): Promise<{ id?: string }> {
    return request(cfg, 'POST', `/v1/projects/${cfg.projectId}/messages`, {
        spaceId: args.spaceId,
        senderId: args.senderId,
        content: args.content,
        ...(args.parentMessageId ? { parentMessageId: args.parentMessageId } : {}),
    }, args.idempotencyKey)
}

export async function setTyping(cfg: PhotonV2Config, spaceId: string, senderId: string, on: boolean): Promise<void> {
    await request(cfg, 'POST', `/v1/projects/${cfg.projectId}/spaces/${spaceId}/typing`, { senderId, typing: on })
}

export async function getMessage(cfg: PhotonV2Config, messageId: string): Promise<V2Message> {
    return request(cfg, 'GET', `/v1/projects/${cfg.projectId}/messages/${messageId}`)
}

export async function getAttachmentMeta(cfg: PhotonV2Config, attachmentId: string): Promise<{ name?: string; mimeType?: string; size?: number }> {
    return request(cfg, 'GET', `/v1/projects/${cfg.projectId}/attachments/${attachmentId}`)
}

/** Download attachment bytes. Not JSON: raw fetch with the bearer key. */
export async function getAttachmentBytes(cfg: PhotonV2Config, attachmentId: string): Promise<Buffer> {
    const res = await fetch(`${cfg.apiBase}/v1/projects/${cfg.projectId}/attachments/${attachmentId}/content`, {
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
    })
    if (!res.ok) throw new PhotonV2Error(res.status, undefined, `photon v2 attachment download: ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
}

/** Upload attachment bytes (multipart/related per the v2 OpenAPI). */
export async function uploadAttachment(
    cfg: PhotonV2Config,
    args: { name: string; mimeType: string; bytes: Buffer; idempotencyKey: string }
): Promise<{ id: string }> {
    const boundary = `dinghy-${Date.now().toString(36)}`
    const meta = JSON.stringify({ name: args.name, mimeType: args.mimeType })
    const head = Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${meta}\r\n` +
        `--${boundary}\r\nContent-Type: ${args.mimeType}\r\nContent-Disposition: attachment; filename="${args.name.replace(/"/g, '')}"\r\n\r\n`
    )
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
    const res = await fetch(`${cfg.apiBase}/v1/projects/${cfg.projectId}/attachments`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${cfg.apiKey}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
            'Idempotency-Key': args.idempotencyKey,
        },
        body: Buffer.concat([head, args.bytes, tail]),
    })
    if (!res.ok) throw new PhotonV2Error(res.status, undefined, `photon v2 attachment upload: ${res.status}`)
    const json = (await res.json()) as { id?: string; attachmentId?: string }
    const id = json.id ?? json.attachmentId
    if (!id) throw new PhotonV2Error(500, undefined, 'photon v2 attachment upload: no id in response')
    return { id }
}

export function configFromEnv(): PhotonV2Config {
    return getPhotonV2Config()
}
