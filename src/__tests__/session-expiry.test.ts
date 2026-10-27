import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
const mocks = vi.hoisted(() => ({ cookie: '', set: vi.fn(), single: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: mocks.cookie }), set: mocks.set, delete: vi.fn() }) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ single: mocks.single }) }) }) }) }))
import { decodeSessionCookie, encodeSessionCookie, upgradeLegacySessionCookie, getSession, setSession, SESSION_TTL_SECONDS } from '@/lib/auth/session'
const now = 1800000000
const user = { userId: 'fictional-user', telegramId: 42 }
function signed(payload: unknown) {
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${b64}.${createHmac('sha256', 'fictional-signing-key').update(b64).digest('base64url')}`
}
function window() { vi.stubEnv('SESSION_LEGACY_WINDOW_START_SECONDS', String(now)); vi.stubEnv('SESSION_LEGACY_CUTOFF_SECONDS', String(now + SESSION_TTL_SECONDS)) }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now * 1000); vi.stubEnv('ENCRYPTION_KEY', 'fictional-signing-key')
  vi.stubEnv('SESSION_LEGACY_WINDOW_START_SECONDS', ''); vi.stubEnv('SESSION_LEGACY_CUTOFF_SECONDS', '')
  vi.clearAllMocks(); mocks.cookie = ''; mocks.single.mockResolvedValue({ data: { id: user.userId } })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })
it('new session has signed iat/exp and seven-day server TTL matching existing cookie intent', () => {
  const cookie = encodeSessionCookie(user)
  expect(JSON.parse(Buffer.from(cookie.split('.')[0], 'base64url').toString())).toEqual({ ...user, v: 2, iat: now, exp: now + SESSION_TTL_SECONDS })
  expect(decodeSessionCookie(cookie)).toEqual(user)
  vi.setSystemTime((now + SESSION_TTL_SECONDS) * 1000)
  expect(decodeSessionCookie(cookie)).toBeNull()
})
it.each([
  { iat: now, exp: now }, { iat: now + 61, exp: now + 100 }, { iat: now, exp: now + SESSION_TTL_SECONDS + 1 },
  { iat: String(now), exp: now + 100 }, { iat: now, exp: String(now + 100) }, { iat: null, exp: now + 100 },
  { iat: now, exp: now + 0.5 }, { iat: 0, exp: now + 100 }, { iat: now, exp: undefined },
])('refuses invalid/future/overlong timestamp claims %j', claims => { expect(decodeSessionCookie(signed({ ...user, v: 2, ...claims }))).toBeNull() })
it('accepts at most 60 seconds future clock skew', () => { expect(decodeSessionCookie(signed({ ...user, v: 2, iat: now + 60, exp: now + 100 }))).toEqual(user) })
it('refuses tampering, partial version fields, unknown version and non-string user IDs', () => {
  const cookie = encodeSessionCookie(user)
  expect(decodeSessionCookie(cookie.replace(/.$/, cookie.endsWith('a') ? 'b' : 'a'))).toBeNull()
  for (const value of [{ ...user, v: 3, iat: now, exp: now + 100 }, { ...user, iat: now }, { ...user, v: 2 }, { userId: {}, telegramId: 42 }, { ...user, telegramId: 0.5 }]) expect(decodeSessionCookie(signed(value))).toBeNull()
})
it('legacy acceptance requires an explicit bounded fixed window, never an absent/invalid/forever bypass', () => {
  const legacy = signed(user)
  expect(decodeSessionCookie(legacy)).toBeNull()
  window(); expect(decodeSessionCookie(legacy)).toEqual(user)
  vi.stubEnv('SESSION_LEGACY_CUTOFF_SECONDS', String(now + SESSION_TTL_SECONDS + 1)); expect(decodeSessionCookie(legacy)).toBeNull()
  window(); vi.setSystemTime((now + SESSION_TTL_SECONDS) * 1000); expect(decodeSessionCookie(legacy)).toBeNull()
})
it('legacy upgrade and repeated reads never extend the fixed cutoff', async () => {
  window(); const legacy = signed(user); mocks.cookie = legacy
  expect(await getSession()).toEqual(user); expect(mocks.set).not.toHaveBeenCalled()
  vi.setSystemTime((now + 1000) * 1000)
  const upgraded = upgradeLegacySessionCookie(legacy)!
  const payload = JSON.parse(Buffer.from(upgraded.split('.')[0], 'base64url').toString())
  expect(payload.exp).toBe(now + SESSION_TTL_SECONDS)
  expect(upgradeLegacySessionCookie(upgraded)).toBeNull()
  vi.setSystemTime((now + SESSION_TTL_SECONDS) * 1000)
  expect(decodeSessionCookie(upgraded)).toBeNull(); expect(upgradeLegacySessionCookie(legacy)).toBeNull()
})
it('fresh authentication legitimately starts a new seven-day session, passive reads do not', async () => {
  await setSession(user.userId, user.telegramId)
  const first = mocks.set.mock.calls[0][1]; expect(decodeSessionCookie(first)).toEqual(user)
  vi.setSystemTime((now + 1000) * 1000); await setSession(user.userId, user.telegramId)
  const second = mocks.set.mock.calls[1][1]
  expect(JSON.parse(Buffer.from(second.split('.')[0], 'base64url').toString()).exp).toBe(now + 1000 + SESSION_TTL_SECONDS)
})
it('expired or missing users never receive an authenticated session', async () => {
  mocks.cookie = encodeSessionCookie(user); mocks.single.mockResolvedValue({ data: null }); expect(await getSession()).toBeNull()
  vi.setSystemTime((now + SESSION_TTL_SECONDS) * 1000); mocks.single.mockClear(); expect(await getSession()).toBeNull(); expect(mocks.single).not.toHaveBeenCalled()
})
