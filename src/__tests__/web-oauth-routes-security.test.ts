import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const m = vi.hoisted(() => ({ begin: vi.fn(), consume: vi.fn(), getSession: vi.fn(), claim: vi.fn(), exchange: vi.fn(), store: vi.fn(), cookieDelete: vi.fn() }))
vi.mock('@/lib/auth/session', () => ({ getSession: m.getSession }))
vi.mock('@/lib/auth/web-oauth-state', () => ({ beginWebOAuth: m.begin, consumeWebOAuth: m.consume, webOAuthCookie: (p: string) => `web_oauth_${p}`, webOAuthCookieOptions: { httpOnly: true, sameSite: 'lax', maxAge: 600, path: '/' } }))
vi.mock('next/headers', () => ({ cookies: async () => ({ delete: m.cookieDelete }) }))
vi.mock('@/lib/connect-token', () => ({ beginConnectByToken: m.begin, claimConnectByState: m.claim, releaseConnectClaim: vi.fn(), completeConnect: vi.fn(), markConnectTerminal: vi.fn(), bindSpectrumIdentity: vi.fn() }))
vi.mock('@/lib/integrations/github', () => ({ getAuthUrl: (_scopes: unknown, state: string) => `https://github.example.test/authorize?state=${state}`, exchangeCode: m.exchange, storeGithubTokens: m.store }))
vi.mock('@/lib/integrations/oura', () => ({ getOuraAuthUrl: (state: string) => `https://oura.example.test/authorize?state=${state}`, exchangeOuraCode: m.exchange, storeOuraTokens: m.store }))
vi.mock('@/lib/integrations/whoop', () => ({ getWhoopAuthUrl: (state: string) => `https://whoop.example.test/authorize?state=${state}`, exchangeWhoopCode: m.exchange, storeWhoopTokens: m.store }))
vi.mock('@/lib/integrations/google', () => ({ exchangeCode: vi.fn(), storeGoogleTokens: vi.fn(), verifyGoogleConnection: vi.fn() }))
vi.mock('@/lib/integrations/twitter', () => ({ exchangeTwitterCode: vi.fn(), storeTwitterTokens: vi.fn() }))
vi.mock('@/lib/integrations/paybox', () => ({ exchangePayboxCode: vi.fn(), storePayboxTokens: vi.fn(), verifyPayboxConnection: vi.fn() }))
vi.mock('@/lib/spectrum/first-look', () => ({ phoneFromChatGuid: vi.fn(), markFirstLookPending: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }))
import { GET as callback } from '@/app/auth/callback/[provider]/route'
import { GET as github } from '@/app/api/integrations/github/auth/route'
import { GET as oura } from '@/app/api/integrations/oura/auth/route'
import { GET as whoop } from '@/app/api/integrations/whoop/auth/route'
beforeEach(() => {
  vi.clearAllMocks(); process.env.NEXT_PUBLIC_APP_URL = 'https://dinghy.example.test'
  m.getSession.mockResolvedValue({ userId: 'fictional-user' }); m.begin.mockResolvedValue('web_fictional'); m.consume.mockResolvedValue(true)
  m.exchange.mockResolvedValue({ accessToken: 'fictional-access', refreshToken: 'fictional-refresh', expiresAt: 1000, username: 'fictional' }); m.claim.mockResolvedValue(null)
})
for (const [provider, start] of [['github', github], ['oura', oura], ['whoop', whoop]] as const) {
  it(`${provider} web initiation sends random state and browser cookie`, async () => {
    const response = await start(new NextRequest(`https://dinghy.example.test/api/integrations/${provider}/auth`, { headers: { cookie: 'dock_session=fictional-session' } }))
    expect(m.begin).toHaveBeenCalledWith(provider, 'fictional-user', 'fictional-session')
    expect(response.headers.get('location')).toContain('state=web_fictional'); expect(response.cookies.get(`web_oauth_${provider}`)?.value).toBe('web_fictional')
  })
  it(`${provider} valid web callback consumes before storing for current user`, async () => {
    const response = await callback(new NextRequest(`https://dinghy.example.test/auth/callback/${provider}?code=fictional&state=web_fictional`, { headers: { cookie: `dock_session=fictional-session; web_oauth_${provider}=web_fictional` } }), { params: Promise.resolve({ provider }) })
    expect(m.consume).toHaveBeenCalledWith(provider, 'fictional-user', 'web_fictional', 'web_fictional', 'fictional-session')
    expect(m.claim).not.toHaveBeenCalled(); expect(m.store.mock.calls[0][0]).toBe('fictional-user')
    expect(m.consume.mock.invocationCallOrder[0]).toBeLessThan(m.exchange.mock.invocationCallOrder[0])
    expect(response.headers.get('location')).toContain(`connected=${provider}`)
  })
  it(`${provider} refused state never exchanges or stores code`, async () => {
    m.consume.mockResolvedValue(false)
    const response = await callback(new NextRequest(`https://dinghy.example.test/auth/callback/${provider}?code=fictional&state=web_invalid`), { params: Promise.resolve({ provider }) })
    expect(response.headers.get('location')).toContain('oauth_state_mismatch'); expect(m.exchange).not.toHaveBeenCalled(); expect(m.store).not.toHaveBeenCalled()
  })
  it(`${provider} existing in-thread state still takes provider-bound token path`, async () => {
    await callback(new NextRequest(`https://dinghy.example.test/auth/callback/${provider}?code=fictional&state=originalrandomstate`), { params: Promise.resolve({ provider }) })
    expect(m.claim).toHaveBeenCalledWith('originalrandomstate', provider); expect(m.consume).not.toHaveBeenCalled()
  })
}
