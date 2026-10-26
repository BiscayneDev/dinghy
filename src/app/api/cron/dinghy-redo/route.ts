import { NextRequest, NextResponse } from 'next/server'
import { redoJobsEnabled } from '@/lib/spectrum/redo-jobs'
import { runOneRedoJob } from '@/lib/spectrum/redo-worker-runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Durable redo continuation. Not scheduled in vercel.json: activating it spends model calls and needs explicit approval. Off unless DINGHY_REDO_JOBS=on. */
export async function GET(request: NextRequest): Promise<NextResponse> {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!redoJobsEnabled()) return NextResponse.json({ enabled: false })
    try {
        return NextResponse.json({ enabled: true, ...(await runOneRedoJob()) })
    } catch (err) {
        console.error('[redo] job failed:', err instanceof Error ? err.message : String(err))
        return NextResponse.json({ enabled: true, error: 'job_failed' }, { status: 500 })
    }
}
