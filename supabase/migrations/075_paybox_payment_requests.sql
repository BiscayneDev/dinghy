-- PayBox payment requests Dinghy issues (paybox_request_payment).
--
-- Dinghy records every card request at issue time so the checkout loop can
-- later verify, without trusting the model or the chat log:
--   * the request_id is one Dinghy issued (no completing arbitrary ids), and
--   * the browser lands on the exact merchant origin the one-time card is
--     bound to (cards are origin-bound by the issuer; the record is our copy
--     of that binding).
--
-- No card details are ever stored here. Service-role only, mirroring the
-- spend_events posture: the model-facing tools read and write through the
-- server client.

begin;

create table if not exists public.paybox_payment_requests (
  request_id text primary key check (char_length(request_id) between 1 and 80),
  user_id uuid not null references auth.users(id) on delete cascade,
  credential_id text not null check (char_length(credential_id) between 1 and 120),
  merchant text not null check (char_length(merchant) between 1 and 200),
  merchant_url text not null check (char_length(merchant_url) <= 400),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'USD' check (char_length(currency) = 3),
  status text not null default 'issued'
    check (status in ('issued', 'approved', 'claimed', 'completed', 'failed', 'denied')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists paybox_payment_requests_user_idx
  on public.paybox_payment_requests (user_id, created_at desc);

alter table public.paybox_payment_requests enable row level security;
-- No anon/authenticated policies: server-only access via the service role.

commit;
