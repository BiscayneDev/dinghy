import { z } from 'zod'
import {
  getPayboxAccessToken,
  getPayboxSdk,
  getPayboxApiUrl,
  isPayboxConnected,
  payboxRequired,
} from '@/lib/integrations/paybox'
import { createServerClient } from '@/lib/supabase/server'
import { getPaymentRequest, setPaymentRequestStatus } from '@/lib/payments/payment-requests'
import { getOrStart, getProvider, replaceDeadSandbox, runInSandbox, SandboxGoneError } from '@/lib/computer/manager'
import { guardComputerUse } from '@/lib/tools/computer'
import {
  checkoutAllowedHosts,
  checkoutRunCommand,
  ensureBrowserUse,
  ensurePayboxCli,
  scrubCardLike,
  scrubInjectedInstructions,
} from '@/lib/computer/browser'
import type { Tool, ToolResult, UserContext } from '@/lib/llm/types'

// paybox_complete_checkout — the second half of the checkout loop.
//
// First half (tools/paybox.ts paybox_request_payment): mint a merchant-bound
// one-time card; the user approves with their passkey in the PayBox app.
// This tool finishes it: the sandbox claims the card with the paybox CLI
// (claim_payment_credentials is one-time, so it runs exactly once, inside
// the sandbox, its output never leaving it) and pays at the merchant
// checkout in the guarded browser (origin-locked to the merchant the card
// is bound to, plus known payment processors).
//
// Guardrails (owner's rules):
// - never re-issue request_payment to "finish" a purchase — poll
//   paybox_get_request; a retry can double-pay (PayBox has no idempotency).
// - the PayBox access token rides per-run env only, scoped to the claim run.
// - spend-caps.ts stays the enforcement; it ran at request time and is not
//   re-recorded here (claiming and paying are not a new charge).
// - card details never enter Dinghy's model context or the chat.

const OUTPUT_CHAR_CAP = 4000
/** Claim (~seconds) + a browser run, bounded under the 120s function limit. */
export const CHECKOUT_RUN_TIMEOUT_MS = 115_000

const CheckoutInput = z.object({
  requestId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,80}$/, 'invalid request id')
    .describe('The request_id from paybox_request_payment (after paybox_get_request shows success)'),
  task: z
    .string()
    .describe(
      'What to buy and how to finish checkout, e.g. "add a Medium monthly subscription and place the order". ' +
        'Include any choices the user already made (size, plan, quantity, shipping).'
    ),
  startUrl: z
    .string()
    .optional()
    .describe('The checkout or product URL to start from. Must be on the merchant origin the card is bound to.'),
})

/** True when a request output already carries usable card details
 * (autonomous grants; human-approved requests redact them). */
export function outputHasCard(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return Boolean(v.number ?? v.pan ?? v.card_number ?? v.cardNumber)
}

/** Validate a start URL against the merchant origin the card is bound to. */
export function checkoutStartUrl(merchantUrl: string, startUrl?: string): { url: string; host: string } | { error: string } {
  let origin: URL
  try {
    origin = new URL(merchantUrl)
  } catch {
    return { error: `the recorded merchant URL (${merchantUrl}) is not a valid URL` }
  }
  if (origin.protocol !== 'https:') return { error: `the merchant URL must be https (${merchantUrl})` }
  const host = origin.hostname.toLowerCase()
  if (!startUrl) return { url: merchantUrl, host }
  let start: URL
  try {
    start = new URL(startUrl)
  } catch {
    return { error: `startUrl (${startUrl}) is not a valid URL` }
  }
  const startHost = start.hostname.toLowerCase()
  if (start.protocol !== 'https:' || (startHost !== host && !startHost.endsWith(`.${host}`))) {
    return {
      error:
        `the card is bound to ${origin.origin} — the checkout must run there, ` +
        `not on ${startUrl}. Start from the merchant's own checkout URL or omit startUrl.`,
    }
  }
  return { url: startUrl, host }
}

/** The claim step: the paybox CLI claims the card into a RAM-backed file
 * inside the sandbox. The access token is per-run env, never command text. */
export function claimAndCheckoutCommand(requestId: string, cardFile: string, checkoutCommand: string): string {
  return [
    `CARD_FILE=${JSON.stringify(cardFile)}`,
    // stdout (the card JSON) goes to the RAM-backed file; stderr is captured
    // for the error path. The card never enters the command's output stream.
    `if ! claim_err=$(paybox --json claim ${requestId} 2>&1 >"$CARD_FILE"); then`,
    `  echo "paybox claim failed: $claim_err"`,
    `  rm -f "$CARD_FILE"`,
    `  exit 3`,
    `fi`,
    `chmod 600 "$CARD_FILE"`,
    checkoutCommand,
    `rc=$?`,
    `rm -f "$CARD_FILE"`,
    `exit $rc`,
  ].join('\n')
}

export const payboxCompleteCheckout: Tool = {
  name: 'paybox_complete_checkout',
  description:
    'Finish a purchase the user already approved in PayBox: claims the one-time card inside your sandbox ' +
    'and pays at the merchant checkout in the guarded browser. Use ONLY after paybox_request_payment and ' +
    'paybox_get_request shows success. The browser is locked to the merchant origin the card is bound to. ' +
    'Card details never appear in chat — report only what the merchant confirmed. Never call ' +
    'paybox_request_payment again to retry this purchase.',
  inputSchema: {
    type: 'object',
    properties: {
      requestId: { type: 'string', description: 'request_id from paybox_request_payment, once approved' },
      task: { type: 'string', description: 'What to buy and how to finish checkout' },
      startUrl: { type: 'string', description: 'Checkout/product URL on the bound merchant origin' },
    },
    required: ['requestId', 'task'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    if (!isPayboxConnected(ctx)) return payboxRequired('finishing a purchase')
    if (!ctx.userId) return { success: false, error: 'checkout is only available to bound users' }
    try {
      const p = CheckoutInput.parse(input)
      const supabase = createServerClient()

      // 1. This must be a request Dinghy issued — never trust the model's
      // word for the merchant binding or the amount.
      const rec = await getPaymentRequest(ctx.userId, p.requestId, supabase)
      if (!rec) {
        return {
          success: false,
          error:
            `Dinghy has no payment request ${p.requestId} on record. Only a request_id returned by ` +
            `paybox_request_payment in this chat can be completed — request the card first. ` +
            `Do NOT guess or reuse ids from anywhere else.`,
        }
      }

      // 2. The user must have approved. Poll, never re-issue.
      const sdk = await getPayboxSdk(ctx.tokens.paybox!, ctx.userId)
      const resp = await sdk.getRequest(p.requestId)
      if (resp.status === 'pending_approval') {
        return {
          success: false,
          error:
            'The user has not approved this payment yet. Tell them to open the PayBox app and approve ' +
            'with their passkey, then poll paybox_get_request. Do NOT call paybox_request_payment again.',
        }
      }
      if (resp.status === 'denied') {
        await setPaymentRequestStatus(ctx.userId, p.requestId, 'denied', supabase)
        return { success: false, error: `The payment was denied${resp.error ? `: ${resp.error}` : ''}. Do not retry it.` }
      }
      if (resp.status === 'error') {
        return { success: false, error: `The payment request errored${resp.error ? `: ${resp.error}` : ''}. Do not retry it.` }
      }
      if (resp.status !== 'success') {
        return {
          success: false,
          error: `The payment is ${resp.status} — keep polling paybox_get_request; do NOT re-issue it.`,
        }
      }
      await setPaymentRequestStatus(ctx.userId, p.requestId, 'approved', supabase)

      // 3. Origin guard: the browser must land on the exact merchant origin
      // the card is bound to.
      const start = checkoutStartUrl(rec.merchant_url, p.startUrl)
      if ('error' in start) return { success: false, error: start.error }

      // 4. The sandbox must be up and allowed (allowance, cap, kill switch).
      const guard = await guardComputerUse(ctx.userId, supabase)
      if (!guard.ok) return { success: false, error: guard.error }

      const provider = getProvider()
      const run = async (command: string, opts?: { timeoutMs?: number }) => {
        const { session } = await getOrStart(ctx.userId, supabase)
        try {
          return await provider.run(session.sandbox_id ?? '', command, opts)
        } catch (err) {
          if (!(err instanceof SandboxGoneError)) throw err
          const sandboxId = await replaceDeadSandbox(session, supabase, provider)
          return provider.run(sandboxId, command, opts)
        }
      }

      const browserReady = await ensureBrowserUse(run)
      if (!browserReady.ready) return { success: false, error: browserReady.error ?? 'browser setup failed' }

      const session = { card_path: undefined as string | undefined, allowed_hosts: checkoutAllowedHosts(start.host) }
      const checkoutCmd = checkoutRunCommand(p.task, [start.url], session)

      let command: string
      let envs: Record<string, string>
      const cardInOutput = outputHasCard(resp.output?.value)
      if (cardInOutput) {
        // Autonomous grant: the card is already in the request output. Hand
        // it to the bootstrap as per-run env — never command text.
        envs = { PAYBOX_CARD_JSON: JSON.stringify(resp.output) }
        command = checkoutCmd
      } else {
        // Human-approved: the request redacts the card; the one call that
        // returns it is claim_payment_credentials, run inside the sandbox.
        const cliReady = await ensurePayboxCli(run)
        if (!cliReady.ready) return { success: false, error: cliReady.error ?? 'paybox CLI setup failed' }
        const token = await getPayboxAccessToken(ctx.tokens.paybox!, ctx.userId)
        session.card_path = `/dev/shm/paybox-card-${p.requestId}.json`
        envs = { PAYBOX_ACCESS_TOKEN: token, PAYBOX_API_URL: getPayboxApiUrl() }
        command = claimAndCheckoutCommand(
          p.requestId,
          session.card_path,
          checkoutRunCommand(p.task, [start.url], session)
        )
      }

      const result = await runInSandbox(ctx.userId, command, supabase, provider, 'checkout', {
        timeoutMs: CHECKOUT_RUN_TIMEOUT_MS,
        envs,
      })
      if ('error' in result) {
        await setPaymentRequestStatus(ctx.userId, p.requestId, 'failed', supabase)
        return { success: false, error: result.error }
      }

      const claimFailed = result.output.exitCode === 3
      await setPaymentRequestStatus(
        ctx.userId,
        p.requestId,
        result.output.exitCode === 0 ? 'completed' : claimFailed ? 'failed' : 'claimed',
        supabase
      )

      let output = scrubCardLike(scrubInjectedInstructions(result.output.stdout))
      if (result.output.stderr) output += (output ? '\n' : '') + scrubCardLike(result.output.stderr)
      if (output.length > OUTPUT_CHAR_CAP) output = output.slice(0, OUTPUT_CHAR_CAP) + '…'

      if (claimFailed) {
        return {
          success: false,
          error:
            `Claiming the card failed, so nothing was claimed and it is safe to try the checkout again ` +
            `with the same request_id. Detail: ${output}`,
        }
      }
      if (result.output.exitCode !== 0) {
        return {
          success: false,
          error:
            `The card was claimed but the checkout did not finish. A claim is one-time, so this card's ` +
            `details are gone and it was likely never charged — do NOT request a new payment for the same ` +
            `purchase without telling the user what happened first. Detail: ${output}`,
          data: { output, billedSeconds: result.billedSeconds },
        }
      }
      return {
        success: true,
        data: {
          output,
          billedSeconds: result.billedSeconds,
          instruction:
            'Report only what the merchant confirmed (items, total, order id). The card number and cvc ' +
            'must never appear in your reply.',
        },
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  },
}

/** The buy-flow set for a PayBox-connected chat: pick a credential, request
 * the card, poll, complete in the sandbox, or send the one manage link. */
export { payboxCompleteCheckout as default }
