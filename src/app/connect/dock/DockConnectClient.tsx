'use client'

import { useEffect, useRef, useState } from 'react'
import styles from './dock-connect.module.css'

type Outcome =
    | { kind: 'idle' }
    | { kind: 'busy' }
    | { kind: 'connected'; chief: string; automatic: boolean; grantFailed: boolean }
    | { kind: 'already' }
    | { kind: 'denied' }
    | { kind: 'error'; message: string }

/**
 * The consent card. Three honest choices about a STANDING link (both allow options keep Dock
 * connected until unlink; they differ only on reconnects):
 *   Always allow - reconnects to this same workspace without asking again.
 *   Connect once - if the link is ever lost, you will be asked again.
 *   Don't allow  - nothing is connected; the code stays unused.
 * With `auto` (verified Dock hint + existing Always-allow grant) the card resubmits "always" on
 * load instead of asking again. The POST is still a real browser POST from this page - link
 * previews and prefetches render but never decide.
 */
export function DockConnectClient({
    pair,
    nonce,
    auto,
    phone,
    switchHref,
}: {
    pair: string
    nonce: string
    auto: boolean
    phone: string | null
    switchHref: string
}): React.JSX.Element {
    const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' })
    const fired = useRef(false)

    async function decide(decision: 'once' | 'always' | 'deny') {
        setOutcome({ kind: 'busy' })
        try {
            const res = await fetch('/api/connect/dock/decide', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ pair, decision, nonce }),
            })
            const data = (await res.json().catch(() => ({}))) as { status?: string; chief?: string; error?: string; grant?: string }
            if (!res.ok) {
                setOutcome({ kind: 'error', message: data.error ?? 'Something went wrong. Try again in a moment.' })
                return
            }
            if (data.status === 'connected')
                setOutcome({ kind: 'connected', chief: data.chief ?? 'your Chief of Staff', automatic: auto, grantFailed: data.grant === 'failed' })
            else if (data.status === 'already') setOutcome({ kind: 'already' })
            else if (data.status === 'denied') setOutcome({ kind: 'denied' })
            else setOutcome({ kind: 'error', message: 'Something went wrong. Try again in a moment.' })
        } catch {
            setOutcome({ kind: 'error', message: 'No connection. Try again in a moment.' })
        }
    }

    useEffect(() => {
        if (auto && !fired.current) {
            fired.current = true
            void decide('always')
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [auto])

    if (outcome.kind === 'connected') {
        return (
            <div className={styles.result}>
                <p className={styles.resultTitle}>Dock is connected.</p>
                <p className={styles.resultBody}>
                    Your Chief of Staff is {outcome.chief}. Back in Dock, the settings card shows this thread as
                    connected.
                    {outcome.automatic ? ' This reconnected automatically because you chose Always allow for this workspace.' : ''}
                </p>
                {outcome.grantFailed ? (
                    <p className={styles.error}>
                        Connected, but Always allow could not be saved - if this link is ever lost, you&apos;ll be
                        asked again.
                    </p>
                ) : null}
                <p className={styles.fine}>
                    Unlink any time in Dock settings or by texting &quot;unlink dock&quot; to Dinghy.
                </p>
            </div>
        )
    }
    if (outcome.kind === 'already') {
        return (
            <div className={styles.result}>
                <p className={styles.resultTitle}>Already connected.</p>
                <p className={styles.resultBody}>This Dinghy thread is already linked to Dock. Nothing changed.</p>
            </div>
        )
    }
    if (outcome.kind === 'denied') {
        return (
            <div className={styles.result}>
                <p className={styles.resultTitle}>Nothing was connected.</p>
                <p className={styles.resultBody}>The pairing code was not used. Dock stays unlinked from your Dinghy.</p>
            </div>
        )
    }

    const busy = outcome.kind === 'busy'
    return (
        <div>
            <p className={styles.body}>
                <strong>Dock</strong> gets a standing link to this Dinghy thread: your Chief of Staff can text you
                here, and money approvals come here for your yes or no.
            </p>
            <p className={styles.body}>
                It stays connected until you unlink it. Dock can&apos;t read your other chats and never moves money
                on its own.
            </p>

            {auto && busy ? <p className={styles.note}>Reconnecting Dock - you chose Always allow for this workspace.</p> : null}
            {outcome.kind === 'error' ? <p className={styles.error}>{outcome.message}</p> : null}

            {!auto && (
                <>
                    <button className={styles.primary} type="button" disabled={busy} onClick={() => decide('always')}>
                        {busy ? 'connecting…' : 'Always allow'}
                    </button>
                    <button className={styles.secondary} type="button" disabled={busy} onClick={() => decide('once')}>
                        Connect once
                    </button>
                    <button className={styles.deny} type="button" disabled={busy} onClick={() => decide('deny')}>
                        Don&apos;t allow
                    </button>
                    <p className={styles.hint}>
                        Always allow reconnects this workspace without asking. Connect once asks again if the link is
                        ever lost.
                    </p>
                </>
            )}
            {auto && outcome.kind === 'error' ? (
                <button className={styles.secondary} type="button" onClick={() => decide('always')}>
                    Try again
                </button>
            ) : null}

            <p className={styles.signedIn}>
                Signed in as {phone ?? 'your Dinghy account'} · <a href={switchHref}>not you?</a>
            </p>
        </div>
    )
}
