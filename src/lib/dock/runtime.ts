/**
 * Production wiring for the Dock connector: config from env, and deps bound to the Supabase store.
 * Env: DOCK_BASE_URL (default https://dock-harness.vercel.app, https only except localhost),
 *      DINGHY_DOCK_WEBHOOK_SECRET (shared with Dock; the webhook refuses to serve without it).
 */

import { enqueueOutbox } from '@/lib/spectrum/outbox'
import { hasPendingAction } from '@/lib/spectrum/actions'
import { toPlainText } from '@/lib/spectrum/plain-text'
import { supabaseDockStore } from './store'
import { DEFAULT_DOCK_BASE_URL, type DockDeps } from './service'

export function dockBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
    const raw = (env.DOCK_BASE_URL ?? DEFAULT_DOCK_BASE_URL).trim().replace(/\/+$/, '')
    const url = new URL(raw)
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
        throw new Error('DOCK_BASE_URL must be https')
    }
    return url.origin
}

export function dockWebhookSecret(env: NodeJS.ProcessEnv = process.env): string | undefined {
    const s = (env.DINGHY_DOCK_WEBHOOK_SECRET ?? '').trim()
    return s || undefined
}

/** Deps for a live request or the sweep. `send` queues through the outbox, which the sweep delivers. */
export function dockDepsViaOutbox(): DockDeps {
    return {
        store: supabaseDockStore(),
        baseUrl: dockBaseUrl(),
        send: async (chatGuid, text) => {
            await enqueueOutbox(chatGuid, 'reply', toPlainText(text))
        },
        hasOwnPending: (chatGuid) => hasPendingAction(chatGuid),
    }
}

export function dockDepsWithSend(send: DockDeps['send']): DockDeps {
    return { ...dockDepsViaOutbox(), send }
}
