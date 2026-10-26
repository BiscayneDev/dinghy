-- Durable redo continuation. BRANCH ONLY: not applied to any database.
-- A correction after a delivered file becomes one job row per file. Jobs hold ids, never text:
-- note text stays in the user's own stored messages. The original request lives on the file row
-- (erased/exported with it, never in chat history), and Google retention nulls it.

alter table public.dinghy_files
  add column if not exists origin_request text check (origin_request is null or char_length(origin_request) <= 12000),
  add column if not exists origin_google_derived boolean not null default false,
  add column if not exists origin_run_id uuid,
  add column if not exists origin_message_id text,
  add column if not exists origin_kind text check (origin_kind is null or origin_kind in ('map','comparison','list','itinerary','note')),
  -- New redo artifacts only: which job attempt made this file, and whether it was built from Google-derived input.
  add column if not exists redo_op_id uuid,
  add column if not exists redo_google_derived boolean not null default false;
create index if not exists dinghy_files_redo_op on public.dinghy_files (redo_op_id) where redo_op_id is not null;

create table public.dinghy_redo_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  chat_guid text not null,
  file_id uuid not null references public.dinghy_files(id) on delete cascade,
  state text not null default 'queued' check (state in ('queued','running','done','failed','cancelled','blocked')),
  phase text not null default 'queued' check (phase in ('queued','building','publishing','published','sending','sent')),
  note_ids text[] not null default '{}',
  note_revision int not null default 0,
  consumed_revision int not null default 0,
  cancel_requested boolean not null default false,
  claim_id uuid,
  lease_until timestamptz,
  resumes int not null default 0,
  passes int not null default 1,
  op_id uuid,
  notified_key text,
  failure text check (failure is null or char_length(failure) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
create unique index dinghy_redo_jobs_one_active on public.dinghy_redo_jobs (user_id, chat_guid) where state in ('queued','running');
create index dinghy_redo_jobs_claimable on public.dinghy_redo_jobs (state, lease_until);
alter table public.dinghy_redo_jobs enable row level security;
revoke all on public.dinghy_redo_jobs from anon, authenticated, public;
grant select, insert, update, delete on public.dinghy_redo_jobs to service_role;
comment on table public.dinghy_redo_jobs is 'Ids and states only. No message text, no request text.';

-- Create the job or add a note to the active one. Ownership: the file and the note must belong to this user and chat.
create or replace function public.upsert_redo_job(p_user uuid, p_chat text, p_file uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f record; j public.dinghy_redo_jobs;
begin
  select * into f from public.dinghy_files
   where id = p_file and user_id = p_user and deleted_at is null and revoked_at is null
     and (chat_guid = p_chat or (chat_guid is null and origin_request is not null));
  if not found then return jsonb_build_object('status','refused','reason','file'); end if;
  if not exists (select 1 from public.spectrum_identities where user_id = p_user and chat_guid = p_chat) then
    return jsonb_build_object('status','refused','reason','chat');
  end if;
  if f.origin_request is null then return jsonb_build_object('status','refused','reason','no_origin'); end if;
  if p_note is not null and not exists (
    select 1 from public.spectrum_messages where id::text = p_note and chat_guid = p_chat and role = 'user') then
    return jsonb_build_object('status','refused','reason','note');
  end if;
  begin
    insert into public.dinghy_redo_jobs (user_id, chat_guid, file_id, note_ids, note_revision)
    values (p_user, p_chat, p_file, case when p_note is null then '{}' else array[p_note] end, case when p_note is null then 0 else 1 end)
    returning * into j;
    return jsonb_build_object('status','created','job_id',j.id,'revision',j.note_revision);
  exception when unique_violation then
    update public.dinghy_redo_jobs
       set note_ids = case when p_note is null or p_note = any(note_ids) then note_ids else array_append(note_ids, p_note) end,
           note_revision = case when p_note is null or p_note = any(note_ids) then note_revision else note_revision + 1 end,
           updated_at = now()
     where chat_guid = p_chat and user_id = p_user and state in ('queued','running')
     returning * into j;
    if not found then return jsonb_build_object('status','refused','reason','race'); end if;
    return jsonb_build_object('status','appended','job_id',j.id,'revision',j.note_revision,'phase',j.phase);
  end;
end $$;

-- Lease claim. A lease that expired before any external step (queued/building) is resumed once.
-- A lease that expired at or after publishing is NOT retried: the outcome is unknown, so the job becomes blocked.
create or replace function public.claim_redo_job(p_lease_ms int default 330000)
returns setof public.dinghy_redo_jobs language plpgsql security definer set search_path = public as $$
declare j public.dinghy_redo_jobs;
begin
  update public.dinghy_redo_jobs set state = 'blocked', failure = 'outcome_unknown', closed_at = now(), updated_at = now()
   where state = 'running' and lease_until < now() and phase in ('publishing','published','sending');
  update public.dinghy_redo_jobs set state = 'failed', failure = 'resume_exhausted', closed_at = now(), updated_at = now()
   where state = 'running' and lease_until < now() and phase in ('queued','building') and resumes >= 1;
  select * into j from public.dinghy_redo_jobs
   where (state = 'queued' or (state = 'running' and lease_until < now() and phase in ('queued','building') and resumes < 1))
   order by created_at limit 1 for update skip locked;
  if not found then return; end if;
  update public.dinghy_redo_jobs
     set state = 'running', claim_id = gen_random_uuid(), lease_until = now() + make_interval(secs => p_lease_ms / 1000.0),
         resumes = resumes + case when state = 'running' then 1 else 0 end, phase = 'building',
         op_id = gen_random_uuid(), updated_at = now()
   where id = j.id returning * into j;
  return next j;
end $$;

-- Fence for every external step. Publishing and sending only proceed on the current claim, not cancelled,
-- and with every note seen so far consumed by this pass.
create or replace function public.redo_advance(p_job uuid, p_claim uuid, p_phase text, p_consumed int)
returns text language plpgsql security definer set search_path = public as $$
declare j public.dinghy_redo_jobs;
begin
  select * into j from public.dinghy_redo_jobs where id = p_job for update;
  if not found or j.state <> 'running' or j.claim_id is distinct from p_claim then return 'lost'; end if;
  if j.cancel_requested and p_phase in ('publishing','sending') then
    update public.dinghy_redo_jobs set state = 'cancelled', closed_at = now(), updated_at = now() where id = p_job;
    return 'cancelled';
  end if;
  if p_phase = 'publishing' and p_consumed < j.note_revision then return 'stale'; end if;
  update public.dinghy_redo_jobs
     set phase = p_phase, consumed_revision = greatest(consumed_revision, p_consumed),
         lease_until = now() + interval '330 seconds', updated_at = now()
   where id = p_job;
  return 'ok';
end $$;

-- Close after the version was sent. A note that landed after this pass read its notes starts one more pass
-- (a new version that includes it); after the pass cap the job fails and names the gap, it never drops the note.
create or replace function public.redo_close(p_job uuid, p_claim uuid)
returns text language plpgsql security definer set search_path = public as $$
declare j public.dinghy_redo_jobs;
begin
  select * into j from public.dinghy_redo_jobs where id = p_job for update;
  if not found or j.state <> 'running' or j.claim_id is distinct from p_claim or j.phase <> 'sent' then return 'lost'; end if;
  if j.note_revision > j.consumed_revision then
    if j.passes >= 2 then
      update public.dinghy_redo_jobs set state = 'failed', failure = 'note_unapplied', closed_at = now(), updated_at = now() where id = p_job;
      return 'note_unapplied';
    end if;
    update public.dinghy_redo_jobs set state = 'queued', phase = 'queued', claim_id = null, lease_until = null,
           passes = passes + 1, resumes = 0, updated_at = now() where id = p_job;
    return 'requeued';
  end if;
  update public.dinghy_redo_jobs set state = 'done', closed_at = now(), updated_at = now() where id = p_job;
  return 'done';
end $$;

-- Terminal failure on the current claim, with a short reason. Never overwrites a finished job.
create or replace function public.redo_fail(p_job uuid, p_claim uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.dinghy_redo_jobs set state = 'failed', failure = left(p_reason, 200), closed_at = now(), updated_at = now()
   where id = p_job and state = 'running' and claim_id = p_claim;
  return found;
end $$;

-- Cancel. Queued work stops now; running work stops before the next external step.
create or replace function public.redo_cancel(p_user uuid, p_chat text, p_file uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare j public.dinghy_redo_jobs;
begin
  update public.dinghy_redo_jobs
     set cancel_requested = true,
         state = case when state = 'queued' then 'cancelled' else state end,
         closed_at = case when state = 'queued' then now() else closed_at end, updated_at = now()
   where user_id = p_user and chat_guid = p_chat and state in ('queued','running')
   returning * into j;
  if not found then return jsonb_build_object('status','none'); end if;
  return jsonb_build_object('status', j.state, 'phase', j.phase);
end $$;

-- One truthful status per job outcome, deduped inside the same statement that records it, then queued on the existing
-- outbox (lease-based sender). Delivery is still at-least-once at the transport: there is no read-back to prove a send.
create or replace function public.redo_notify(p_job uuid, p_text text)
returns boolean language plpgsql security definer set search_path = public as $$
declare j public.dinghy_redo_jobs; k text;
begin
  select * into j from public.dinghy_redo_jobs where id = p_job for update;
  if not found or j.state in ('queued','running') then return false; end if;
  k := j.state || ':' || j.passes;
  if j.notified_key is not distinct from k then return false; end if;
  update public.dinghy_redo_jobs set notified_key = k, updated_at = now() where id = p_job;
  insert into public.spectrum_outbox (chat_guid, kind, text) values (j.chat_guid, 'reply', left(p_text, 600));
  return true;
end $$;

-- Positive proof that a file belongs to THIS job attempt, not just this chat.
create or replace function public.redo_file_for_op(p_user uuid, p_job uuid)
returns uuid language sql security definer set search_path = public as $$
  select f.id from public.dinghy_files f join public.dinghy_redo_jobs j on j.id = p_job and j.user_id = p_user
   where f.user_id = p_user and f.redo_op_id = j.op_id and j.op_id is not null order by f.created_at desc limit 1
$$;

-- Google retention: the previous body, unchanged, plus origin text and its jobs.
create or replace function public.expire_google_derived(p_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m int; f int; s int; o int; d int;
begin
  if p_days < 1 then raise exception 'p_days must be >= 1'; end if;
  delete from public.spectrum_messages where google_derived and created_at < now() - make_interval(days => p_days);
  get diagnostics m = row_count;
  delete from public.memories where (google_derived or source_channel like '%+google') and created_at < now() - make_interval(days => p_days);
  get diagnostics f = row_count;
  delete from public.conversation_summaries where (google_derived or embedding_model = 'google-withheld') and created_at < now() - make_interval(days => p_days);
  get diagnostics s = row_count;
  delete from public.dinghy_redo_jobs where file_id in (select id from public.dinghy_files where origin_google_derived and created_at < now() - make_interval(days => p_days));
  update public.dinghy_files set origin_request = null
   where origin_google_derived and origin_request is not null and created_at < now() - make_interval(days => p_days);
  get diagnostics o = row_count;
  -- New redo artifacts built from Google-derived input: blank the stored document. Older files are untouched.
  update public.dinghy_files set markdown = '', deleted_at = coalesce(deleted_at, now())
   where redo_op_id is not null and redo_google_derived and created_at < now() - make_interval(days => p_days) and (markdown <> '' or deleted_at is null);
  get diagnostics d = row_count;
  return jsonb_build_object('messages', m, 'facts', f, 'summaries', s, 'origins', o, 'redo_documents', d);
end $$;

revoke all on function public.upsert_redo_job(uuid,text,uuid,text) from public, anon, authenticated;
revoke all on function public.claim_redo_job(int) from public, anon, authenticated;
revoke all on function public.redo_advance(uuid,uuid,text,int) from public, anon, authenticated;
revoke all on function public.redo_close(uuid,uuid) from public, anon, authenticated;
revoke all on function public.redo_cancel(uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.redo_fail(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.redo_notify(uuid,text) from public, anon, authenticated;
revoke all on function public.redo_file_for_op(uuid,uuid) from public, anon, authenticated;
revoke all on function public.expire_google_derived(int) from public, anon, authenticated;
grant execute on function public.upsert_redo_job(uuid,text,uuid,text), public.claim_redo_job(int), public.redo_advance(uuid,uuid,text,int),
  public.redo_close(uuid,uuid), public.redo_cancel(uuid,text,uuid), public.redo_fail(uuid,uuid,text), public.redo_notify(uuid,text), public.redo_file_for_op(uuid,uuid), public.expire_google_derived(int) to service_role;
notify pgrst, 'reload schema';
