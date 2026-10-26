// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'fs'
import { join } from 'path'

// Real Postgres semantics (PGlite) for migration 077. Stub tables hold only the columns the RPCs read. Fictional ids only.
const MIG = readFileSync(join(process.cwd(), 'supabase/migrations/077_redo_jobs.sql'), 'utf8')
const A = '00000000-0000-0000-0000-00000000000a'
const B = '00000000-0000-0000-0000-00000000000b'
let db: PGlite

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []) { return (await db.query<T>(sql, params)).rows[0] }

beforeAll(async () => {
    db = new PGlite()
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table public.users(id uuid primary key);
      create table public.spectrum_identities(user_id uuid, chat_guid text);
      create table public.spectrum_messages(id bigint generated always as identity primary key, chat_guid text, role text, content text, google_derived boolean default false, created_at timestamptz default now());
      create table public.dinghy_files(id uuid primary key default gen_random_uuid(), user_id uuid references users(id), chat_guid text, title text, markdown text default '', created_at timestamptz default now(), deleted_at timestamptz, revoked_at timestamptz);
      create table public.spectrum_outbox(id uuid primary key default gen_random_uuid(), chat_guid text not null, kind text not null, text text not null, status text default 'pending');
      create table public.memories(google_derived boolean, source_channel text, created_at timestamptz);
      create table public.conversation_summaries(google_derived boolean, embedding_model text, created_at timestamptz);
    `)
    await db.exec(MIG)
})
afterAll(async () => { await db.close() })
beforeEach(async () => {
    await db.exec(`truncate dinghy_redo_jobs, spectrum_outbox, spectrum_messages, memories, conversation_summaries, spectrum_identities, users cascade;
      insert into users values ('${A}'),('${B}');
      insert into spectrum_identities values ('${A}','chat-a'),('${B}','chat-b');`)
})

async function file(user = A, chat = 'chat-a', origin = 'ORIGINAL', google = false) {
    const f = await one<{ id: string }>(`insert into dinghy_files(user_id,chat_guid,title) values ($1,$2,'t') returning id`, [user, chat])
    await db.query(`update dinghy_files set origin_request=$2, origin_google_derived=$3 where id=$1`, [f.id, origin, google])
    return f.id
}
async function note(chat = 'chat-a') { return String((await one<{ id: string }>(`insert into spectrum_messages(chat_guid,role,content) values ($1,'user','x') returning id`, [chat])).id) }
const upsert = async (u: string, c: string, f: string, n: string | null) => (await one<{ r: any }>(`select upsert_redo_job($1,$2,$3,$4) r`, [u, c, f, n])).r

describe('redo jobs, DB semantics', () => {
    it('one active job per file; later notes append once and bump the revision', async () => {
        const f = await file(); const n1 = await note(), n2 = await note()
        expect((await upsert(A, 'chat-a', f, null)).status).toBe('created')
        expect((await upsert(A, 'chat-a', f, n1)).revision).toBe(1)
        expect((await upsert(A, 'chat-a', f, n1)).revision).toBe(1)
        expect((await upsert(A, 'chat-a', f, n2)).revision).toBe(2)
        expect((await one<{ c: number }>(`select count(*)::int c from dinghy_redo_jobs`)).c).toBe(1)
    })
    it('refuses cross-user file, chat and note ids', async () => {
        const f = await file(); const nB = await note('chat-b')
        expect((await upsert(B, 'chat-b', f, null)).status).toBe('refused')
        expect((await upsert(A, 'chat-b', f, null)).status).toBe('refused')
        expect((await upsert(A, 'chat-a', f, nB)).reason).toBe('note')
        expect((await one<{ c: number }>(`select count(*)::int c from dinghy_redo_jobs`)).c).toBe(0)
    })
    it('refuses a file without a stored origin', async () => {
        const f = await file(A, 'chat-a', null as unknown as string)
        expect((await upsert(A, 'chat-a', f, null)).reason).toBe('no_origin')
    })
    it('a note arriving before publish blocks publishing until consumed', async () => {
        const f = await file(); await upsert(A, 'chat-a', f, null)
        const j = await one<any>(`select * from claim_redo_job()`)
        const n = await note(); await upsert(A, 'chat-a', f, n)
        expect((await one<any>(`select redo_advance($1,$2,'publishing',0) r`, [j.id, j.claim_id])).r).toBe('stale')
        expect((await one<any>(`select redo_advance($1,$2,'publishing',1) r`, [j.id, j.claim_id])).r).toBe('ok')
    })
    it('a note after publishing starts one more pass, then fails and names the gap, never dropped', async () => {
        const f = await file(); await upsert(A, 'chat-a', f, null)
        let j = await one<any>(`select * from claim_redo_job()`)
        await one(`select redo_advance($1,$2,'publishing',0)`, [j.id, j.claim_id])
        await upsert(A, 'chat-a', f, await note())
        await one(`select redo_advance($1,$2,'sent',0)`, [j.id, j.claim_id])
        expect((await one<any>(`select redo_close($1,$2) r`, [j.id, j.claim_id])).r).toBe('requeued')
        j = await one<any>(`select * from claim_redo_job()`)
        expect(j.passes).toBe(2)
        await one(`select redo_advance($1,$2,'publishing',1)`, [j.id, j.claim_id])
        await upsert(A, 'chat-a', f, await note())
        await one(`select redo_advance($1,$2,'sent',1)`, [j.id, j.claim_id])
        expect((await one<any>(`select redo_close($1,$2) r`, [j.id, j.claim_id])).r).toBe('note_unapplied')
        expect((await one<any>(`select state, failure from dinghy_redo_jobs where id=$1`, [j.id]))).toMatchObject({ state: 'failed', failure: 'note_unapplied' })
    })
    it('cancel stops a queued job at once and fences publish and send of a running one', async () => {
        const f = await file(); await upsert(A, 'chat-a', f, null)
        expect((await one<any>(`select redo_cancel($1,'chat-a',$2) r`, [A, f])).r.status).toBe('cancelled')
        const g = await file(); await upsert(A, 'chat-a', g, null)
        const j = await one<any>(`select * from claim_redo_job()`)
        expect((await one<any>(`select redo_cancel($1,'chat-a',$2) r`, [A, g])).r.status).toBe('running')
        expect((await one<any>(`select redo_advance($1,$2,'publishing',0) r`, [j.id, j.claim_id])).r).toBe('cancelled')
    })
    it('a stale claim is fenced out', async () => {
        const f = await file(); await upsert(A, 'chat-a', f, null)
        const j = await one<any>(`select * from claim_redo_job()`)
        expect((await one<any>(`select redo_advance($1,$2,'publishing',0) r`, [j.id, '00000000-0000-0000-0000-000000000099'])).r).toBe('lost')
    })
    it('crash before any external step resumes once; a second crash fails it', async () => {
        const f = await file(); await upsert(A, 'chat-a', f, null)
        let j = await one<any>(`select * from claim_redo_job()`)
        await db.query(`update dinghy_redo_jobs set lease_until = now() - interval '1 minute'`)
        j = await one<any>(`select * from claim_redo_job()`)
        expect(j.resumes).toBe(1)
        await db.query(`update dinghy_redo_jobs set lease_until = now() - interval '1 minute'`)
        expect(await one<any>(`select * from claim_redo_job()`)).toBeUndefined()
        expect((await one<any>(`select state, failure from dinghy_redo_jobs`))).toMatchObject({ state: 'failed', failure: 'resume_exhausted' })
    })
    it('crash at or after publishing is never retried: blocked as outcome unknown', async () => {
        for (const phase of ['publishing', 'published', 'sending']) {
            await db.exec(`delete from dinghy_redo_jobs`)
            const f = await file(); await upsert(A, 'chat-a', f, null)
            const j = await one<any>(`select * from claim_redo_job()`)
            await one(`select redo_advance($1,$2,$3,0)`, [j.id, j.claim_id, phase])
            await db.query(`update dinghy_redo_jobs set lease_until = now() - interval '1 minute'`)
            expect(await one<any>(`select * from claim_redo_job()`)).toBeUndefined()
            expect((await one<any>(`select state, failure from dinghy_redo_jobs`))).toMatchObject({ state: 'blocked', failure: 'outcome_unknown' })
        }
    })
    it('Google retention nulls the origin and deletes its job; non-Google origins and the old counts are untouched', async () => {
        const g = await file(A, 'chat-a', 'GOOGLE-DERIVED', true), p = await file(A, 'chat-a', 'PLAIN', false)
        await upsert(A, 'chat-a', g, null); await upsert(A, 'chat-a', p, null)
        await db.exec(`update dinghy_files set created_at = now() - interval '40 days'`)
        await db.exec(`insert into spectrum_messages(chat_guid,role,content,google_derived,created_at) values ('chat-a','user','g',true, now() - interval '40 days'),('chat-a','user','k',false, now() - interval '40 days')`)
        const r = (await one<any>(`select expire_google_derived(30) r`)).r
        expect(r).toMatchObject({ messages: 1, facts: 0, summaries: 0, origins: 1, redo_documents: 0 })
        expect((await one<any>(`select origin_request from dinghy_files where id=$1`, [g])).origin_request).toBeNull()
        expect((await one<any>(`select origin_request from dinghy_files where id=$1`, [p])).origin_request).toBe('PLAIN')
        expect((await one<{ c: number }>(`select count(*)::int c from dinghy_redo_jobs`)).c).toBe(1)
    })
    it('only the redo artifact bound to this job attempt counts as published; another file in the chat does not', async () => {
        const f = await file(); await upsert(A, 'chat-a', f, null)
        const j = await one<any>(`select * from claim_redo_job()`)
        const other = await file()
        expect((await one<any>(`select redo_file_for_op($1,$2) r`, [A, j.id])).r).toBeNull()
        const mine = await file(); await db.query(`update dinghy_files set redo_op_id=$1 where id=$2`, [j.op_id, mine])
        expect((await one<any>(`select redo_file_for_op($1,$2) r`, [A, j.id])).r).toBe(mine)
        expect((await one<any>(`select redo_file_for_op($1,$2) r`, [B, j.id])).r).toBeNull()
        expect(other).not.toBe(mine)
    })
    it('one truthful status per outcome, deduped; none while active', async () => {
        const f = await file(); await upsert(A, 'chat-a', f, null)
        const j = await one<any>(`select * from claim_redo_job()`)
        expect((await one<any>(`select redo_notify($1,'x') r`, [j.id])).r).toBe(false)
        await one(`select redo_advance($1,$2,'sending',0)`, [j.id, j.claim_id])
        await db.query(`update dinghy_redo_jobs set lease_until = now() - interval '1 minute'`)
        await one<any>(`select * from claim_redo_job()`)
        expect((await one<any>(`select redo_notify($1,'status') r`, [j.id])).r).toBe(true)
        expect((await one<any>(`select redo_notify($1,'status') r`, [j.id])).r).toBe(false)
        expect((await one<{ c: number }>(`select count(*)::int c from spectrum_outbox`)).c).toBe(1)
    })
    it('Google-derived redo artifacts lose their document after the TTL; older and non-Google files are untouched', async () => {
        const g = await file(), p = await file(), old = await file()
        await db.query(`update dinghy_files set markdown='DOC', redo_op_id=gen_random_uuid(), redo_google_derived=true where id=$1`, [g])
        await db.query(`update dinghy_files set markdown='DOC', redo_op_id=gen_random_uuid() where id=$1`, [p])
        await db.query(`update dinghy_files set markdown='DOC' where id=$1`, [old])
        await db.exec(`update dinghy_files set created_at = now() - interval '40 days'`)
        expect((await one<any>(`select expire_google_derived(30) r`)).r.redo_documents).toBe(1)
        expect((await one<any>(`select markdown from dinghy_files where id=$1`, [g])).markdown).toBe('')
        expect((await one<any>(`select markdown from dinghy_files where id=$1`, [p])).markdown).toBe('DOC')
        expect((await one<any>(`select markdown from dinghy_files where id=$1`, [old])).markdown).toBe('DOC')
    })
    it('redo_fail ends only the running job on the current claim', async () => {
        const f = await file(); await upsert(A, 'chat-a', f, null)
        const j = await one<any>(`select * from claim_redo_job()`)
        expect((await one<any>(`select redo_fail($1,$2,'x') r`, [j.id, '00000000-0000-0000-0000-000000000099'])).r).toBe(false)
        expect((await one<any>(`select redo_fail($1,$2,'note_unavailable') r`, [j.id, j.claim_id])).r).toBe(true)
        expect((await one<any>(`select redo_fail($1,$2,'again') r`, [j.id, j.claim_id])).r).toBe(false)
        expect((await one<any>(`select state, failure from dinghy_redo_jobs`))).toMatchObject({ state: 'failed', failure: 'note_unavailable' })
    })
})
