import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
const state = vi.hoisted(() => ({ rows: new Map<string, Record<string, string>>(), unavailable: false }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: () => ({
  insert: async (row: Record<string, string>) => { if (state.unavailable) return { error: {} }; state.rows.set(row.state_hash, row); return { error: null } },
  delete: () => {
    const filters: [string, string, string][] = []
    const query = {
      eq: (key: string, val: string) => { filters.push([key, '=', val]); return query },
      gt: (key: string, val: string) => { filters.push([key, '>', val]); return query },
      lt: async (key: string, val: string) => { for (const [hash, row] of state.rows) if (row[key] < val) state.rows.delete(hash); return { error: state.unavailable ? {} : null } },
      select: () => query,
      maybeSingle: async () => {
        if (state.unavailable) return { error: {} }
        for (const [hash, row] of state.rows) {
          if (filters.every(([key, op, val]) => op === '=' ? row[key] === val : row[key] > val)) { state.rows.delete(hash); return { data: row, error: null } }
        }
        return { data: null, error: null }
      },
    }; return query
  },
}) }) }))
import { beginWebOAuth, consumeWebOAuth } from './web-oauth-state'
beforeEach(() => { state.rows.clear(); state.unavailable = false })
describe('web OAuth state', () => {
  it('mints random provider/user-bound hashes, never storing raw state', async () => {
    const a = await beginWebOAuth('github', 'fictional-user', 'fictional-session'); const b = await beginWebOAuth('github', 'fictional-user', 'fictional-session')
    expect(a).toMatch(/^web_[a-f0-9]{64}$/); expect(a).not.toBe(b)
    expect(JSON.stringify([...state.rows.values()])).not.toContain(a)
    expect([...state.rows.values()][0]).toMatchObject({ provider: 'github', user_id: 'fictional-user' })
  })
  it.each(['github', 'oura', 'whoop'] as const)('permits one valid %s callback, rejecting replay and concurrent duplicate', async provider => {
    const token = await beginWebOAuth(provider, 'fictional-user', 'fictional-session')
    const result = await Promise.all([consumeWebOAuth(provider, 'fictional-user', token, token, 'fictional-session'), consumeWebOAuth(provider, 'fictional-user', token, token, 'fictional-session')])
    expect(result.sort()).toEqual([false, true])
    expect(await consumeWebOAuth(provider, 'fictional-user', token, token, 'fictional-session')).toBe(false)
  })
  it('refuses missing/wrong browser cookie, wrong user/provider without consuming real attempt', async () => {
    const token = await beginWebOAuth('github', 'fictional-user', 'fictional-session')
    for (const cookie of [undefined, '', 'web_' + '0'.repeat(64)]) expect(await consumeWebOAuth('github', 'fictional-user', token, cookie, 'fictional-session')).toBe(false)
    expect(await consumeWebOAuth('github', 'other-user', token, token, 'fictional-session')).toBe(false)
    expect(await consumeWebOAuth('github', 'fictional-user', token, token, 'other-session')).toBe(false)
    expect(await consumeWebOAuth('oura', 'fictional-user', token, token, 'fictional-session')).toBe(false)
    expect(await consumeWebOAuth('github', 'fictional-user', token, token, 'fictional-session')).toBe(true)
  })
  it('refuses expiry even when browser retains cookie and cleans expired rows', async () => {
    const token = await beginWebOAuth('whoop', 'fictional-user', 'fictional-session')
    const hash = createHash('sha256').update(token).digest('hex')
    state.rows.get(hash)!.expires_at = new Date(Date.now() - 1).toISOString()
    expect(await consumeWebOAuth('whoop', 'fictional-user', token, token, 'fictional-session')).toBe(false)
    await beginWebOAuth('whoop', 'fictional-user', 'fictional-session'); expect(state.rows.has(hash)).toBe(false)
  })
  it('fails closed on unavailable table/store', async () => {
    const token = await beginWebOAuth('github', 'fictional-user', 'fictional-session')
    state.unavailable = true
    expect(await consumeWebOAuth('github', 'fictional-user', token, token, 'fictional-session')).toBe(false)
    await expect(beginWebOAuth('github', 'fictional-user', 'fictional-session')).rejects.toThrow('securely')
  })
})
