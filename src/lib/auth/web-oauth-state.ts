import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServerClient } from '@/lib/supabase/server'

export type WebOAuthProvider = 'github' | 'oura' | 'whoop'
export const webOAuthCookie = (provider: WebOAuthProvider) => `web_oauth_${provider}`
const hash = (state: string) => createHash('sha256').update(state).digest('hex')
export const webOAuthCookieOptions = {
  httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const,
  maxAge: 600, path: '/',
}

export async function beginWebOAuth(provider: WebOAuthProvider, userId: string, sessionCookie: string): Promise<string> {
  if (!sessionCookie) throw new Error('Missing browser session')
  const db = createServerClient()
  // Indexed retention cleanup on each initiation; do not store raw states.
  const { error: cleanupError } = await db.from('web_oauth_states').delete().lt('expires_at', new Date().toISOString())
  if (cleanupError) throw new Error('Unable to start OAuth securely')
  const state = `web_${randomBytes(32).toString('hex')}`
  const { error } = await db.from('web_oauth_states').insert({
    state_hash: hash(state), provider, user_id: userId, session_hash: hash(sessionCookie),
    expires_at: new Date(Date.now() + 600_000).toISOString(),
  })
  if (error) throw new Error('Unable to start OAuth securely')
  return state
}

/** Browser cookie AND current user AND provider must match. DELETE RETURNING
 * is the single-use claim: concurrent callbacks cannot both exchange codes. */
export async function consumeWebOAuth(provider: WebOAuthProvider, userId: string, state: string | null, cookie: string | undefined, sessionCookie: string): Promise<boolean> {
  if (!sessionCookie || !state || !cookie || !/^web_[a-f0-9]{64}$/.test(state) || cookie.length !== state.length) return false
  if (!timingSafeEqual(Buffer.from(state), Buffer.from(cookie))) return false
  const { data, error } = await createServerClient().from('web_oauth_states').delete()
    .eq('state_hash', hash(state)).eq('provider', provider).eq('user_id', userId).eq('session_hash', hash(sessionCookie))
    .gt('expires_at', new Date().toISOString()).select('state_hash').maybeSingle()
  return !error && !!data
}
