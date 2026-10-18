/**
 * The replay tool set: the same leaf tools the live iMessage path composes
 * in toolsFor (imessage-tools.ts), assembled here so the offline runner
 * never imports the live context loader (or the wallet modules - a replay
 * context carries no PayBox token, so wallet tools are never offered, just
 * as in a real turn for a user without PayBox connected).
 * Google reads are included: replay contexts use fictional tokens and every
 * execute is stubbed by the dry-run world, so no account is ever touched.
 * Computer/browser-session/workflow tools are not replayable offline yet:
 * their modules load the sandbox bootstrap, which only exists on deployed
 * runners. Turns whose failure class involves them are out of scope for v1; same for
 * the recipe tools, whose execution chain pulls the billing settler.
 */

import type { Tool } from '@/lib/llm/types'
import { gmailSearch, gmailRead, gmailSummarizeInbox } from '@/lib/tools/gmail'
import { gcalListEvents, gcalTodayBriefing } from '@/lib/tools/gcal'
import { webSearch, webFetch } from '@/lib/tools/web'
import { weather } from '@/lib/tools/weather'
import { xFreeTools } from '@/lib/tools/x-free'
import { googleConnect } from '@/lib/tools/google-connect'
import { multiAccount } from '@/lib/integrations/google-accounts'

export function searchEnabled(): boolean {
    return Boolean(process.env.EXA_API_KEY || process.env.TAVILY_API_KEY)
}

/** Mirrors toolsFor(ctx) for a Google-connected user with no wallet, no X/health/GitHub tokens. */
export function replayToolsFor(): Tool[] {
    return [
        weather,
        webFetch,
        ...(searchEnabled() ? [webSearch] : []),
        ...xFreeTools(),
        googleConnect,
        multiAccount(gmailSearch, 'all'),
        multiAccount(gmailRead, 'find'),
        multiAccount(gmailSummarizeInbox, 'all'),
        multiAccount(gcalListEvents, 'all'),
        multiAccount(gcalTodayBriefing, 'all'),
    ]
}
