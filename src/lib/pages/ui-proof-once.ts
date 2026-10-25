/** One controlled catalogue proof turn per sender.
 *
 * Purpose: exercise the real chooser selection (text / catalogue / generate) exactly once for a
 * listed sender while the rollout flag DINGHY_JEV_UI stays off, WITHOUT allowing novel generation:
 * in proof mode the generate route is forbidden at the mechanism level (the generation tool is
 * never added), so the controlled test cannot start generation spend no matter what the decision
 * returns.
 *
 * Consumption is durable and independent of the user's next reply: the caller supplies a one-use
 * claim (handler claims via the established claim_inbound_delivery RPC, same pattern as the
 * internal proof routes, with its own key - never a consumed proof token). Once claimed, the env
 * value is inert even if nobody removes it; before it fires, removing the env var is a complete
 * rollback. Nothing here touches billing or settlement.
 *
 * Proof is never global: 'on' is treated as off. Only an exact sender-handle allowlist applies. */
export const UI_PROOF_FLAG = 'DINGHY_JEV_UI_PROOF'

export function uiProofSender(sender?: string): boolean {
    const raw = process.env[UI_PROOF_FLAG] ?? ''
    if (!sender) return false
    if (raw === 'on') return false
    return raw.split(',').map((s) => s.trim()).filter(Boolean).includes(sender)
}
