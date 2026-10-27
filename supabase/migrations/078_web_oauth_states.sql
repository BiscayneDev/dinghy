-- Deploy before the corresponding web OAuth code. No browser role access.
create table public.web_oauth_states (
  state_hash text primary key,
  provider text not null check (provider in ('github', 'oura', 'whoop')),
  user_id uuid not null references public.users(id) on delete cascade,
  session_hash text not null,
  expires_at timestamptz not null
);
alter table public.web_oauth_states enable row level security;
revoke all on public.web_oauth_states from public, anon, authenticated;
grant select, insert, delete on public.web_oauth_states to service_role;
create index web_oauth_states_expiry on public.web_oauth_states(expires_at);
