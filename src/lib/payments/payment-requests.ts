import { createServerClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

// Server-side record of every card Dinghy requests through
// paybox_request_payment. The checkout loop (tools/paybox-checkout.ts) uses
// this — never the model's word — to verify that a request_id is one Dinghy
// issued and to recover the merchant origin the one-time card is bound to.
// No card details are ever stored.

export type PaymentRequestStatus =
  | 'issued'
  | 'approved'
  | 'claimed'
  | 'completed'
  | 'failed'
  | 'denied'

export interface PaymentRequestRecord {
  request_id: string
  user_id: string
  credential_id: string
  merchant: string
  merchant_url: string
  amount_cents: number
  currency: string
  status: PaymentRequestStatus
}

type Supabase = ReturnType<typeof createServerClient>

/** Persist a freshly-issued request. Throws — a request we cannot record is
 * one the checkout loop must refuse later, so the caller logs loudly. */
export async function recordPaymentRequest(
  rec: PaymentRequestRecord,
  supabase: Supabase = createServerClient()
): Promise<void> {
  const { error } = await supabase.from('paybox_payment_requests').upsert(
    {
      request_id: rec.request_id,
      user_id: rec.user_id,
      credential_id: rec.credential_id,
      merchant: rec.merchant,
      merchant_url: rec.merchant_url,
      amount_cents: rec.amount_cents,
      currency: rec.currency,
      status: rec.status,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'request_id' }
  )
  if (error) throw new Error(`Failed to record payment request: ${error.message}`)
}

export async function getPaymentRequest(
  userId: string,
  requestId: string,
  supabase: Supabase = createServerClient()
): Promise<PaymentRequestRecord | null> {
  const { data, error } = await supabase
    .from('paybox_payment_requests')
    .select('request_id, user_id, credential_id, merchant, merchant_url, amount_cents, currency, status')
    .eq('user_id', userId)
    .eq('request_id', requestId)
    .maybeSingle()
  if (error) throw new Error(`Failed to load payment request: ${error.message}`)
  return (data as PaymentRequestRecord | null) ?? null
}

/** Best-effort status move; a stale status must never break a checkout. */
export async function setPaymentRequestStatus(
  userId: string,
  requestId: string,
  status: PaymentRequestStatus,
  supabase: Supabase = createServerClient()
): Promise<void> {
  const { error } = await supabase
    .from('paybox_payment_requests')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('request_id', requestId)
  if (error) {
    logger.warn('payment request status update failed', { requestId, status, error: error.message })
  }
}
