-- Web consent for the Dock connector ("Always allow" grants). Idempotent: safe to re-run.
--
-- A grant records that the signed-in Dinghy owner chose "Always allow" for one Dock workspace, so a
-- later reconnect for THAT workspace can complete without showing the consent page again. Grants are
-- deleted on every unlink path (iMessage "unlink dock", Dock's link.revoked event, future account
-- erasure), so an explicit revocation is never undone by auto-reconnect. No tokens here: the grant is
-- only a consent memory; the connector token still comes from a fresh one-time Dock pairing code.

begin;

create table if not exists public.dock_connect_grants (
  chat_guid text not null check (char_length(chat_guid) between 1 and 300),
  workspace_ref text not null check (char_length(workspace_ref) between 1 and 80),
  granted_at timestamptz not null default now(),
  primary key (chat_guid, workspace_ref)
);

alter table public.dock_connect_grants enable row level security;

-- Owner-only reads, mirroring dock_links; the Dinghy app writes through the service role.
drop policy if exists dock_connect_grants_select_owner on public.dock_connect_grants;
create policy dock_connect_grants_select_owner on public.dock_connect_grants for select to authenticated
  using (chat_guid in (select l.chat_guid from public.dock_links l where l.user_id = (select auth.uid())));

commit;

notify pgrst, 'reload schema';
