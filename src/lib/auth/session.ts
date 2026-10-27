import { cookies } from 'next/headers'
import { createHmac, timingSafeEqual } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'

const SESSION_COOKIE = 'dock_session'
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7
const CLOCK_SKEW_SECONDS = 60
type TimedSession = Session & { v: 2; iat: number; exp: number }

export interface Session {
  userId: string
  telegramId: number
}

/**
 * Session cookies are signed with ENCRYPTION_KEY (HMAC-SHA256):
 *   value = base64url(payload).base64url(hmac)
 * `userId` in an unsigned/tampered cookie is rejected before any DB lookup.
 * Legacy unsigned cookies are REJECTED outright — the migration window is
 * closed. No unsigned JSON is ever parsed or trusted.
 */

function getSecret(): string {
  const secret = process.env.ENCRYPTION_KEY
  if (!secret) throw new Error('ENCRYPTION_KEY is not set — cannot sign sessions')
  return secret
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('base64url')
}

function encodeTimedSession(session: Session, expiresAt: number): string {
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({ userId: session.userId, telegramId: session.telegramId, v: 2, iat: now, exp: expiresAt })).toString('base64url')
  return `${payload}.${sign(payload)}`
}

export function encodeSessionCookie(session: Session): string {
  return encodeTimedSession(session, Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS)
}

/** Both operator-approved timestamps are fixed release configuration, never
 * computed from startup or request time. No config means no legacy bypass.
 * A restart/redeploy cannot roll the deadline forward. */
function legacyCutoff(): number | null {
  const started = Number(process.env.SESSION_LEGACY_WINDOW_START_SECONDS)
  const cutoff = Number(process.env.SESSION_LEGACY_CUTOFF_SECONDS)
  const now = Math.floor(Date.now() / 1000)
  if (!Number.isSafeInteger(started) || !Number.isSafeInteger(cutoff) || started <= 0 ||
      cutoff <= started || cutoff - started > SESSION_TTL_SECONDS || started > now + CLOCK_SKEW_SECONDS || now >= cutoff) return null
  return cutoff
}

function verifyCookie(value: string): { session: Session; legacy: boolean } | null {
  if (value.length > 4096) return null
  const parts = value.split('.')
  if (parts.length !== 2) return null
  const [payload, signature] = parts
  const expected = sign(payload)
  if (!/^[A-Za-z0-9_-]+$/.test(signature) || signature.length !== expected.length) return null
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<TimedSession>
    if (!data || typeof data.userId !== 'string' || !data.userId || typeof data.telegramId !== 'number' || !Number.isSafeInteger(data.telegramId)) return null
    const session = { userId: data.userId, telegramId: data.telegramId }
    if (data.v === undefined && data.iat === undefined && data.exp === undefined) {
      return legacyCutoff() ? { session, legacy: true } : null
    }
    const now = Math.floor(Date.now() / 1000)
    if (data.v !== 2 || !Number.isSafeInteger(data.iat) || !Number.isSafeInteger(data.exp)) return null
    const { iat, exp } = data as TimedSession
    if (iat <= 0 || iat > now + CLOCK_SKEW_SECONDS || exp <= now || exp <= iat || exp - iat > SESSION_TTL_SECONDS) return null
    return { session, legacy: false }
  } catch { return null }
}

export function decodeSessionCookie(value: string): Session | null {
  return verifyCookie(value)?.session ?? null
}

/** Optional explicit cookie-writing auth route may upgrade a legacy cookie.
 * Passive getSession reads never renew it. Upgrade expires at the same fixed
 * legacy cutoff, never now+7d. Normal fresh authentication uses setSession. */
export function upgradeLegacySessionCookie(value: string): string | null {
  const verified = verifyCookie(value)
  const cutoff = legacyCutoff()
  if (!verified?.legacy || !cutoff) return null
  return encodeTimedSession(verified.session, cutoff)
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: SESSION_TTL_SECONDS, // 7 days, also enforced in signed claims
    path: '/',
  }
}

export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get(SESSION_COOKIE)

  if (!sessionCookie?.value) {
    return null
  }

  // Legacy unsigned cookies are no longer accepted — the migration window has
  // closed. An unsigned cookie is a forgery vector; reject it outright.
  if (!sessionCookie.value.includes('.')) {
    return null
  }

  const session = decodeSessionCookie(sessionCookie.value)
  if (!session) return null

  // Verify user exists
  const supabase = createServerClient()
  const { data } = await supabase
    .from('users')
    .select('id')
    .eq('id', session.userId)
    .single()

  if (!data) return null

  return session
}

export async function setSession(userId: string, telegramId: number): Promise<void> {
  const cookieStore = await cookies()

  cookieStore.set(SESSION_COOKIE, encodeSessionCookie({ userId, telegramId }), cookieOptions())
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE)
}
