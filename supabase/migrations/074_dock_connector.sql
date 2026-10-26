-- Dinghy <-> Dock connector (P3). Idempotent: safe to re-run.
--
-- Invariants:
--   * A Dock link belongs to one Dinghy chat (chat_guid). The Dock connector token is stored encrypted
--     (encryptTokenForDb, AES-256-GCM, ENCRYPTION_KEY). Plaintext never reaches the database.
--   * A pairing code is single use on the Dinghy side too: only its sha256 is stored (dock_pair_codes, PK).
--   * An approval is resolved once: resolveApproval() flips status from 'pending' or 'decision_queued' only.
--   * Webhook events are deduped on event_id (dock_events) so a replayed signed request is a no-op.
--   * Outbound Dock requests are ordered per chat (dock_outbound) and replayed by the sweep.
--   * Dinghy never initiates money actions. dock_outbound.kind has no spend or payout value.
--   * Tables are service-role only except the owner read policies on dock_links and dock_approvals.

begin;

create table if not exists public.dock_links (
  chat_guid text primary key check (char_length(chat_guid) between 1 and 300),
  user_id uuid references auth.users(id) on delete cascade,
  link_ref text not null unique check (char_length(link_ref) between 16 and 80),
  dock_base_url text not null check (char_length(dock_base_url) <= 300),
  workspace_ref text not null check (char_length(workspace_ref) between 1 and 80),
  chief_name text not null check (char_length(chief_name) between 1 and 40),
  pending_chief_name text check (pending_chief_name is null or char_length(pending_chief_name) between 1 and 40),
  token_ciphertext text not null check (char_length(token_ciphertext) <= 2000),
  status text not null default 'linked' check (status in ('linked', 'unlinked')),
  linked_at timestamptz not null default now(),
  unlinked_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.dock_pair_codes (
  code_hash text primary key check (char_length(code_hash) = 64),
  chat_guid text not null,
  used_at timestamptz not null default now()
);

create table if not exists public.dock_approvals (
  id text primary key check (char_length(id) between 1 and 80),
  chat_guid text not null references public.dock_links(chat_guid) on delete cascade,
  label text not null check (char_length(label) between 1 and 80),
  action text not null check (char_length(action) between 1 and 300),
  amount_text text check (amount_text is null or char_length(amount_text) <= 80),
  destination text check (destination is null or char_length(destination) <= 200),
  details_hash text not null check (char_length(details_hash) between 16 and 128),
  shown_hash text check (shown_hash is null or char_length(shown_hash) between 16 and 128),
  card_url text check (card_url is null or char_length(card_url) <= 500),
  status text not null default 'pending' check (
    status in ('pending', 'decision_queued', 'approved', 'rejected', 'expired', 'superseded', 'failed', 'closed')
  ),
  decision text check (decision is null or decision in ('approve', 'reject')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists dock_approvals_chat_status_idx on public.dock_approvals (chat_guid, status);

create table if not exists public.dock_events (
  event_id text primary key check (char_length(event_id) between 1 and 120),
  received_at timestamptz not null default now()
);

create table if not exists public.dock_outbound (
  id uuid primary key default gen_random_uuid(),
  chat_guid text not null references public.dock_links(chat_guid) on delete cascade,
  kind text not null check (kind in ('run', 'approval_decision')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'dropped')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists dock_outbound_queued_idx on public.dock_outbound (chat_guid, created_at) where status = 'queued';

alter table public.dock_links enable row level security;
alter table public.dock_pair_codes enable row level security;
alter table public.dock_approvals enable row level security;
alter table public.dock_events enable row level security;
alter table public.dock_outbound enable row level security;

-- Owner-only reads. The Dinghy app writes through the service role.
drop policy if exists dock_links_select_owner on public.dock_links;
create policy dock_links_select_owner on public.dock_links for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists dock_approvals_select_owner on public.dock_approvals;
create policy dock_approvals_select_owner on public.dock_approvals for select to authenticated
  using (chat_guid in (select l.chat_guid from public.dock_links l where l.user_id = (select auth.uid())));

commit;

notify pgrst, 'reload schema';

-- Supabase default-privileges change enforced 2026-10-30: explicit least-privilege grants so
-- this migration still works when applied or replayed after automatic Data API grants stop.
-- Privileges mirror the verified callers in src/lib/dock/store.ts (service role only;
-- dock_links unlink is a soft update, so no delete needed there).
grant select, insert, update on public.dock_links to service_role;
grant insert, delete on public.dock_pair_codes to service_role;
grant select, insert, update on public.dock_approvals to service_role;
grant insert on public.dock_events to service_role;
grant select, insert, update on public.dock_outbound to service_role;
