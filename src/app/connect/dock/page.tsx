import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { safeNextPath } from '@/lib/auth/redirect'
import { consentNonce, resolveConnectIdentity } from '@/lib/dock/connect'
import { verifyConnectHint } from '@/lib/dock/connect-hint'
import { dockWebhookSecret } from '@/lib/dock/runtime'
import { supabaseDockStore } from '@/lib/dock/store'
import { PaperPage } from '@/components/brand/PaperPage'
import { DockConnectClient } from './DockConnectClient'

export const metadata: Metadata = {
    title: 'Connect Dock · Dinghy',
    robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

const CODE_RE = /^[A-Za-z0-9-]{6,20}$/

function formatPhone(p: string | null): string | null {
    if (!p) return null
    const m = p.match(/^\+1(\d{3})(\d{3})(\d{4})$/)
    return m ? `(${m[1]}) ${m[2]}-${m[3]}` : p
}

/**
 * Signed-in consent for a Dock connection, reached from the connect link Dock settings shows.
 * The URL carries the one-time pair code; a signed workspace hint (HMAC under the shared webhook
 * secret) is the only thing that unlocks the "Always allow" auto-reconnect. Everything else -
 * which thread gets linked, which workspace is recorded - comes from the session and from Dock's
 * redemption response, never from the URL.
 */
export default async function ConnectDockPage({
    searchParams,
}: {
    searchParams: Promise<{ pair?: string; w?: string; sig?: string }>
}): Promise<React.JSX.Element> {
    const sp = await searchParams
    const code = (sp.pair ?? '').trim().toUpperCase()
    const self = `/connect/dock?pair=${encodeURIComponent(code)}${sp.w ? `&w=${encodeURIComponent(sp.w)}` : ''}${sp.sig ? `&sig=${encodeURIComponent(sp.sig)}` : ''}`

    if (!CODE_RE.test(code)) {
        return (
            <PaperPage
                label="dinghy · connect"
                title="connect"
                accent="dock"
                body="This connect link is missing its pairing code."
                missing="Make a fresh connect link in Dock settings, or text pair followed by your code to Dinghy."
            />
        )
    }

    const session = await getSession()
    if (!session) redirect(`/login?next=${encodeURIComponent(self)}`)

    const identity = await resolveConnectIdentity(session.userId)
    if (!identity) {
        return (
            <PaperPage
                label="dinghy · connect"
                title="connect"
                accent="dock"
                body="This Dinghy account has no iMessage thread yet, so there is nowhere for Dock to reach you."
                missing="Text Dinghy first, sign in again, then reopen this link."
            />
        )
    }

    const store = supabaseDockStore()
    const existing = await store.getLinkByChat(identity.chatGuid)
    if (existing) {
        return (
            <PaperPage
                label="dinghy · connect"
                title="already"
                accent="connected"
                body={`Dock is already linked to this Dinghy thread. Your Chief of Staff is ${existing.chief_name}.`}
                fine="To connect a different Dock workspace, unlink first - in Dock settings or by texting &quot;unlink dock&quot; to Dinghy."
            />
        )
    }

    // Auto-reconnect only when the hint is signed by Dock and the owner previously chose
    // "Always allow" for exactly this workspace. Grants are deleted on every unlink path.
    let auto = false
    const secret = dockWebhookSecret()
    const hintWorkspace = (sp.w ?? '').trim()
    if (secret && hintWorkspace && sp.sig && verifyConnectHint(secret, code, hintWorkspace, sp.sig)) {
        const grant = await store.getGrant(identity.chatGuid, hintWorkspace)
        auto = Boolean(grant)
    }

    return (
        <PaperPage label="dinghy · connect" title="connect" accent="dock" body={null}>
            <DockConnectClient
                pair={code}
                nonce={consentNonce(session.userId, code)}
                auto={auto}
                phone={formatPhone(identity.phone)}
                switchHref={`/login?switch=1&next=${encodeURIComponent(safeNextPath(self) ?? '/connect/dock')}`}
            />
        </PaperPage>
    )
}
