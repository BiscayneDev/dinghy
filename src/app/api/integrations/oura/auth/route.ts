import { beginWebOAuth, webOAuthCookie, webOAuthCookieOptions } from '@/lib/auth/web-oauth-state'
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getOuraAuthUrl } from '@/lib/integrations/oura'
import { beginConnectByToken } from '@/lib/connect-token'

export async function GET(request: NextRequest): Promise<NextResponse> {
  // In-thread connect flow (iMessage, no web session): one-use token -> state.
  const connectToken = request?.nextUrl?.searchParams.get('connect')
  if (connectToken) {
    const started = await beginConnectByToken(connectToken, 'oura')
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
    if (!started) return NextResponse.redirect(`${appUrl}/onboarding?error=connect_link_invalid`)
    return NextResponse.redirect(getOuraAuthUrl(started.oauthState))
  }

  const session = await getSession()
  if (!session) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
    return NextResponse.redirect(`${appUrl}/login`)
  }

  const state = await beginWebOAuth('oura', session.userId, request.cookies.get('dock_session')?.value ?? '')
  const response = NextResponse.redirect(getOuraAuthUrl(state))
  response.cookies.set(webOAuthCookie('oura'), state, webOAuthCookieOptions)
  return response
}
