import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { clearSession, getSession } from '@/lib/auth/session'
import { safeNextPath } from '@/lib/auth/redirect'
import { CoastShell } from '@/components/brand/CoastShell'
import { LoginForm } from './LoginForm'

export const metadata: Metadata = {
  title: 'Sign in · Dinghy',
  description: 'Sign in to your Dinghy profile.',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string; next?: string; switch?: string }>
}): Promise<React.JSX.Element> {
  const sp = await searchParams
  // ?switch=1 signs the current account out first, so a "not you?" link from a consent page lands
  // on the phone form instead of bouncing back to the signed-in profile.
  if (sp.switch === '1') await clearSession()
  const next = safeNextPath(sp.next)
  if (!sp.switch && (await getSession())) {
    if (next) redirect(next)
    redirect(sp.connected ? `/profile?connected=${encodeURIComponent(sp.connected)}` : '/profile')
  }
  const notice = sp.error
    ? sp.error.startsWith('connect_')
      ? 'That connect link didn\u2019t work or expired. Ask Dinghy for a fresh one, or sign in to connect from your profile.'
      : 'Please sign in to continue.'
    : null
  return (
    <CoastShell>
      <LoginForm notice={notice} next={next} />
    </CoastShell>
  )
}
