/**
 * Photon 2.0 -> Dinghy transport adapter.
 *
 * Normalizes a v2 `message.received` webhook event into the exact
 * InboundSpace / InboundMessage shapes src/lib/spectrum/handler.ts already
 * consumes, so the whole Dinghy brain (history, memory, tools, outbox,
 * tapbacks, files) runs unchanged over the v2 API. The synthetic chat_guid
 * is `v2;<platform>;<spaceId>`; persistence, rate limits and the outbox key
 * off it exactly like an Apple chat GUID.
 *
 * Outbound, the adapter's space.send() understands everything the handler
 * throws at the legacy SDK: plain strings, spectrum-ts content builders
 * ({build}), and resolved content (typing, attachment, contact). Contact
 * cards (v2 has no vCard content type) go out as a text/vcard attachment.
 */

import { randomUUID } from 'node:crypto'
import type { InboundMessage, InboundSpace } from '@/lib/spectrum/handler'
import type { InboundAttachmentContent } from '@/lib/spectrum/attachments'
import { getPhotonV2Config, type PhotonV2Config } from './config'
import { getAttachmentBytes, getAttachmentMeta, getMessage, sendMessage, setTyping, uploadAttachment } from './client'
import { upsertV2ChatBinding, v2ChatGuid } from './store'

interface V2UserSnapshot {
    id?: string
    kind?: string
    handle?: string
    platform?: string
}

interface V2Content {
    type?: string
    format?: string
    text?: string
    attachmentId?: string
    parts?: V2Content[]
    reaction?: string
    action?: string
}

interface V2EventMessage {
    id?: string
    platform?: string
    status?: string
    parentMessageId?: string
    content?: V2Content
    sentBy?: V2UserSnapshot
    receivedBy?: V2UserSnapshot
    space?: { id?: string; platform?: string; kind?: string }
    createdAt?: string
}

export interface V2MessageReceivedEvent {
    id?: string
    type?: string
    apiVersion?: string
    timestamp?: string
    data?: { projectId?: string; object?: V2EventMessage }
}

/** spectrum-ts content builders resolve through {build}. */
type Builder = { build: () => Promise<Record<string, unknown>> }
function isBuilder(x: unknown): x is Builder {
    return typeof x === 'object' && x !== null && typeof (x as Builder).build === 'function'
}

/** Build a vCard payload from a resolved spectrum-ts contact content. */
function contactToVCard(c: Record<string, unknown>): Buffer {
    const name = (c.name as { formatted?: string; first?: string } | undefined) ?? {}
    const phones = Array.isArray(c.phones) ? (c.phones as { value?: string; type?: string }[]) : []
    const urls = Array.isArray(c.urls) ? (c.urls as string[]) : []
    const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${name.formatted ?? name.first ?? 'Dinghy'}`]
    for (const p of phones) if (p.value) lines.push(`TEL;TYPE=${(p.type ?? 'mobile').toUpperCase()}:${p.value}`)
    for (const u of urls) lines.push(`URL:${u}`)
    lines.push('END:VCARD')
    return Buffer.from(lines.join('\r\n'))
}

export interface V2AdapterDeps {
    cfg?: PhotonV2Config
    /** Test hook: capture sends instead of hitting the API. */
    capture?: (call: { method: string; args: Record<string, unknown> }) => void
}

/**
 * The outbound side: an InboundSpace whose send() maps legacy shapes onto
 * v2 REST calls. Never throws into the reply path semantics the handler
 * expects: a failed send rejects, and the handler's outbox records it.
 */
export function v2SpaceFor(spaceId: string, agentUserId: string, platform: string, deps: V2AdapterDeps = {}): InboundSpace {
    const cfg = deps.cfg ?? (deps.capture ? ({} as PhotonV2Config) : getPhotonV2Config())
    const chatGuid = v2ChatGuid(platform, spaceId)
    const sendContent = async (content: Record<string, unknown>, parentMessageId?: string): Promise<unknown> => {
        const type = content.type
        if (type === 'typing') {
            if (deps.capture) return deps.capture({ method: 'setTyping', args: { on: content.state !== 'stop' } })
            return setTyping(cfg, spaceId, agentUserId, content.state !== 'stop')
        }
        if (type === 'attachment') {
            const name = String(content.name ?? 'file')
            const mimeType = String(content.mimeType ?? 'application/octet-stream')
            const read = content.read as (() => Promise<Buffer>) | undefined
            if (!read) throw new Error('v2 attachment send: content has no read()')
            const bytes = await read()
            if (deps.capture) return deps.capture({ method: 'sendAttachment', args: { name, mimeType, size: bytes.length } })
            const up = await uploadAttachment(cfg, { name, mimeType, bytes, idempotencyKey: `v2up:${chatGuid}:${randomUUID()}` })
            return sendMessage(cfg, {
                spaceId, senderId: agentUserId, parentMessageId,
                content: { type: 'attachment', attachmentId: up.id },
                idempotencyKey: `v2att:${chatGuid}:${up.id}`,
            })
        }
        if (type === 'contact') {
            // v2 has no vCard content type: send the card as a file.
            const bytes = contactToVCard(content)
            if (deps.capture) return deps.capture({ method: 'sendContact', args: { size: bytes.length } })
            const up = await uploadAttachment(cfg, { name: 'contact.vcf', mimeType: 'text/vcard', bytes, idempotencyKey: `v2up:${chatGuid}:${randomUUID()}` })
            return sendMessage(cfg, {
                spaceId, senderId: agentUserId, parentMessageId,
                content: { type: 'attachment', attachmentId: up.id },
                idempotencyKey: `v2vcf:${chatGuid}:${up.id}`,
            })
        }
        if (type === 'reaction') {
            const emoji = String(content.reaction ?? content.emoji ?? '')
            if (!emoji || !parentMessageId) throw new Error('v2 reaction send: missing emoji or target')
            if (deps.capture) return deps.capture({ method: 'sendReaction', args: { emoji, parentMessageId } })
            return sendMessage(cfg, {
                spaceId, senderId: agentUserId, parentMessageId,
                content: { type: 'reaction', reaction: emoji, action: 'add' },
                idempotencyKey: `v2react:${chatGuid}:${parentMessageId}:${emoji}`,
            })
        }
        throw new Error(`v2 send: unsupported content type ${String(type)}`)
    }

    const send = async (input: unknown): Promise<unknown> => {
        if (typeof input === 'string') {
            if (deps.capture) return deps.capture({ method: 'sendText', args: { text: input } })
            return sendMessage(cfg, {
                spaceId, senderId: agentUserId,
                content: { type: 'text', format: 'plain', text: input },
                idempotencyKey: `v2txt:${chatGuid}:${randomUUID()}`,
            })
        }
        const resolved = isBuilder(input) ? await input.build() : (input as Record<string, unknown>)
        return sendContent(resolved)
    }

    return { id: chatGuid, send: send as InboundSpace['send'] }
}

/** message.react / message.reply bound to the inbound message id. */
function bindMessageFns(messageId: string | undefined, space: InboundSpace, deps: V2AdapterDeps): Pick<InboundMessage, 'react' | 'reply'> {
    if (!messageId) return {}
    const platform = (space.id ?? 'v2;imessage;').split(';')[1]!
    const spaceId = (space.id ?? '').split(';')[2]!
    const cfg = deps.cfg ?? (deps.capture ? ({} as PhotonV2Config) : getPhotonV2Config())
    const senderIdFor = async (): Promise<string> => agentSenderFor(spaceId, platform)
    return {
        react: async (emoji: string) => {
            const senderId = await senderIdFor()
            if (deps.capture) return deps.capture({ method: 'sendReaction', args: { emoji, parentMessageId: messageId } })
            return sendMessage(cfg, {
                spaceId, senderId,
                content: { type: 'reaction', reaction: emoji, action: 'add' },
                parentMessageId: messageId,
                idempotencyKey: `v2react:${space.id}:${messageId}:${emoji}`,
            })
        },
        reply: async (content: unknown) => {
            if (typeof content === 'string') {
                const senderId = await senderIdFor()
                if (deps.capture) return deps.capture({ method: 'sendText', args: { text: content, parentMessageId: messageId } })
                return sendMessage(cfg, {
                    spaceId, senderId,
                    content: { type: 'text', format: 'plain', text: content },
                    parentMessageId: messageId,
                    idempotencyKey: `v2rpl:${space.id}:${messageId}:${randomUUID()}`,
                })
            }
            const resolved = isBuilder(content) ? await content.build() : content
            return (space as InboundSpace & { send(c: unknown): Promise<unknown> }).send(resolved)
        },
    }
}

// The agent sender id for a space is learned from inbound receivedBy.id and
// stashed in the binding row; module cache covers the hot path.
const agentSenderCache = new Map<string, string>()
export function noteAgentSender(spaceId: string, agentUserId: string): void {
    agentSenderCache.set(spaceId, agentUserId)
}
async function agentSenderFor(spaceId: string, platform: string): Promise<string> {
    const cached = agentSenderCache.get(spaceId)
    if (cached) return cached
    const { loadV2ChatBinding } = await import('./store')
    const binding = await loadV2ChatBinding(v2ChatGuid(platform, spaceId))
    if (!binding) throw new Error(`v2 send: no agent sender known for ${spaceId} yet`)
    noteAgentSender(spaceId, binding.agent_user_id)
    return binding.agent_user_id
}

/** Inbound attachment content: metadata up front (attachments.ts classifies
 *  on name/mimeType), bytes lazily over the v2 download endpoint. */
function v2InboundAttachment(
    cfg: PhotonV2Config,
    attachmentId: string,
    meta: { name?: string; mimeType?: string; size?: number }
): InboundAttachmentContent & { type: 'attachment' } {
    return {
        type: 'attachment',
        name: meta.name,
        mimeType: meta.mimeType,
        size: meta.size,
        read: async () => getAttachmentBytes(cfg, attachmentId),
    } as InboundAttachmentContent & { type: 'attachment' }
}

/**
 * Normalize a v2 message.received event. Returns null for anything the
 * handler should not see: non-received statuses, our own outbound echoes,
 * non-text/non-attachment system content (read receipts, typing updates).
 */
export async function inboundFromV2Event(event: V2MessageReceivedEvent, deps: V2AdapterDeps = {}): Promise<{ space: InboundSpace; message: InboundMessage } | null> {
    if (event.type !== 'message.received') return null
    const msg = event.data?.object
    if (!msg?.id || msg.status !== 'received') return null
    const spaceId = msg.space?.id
    const platform = msg.platform ?? msg.space?.platform ?? 'imessage'
    const agentId = msg.receivedBy?.id
    if (!spaceId || !agentId) return null
    // Echo guard: only human-authored messages reach the brain.
    if (msg.sentBy?.kind !== 'human') return null

    const cfg = deps.cfg ?? (deps.capture ? ({} as PhotonV2Config) : getPhotonV2Config())
    const chatGuid = v2ChatGuid(platform, spaceId)
    noteAgentSender(spaceId, agentId)
    // capture = test harness: skip persistence entirely.
    if (!deps.capture) await upsertV2ChatBinding({
        chat_guid: chatGuid,
        space_id: spaceId,
        platform,
        agent_user_id: agentId,
        peer_handle: msg.sentBy?.handle ?? null,
    })

    // Content normalization into the legacy MessageLike shape.
    let content: Record<string, unknown> | null = null
    const c = msg.content ?? {}
    if (c.type === 'text' && typeof c.text === 'string') {
        if (msg.parentMessageId) {
            // Threaded reply: legacy shape unwraps target text for context.
            let targetText = ''
            try {
                if (deps.capture) throw new Error('capture mode')
                const parent = await getMessage(cfg, msg.parentMessageId)
                targetText = parent.content?.type === 'text' ? parent.content.text ?? '' : ''
            } catch { /* context is best-effort */ }
            content = {
                type: 'reply',
                content: { type: 'text', text: c.text },
                target: { id: msg.parentMessageId, direction: 'outbound', content: targetText ? { type: 'text', text: targetText } : undefined },
            }
        } else {
            content = { type: 'text', text: c.text }
        }
    } else if (c.type === 'attachment' && typeof c.attachmentId === 'string') {
        let meta: { name?: string; mimeType?: string; size?: number } = {}
        try {
            meta = await getAttachmentMeta(cfg, c.attachmentId)
        } catch { /* classify as other; read() still works */ }
        content = v2InboundAttachment(cfg, c.attachmentId, meta)
    } else if (c.type === 'reaction' && typeof c.reaction === 'string') {
        content = { type: 'reaction', emoji: c.reaction, target: { id: msg.parentMessageId, content: undefined } }
    } else {
        return null
    }

    const space = v2SpaceFor(spaceId, agentId, platform, deps)
    const message: InboundMessage = {
        id: msg.id,
        direction: 'inbound',
        content: content as InboundMessage['content'],
        sender: { id: msg.sentBy?.id, handle: msg.sentBy?.handle },
        timestamp: msg.createdAt ?? event.timestamp,
        ...bindMessageFns(msg.id, space, deps),
    }
    return { space, message }
      }
