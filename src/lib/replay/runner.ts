/**
 * Replay one captured turn. Same rules as the capability dry-run: the real
 * system prompt and real tool definitions, but every tool execute is stubbed
 * against the in-memory world - no database, sandbox, browser, mail or
 * wallet is touched, and anything that could send, spend or sign is recorded
 * and refused. The model itself runs only when the caller supplies live
 * gateway credentials (offline, operator-run); tests inject a scripted one.
 */

import type { UserContext } from '@/lib/llm/types'
import { chatWithTools } from '@/lib/spectrum/dinghy'
import { GATEWAY_URL, SHIPYARD_API_KEY, SHIPYARD_MODEL } from '@/lib/spectrum/config'
import { routingFor } from '@/lib/spectrum/routing'
import { actionToolsFor } from '@/lib/spectrum/actions'
import { reminderToolsFor } from '@/lib/spectrum/reminders'
import { stubTools, type TraceCall } from '@/lib/dry-run/run'
import { buildWorld, type ScenarioWorld } from '@/lib/dry-run/world'
import { replayToolsFor } from './tools'
import type { ReplayOutcome, TurnCapture } from './types'

export interface ReplayDeps {
    /** Injectable model driver; defaults to the real chatWithTools against the gateway from env. */
    chat?: typeof chatWithTools
    /** Candidate harness-edit note, injected at the per-turn steering-note position. Baseline: null. */
    overlay?: string | null
    world?: ScenarioWorld
    label?: string
}

export async function replayTurn(capture: TurnCapture, deps: ReplayDeps = {}): Promise<ReplayOutcome> {
    const world = buildWorld(deps.world)
    const trace: TraceCall[] = []
    const ctx: UserContext = {
        userId: world.actingUser, telegramId: 0, telegramChatId: 0, chatGuid: 'replay', name: 'Replay', timezone: 'America/New_York',
        tokens: { google: { accessToken: 'x', refreshToken: null, expiresAt: null }, github: { accessToken: 'x', refreshToken: null, expiresAt: null }, oura: { accessToken: 'x', refreshToken: null, expiresAt: null } },
    }
    const actions = actionToolsFor('replay')
    const proposeGated = new Set(actions.tools.map((t) => t.name))
    const real = [...replayToolsFor(), ...actions.tools, ...reminderToolsFor('replay', world.actingUser, ctx.timezone)]
    const tools = stubTools(real, world, trace, proposeGated)
    const run = deps.chat ?? chatWithTools
    const r = await run(
        capture.history,
        {
            gatewayUrl: GATEWAY_URL, apiKey: SHIPYARD_API_KEY ?? '', model: SHIPYARD_MODEL, routing: routingFor(),
            capabilities: { google: true, wallet: false, files: false, live: true, computer: true, spend: true, reminders: true },
            ...(deps.overlay ? { volatile: deps.overlay } : {}),
        },
        tools,
        ctx
    )
    return {
        label: deps.label ?? (deps.overlay ? 'candidate' : 'baseline'),
        reply: r.reply,
        toolCalls: trace.map((c) => ({ name: c.name, input: c.input, status: c.status })),
        iterations: r.iterations,
        overlay: deps.overlay ?? null,
    }
}
