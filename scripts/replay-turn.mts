/**
 * Offline replay loop for one logged Dinghy turn.
 *
 *   npx tsx scripts/replay-turn.mts --run <run_id>          pull the failed run from Supabase, replay, judge, write a lesson
 *   npx tsx scripts/replay-turn.mts --file capture.json     replay a previously saved capture
 *   npx tsx scripts/replay-turn.mts --scripted              no keys, no network: proves the loop on a fictional captured turn
 *
 * Live runs read keys from the environment only (NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, SHIPYARD_GATEWAY_URL, SHIPYARD_API_KEY,
 * SHIPYARD_MODEL). Artifacts land in .replay/<runId>/ (gitignored). The loop
 * never writes to production: lessons are review artifacts.
 */

import { writeFileSync, readFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { fetchRunCapture } from '../src/lib/replay/capture'
import { replayLoop } from '../src/lib/replay/loop'
import { appendLesson } from '../src/lib/replay/lessons'
import type { Candidate, TurnCapture } from '../src/lib/replay/types'

const args = process.argv.slice(2)
const flag = (name: string) => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 ? args[i + 1] : undefined
}
const has = (name: string) => args.includes(`--${name}`)

async function gatewayChat(prompt: string): Promise<string> {
    const url = process.env.SHIPYARD_GATEWAY_URL
    const key = process.env.SHIPYARD_API_KEY
    const model = process.env.SHIPYARD_MODEL ?? 'auto'
    if (!url || !key) throw new Error('SHIPYARD_GATEWAY_URL and SHIPYARD_API_KEY are required for live propose/judge')
    const res = await fetch(`${url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], stream: false }),
    })
    if (!res.ok) throw new Error(`gateway ${res.status}`)
    const data = (await res.json()) as { choices: { message: { content: string } }[] }
    return data.choices[0]?.message?.content ?? ''
}

const FICTIONAL_CAPTURE: TurnCapture = {
    runId: 'fictional-weather-stall',
    chatGuid: 'chat-fictional-001',
    capturedAt: '2026-10-18T19:43:17.000Z',
    failure: { stage: 'tool', detail: 'weather:timeout' },
    history: [
        { role: 'user', content: 'hey what is the weather in Bay Harbor this weekend' },
    ],
}

async function main() {
    let capture: TurnCapture
    const scripted = has('scripted')
    const runId = flag('run')
    const file = flag('file')
    if (scripted) {
        capture = FICTIONAL_CAPTURE
    } else if (file) {
        capture = JSON.parse(readFileSync(file, 'utf8')) as TurnCapture
    } else if (runId) {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!supabaseUrl || !serviceKey) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --run')
        capture = await fetchRunCapture({ supabaseUrl, serviceKey, runId })
    } else {
        throw new Error('pass --run <run_id>, --file <capture.json>, or --scripted')
    }

    // The replay itself uses the real model only when gateway keys exist; in
    // --scripted mode a canned driver stands in so the whole loop is provable
    // with zero keys and zero network.
    const chat = scripted
        ? ((async (_h: unknown, opts: { volatile?: string }) => ({
              reply: opts.volatile
                  ? 'Bay Harbor this weekend: Saturday 79 and sunny, Sunday 81 with a late storm chance. Pack for one.'
                  : "I couldn't pull the weather just now - try again in a moment.",
              toolCalls: opts.volatile ? 1 : 0,
              iterations: opts.volatile ? 2 : 1,
          })) as never)
        : undefined

    const result = await replayLoop(capture, {
        ...(chat ? { chat } : {}),
        propose: async ({ failureStage, failureDetail }) => {
            if (scripted) {
                return [
                    {
                        id: 'retry-after-tool-stall',
                        overlay:
                            'If a live-info tool call stalls or errors, call it once more before answering. ' +
                            'Never tell the user it failed after a single attempt.',
                        rationale: 'Single-attempt tool calls turn one network stall into a user-visible failure; retry before admitting failure.',
                        voice: false,
                    },
                ] satisfies Candidate[]
            }
            const raw = await gatewayChat(
                `A personal-agent chat turn failed at stage "${failureStage}" (${failureDetail ?? 'no detail'}). ` +
                    'Propose up to 2 short steering-note edits to the agent system prompt that would prevent this exact failure class. ' +
                    'Return JSON: [{"id","overlay","rationale","voice"}]. Generalize: never quote the user.'
            )
            const match = raw.match(/\[[\s\S]*\]/)
            return match ? (JSON.parse(match[0]) as Candidate[]) : []
        },
        judge: async (input) =>
            gatewayChat(
                `Judge two replies to the same user ask. The turn originally failed at "${input.failureStage}". ` +
                    `Ask: ${input.ask}\nReply A (current behavior): ${input.baselineReply}\nReply B (with edit): ${input.candidateReply}\n` +
                    'Which better serves the ask, in the same voice? Return JSON {"winner":"baseline"|"candidate"|"tie","reason"}.'
            ),
    })

    const outDir = flag('out') ?? join('.replay', capture.runId)
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, 'capture.json'), JSON.stringify(capture, null, 2))
    writeFileSync(join(outDir, 'report.md'), result.report)
    if (result.lesson) {
        const lessonsPath = join('.replay', 'lessons.jsonl')
        appendLesson(lessonsPath, result.lesson)
        console.log(`lesson written to ${lessonsPath} (needs_review${result.lesson.voice ? ', voice' : ''})`)
    }
    console.log(result.report)
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
})
