import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
it('migration denies browser roles and DELETE RETURNING consumes exactly once in PostgreSQL', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table public.users(id uuid primary key); insert into users values ('00000000-0000-4000-8000-000000000001');`)
    await db.exec(readFileSync('supabase/migrations/078_web_oauth_states.sql', 'utf8'))
    await db.exec(`insert into web_oauth_states values ('fictional-hash','github','00000000-0000-4000-8000-000000000001','fictional-session-hash',now()+interval '10 minutes');`)
    await db.exec('set role anon')
    await expect(db.query('select * from web_oauth_states')).rejects.toThrow('permission denied')
    await db.exec('reset role; set role authenticated')
    await expect(db.query('delete from web_oauth_states')).rejects.toThrow('permission denied')
    await db.exec('reset role; set role service_role')
    const sql = `delete from web_oauth_states where state_hash='fictional-hash' and provider='github' and user_id='00000000-0000-4000-8000-000000000001' and session_hash='fictional-session-hash' and expires_at>now() returning state_hash`
    // Supabase's service_role bypasses RLS; emulate that trusted role.
    await db.exec('reset role; alter role service_role bypassrls; set role service_role')
    expect((await db.query(sql)).rows).toHaveLength(1)
    expect((await db.query(sql)).rows).toHaveLength(0)
  } finally { await db.close() }
})
