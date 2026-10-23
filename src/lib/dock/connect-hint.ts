/**
 * Authenticated workspace hint for the web connect link.
 *
 * Dock builds the consent URL as /connect/dock?pair=<code>&w=<workspace>&sig=<hmac>, where sig is
 * HMAC-SHA256 of "<code>.<workspace>" under the webhook secret the two products already share. The
 * pair code alone tells Dinghy nothing about which workspace it belongs to (Dock reveals that only
 * at redemption), so an UNSIGNED hint would let anyone who holds a valid code claim it belongs to a
 * workspace the owner already trusts with "Always allow" - an auto-reconnect hijack. The signature
 * binds the hint to the shared secret, so auto-reconnect only triggers on a hint Dock itself made.
 *
 * The hint gates ONLY the auto-reconnect shortcut. The consent page renders fine without it, and
 * the workspace recorded on the link always comes from Dock's redemption response, never the hint.
 */

import { createHmac, timingSafeEqual } from 'crypto'

export function signConnectHint(secret: string, code: string, workspaceRef: string): string {
    return createHmac('sha256', secret).update(`${code}.${workspaceRef}`, 'utf8').digest('hex')
}

/** Constant-time check. Returns false for any malformed input. */
export function verifyConnectHint(secret: string, code: string, workspaceRef: string, sig: string): boolean {
    if (!/^[0-9a-f]{64}$/.test(sig)) return false
    const expected = Buffer.from(signConnectHint(secret, code, workspaceRef), 'utf8')
    const actual = Buffer.from(sig, 'utf8')
    return expected.length === actual.length && timingSafeEqual(expected, actual)
}
