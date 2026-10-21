-- 073: explicit memory scope on the memories table (Dinghy DB).
-- Dinghy is personal-only, so scope is 'personal' (user-keyed) or 'guest'
-- (unbound chat, keyed by chat_guid only). Business/agent scopes live in
-- Dock's own Supabase project, not here.
-- Idempotent: safe to run twice.

alter table public.memories add column if not exists scope text not null default 'personal';

-- Backfill: rows with no user are guest chat memories.
update public.memories set scope = 'guest' where user_id is null and scope <> 'guest';

alter table public.memories drop constraint if exists memories_scope_check;
alter table public.memories add constraint memories_scope_check
  check (scope in ('personal', 'guest'));

-- Owner invariant: personal rows belong to a user; guest rows belong to a chat only.
alter table public.memories drop constraint if exists memories_scope_owner_check;
alter table public.memories add constraint memories_scope_owner_check
  check (
    (scope = 'personal' and user_id is not null)
    or (scope = 'guest' and user_id is null and chat_guid is not null)
  );

-- Chat-only writers must tag their rows as guest, or the owner check rejects them.
create or replace function public.add_chat_memory(p_chat_guid text, p_channel text, p_type text, p_content text, p_embedding vector, p_model text)
returns uuid
language sql
security definer
set search_path to 'public'
as $function$
  insert into public.memories (chat_guid, source_channel, type, content, embedding, embedding_model, scope)
  values (p_chat_guid, left(p_channel, 32), p_type, left(p_content, 500), p_embedding, p_model, 'guest')
  returning id;
$function$;

create or replace function public.add_chat_memory(p_chat_guid text, p_type text, p_content text, p_embedding vector, p_model text)
returns uuid
language sql
security definer
set search_path to 'public'
as $function$
  insert into public.memories (chat_guid, type, content, embedding, embedding_model, scope)
  values (p_chat_guid, p_type, left(p_content, 500), p_embedding, p_model, 'guest')
  returning id;
$function$;

create index if not exists memories_scope_user_idx on public.memories (scope, user_id);
