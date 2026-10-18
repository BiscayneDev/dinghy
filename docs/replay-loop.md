# Offline replay loop (propose, probe, compose)

Borrowed from google-research/harness2, adapted to Dinghy's constraints: it
runs **offline on logged runs**, never inside a user request, and it never
ships anything by itself.

The loop, for one logged failed turn:

1. **capture** (`src/lib/replay/capture.ts`) - reconstruct the turn's exact
   input from what production already logs: `dinghy_run_stages` gives the
   run, the failure stage and the timestamp; `spectrum_messages` gives the
   conversation content. No schema change, no new production logging.
2. **propose** (`src/lib/replay/loop.ts`) - suggest 1-3 candidate harness
   edits (short steering notes), informed by already-accepted lessons.
3. **probe** (`src/lib/replay/runner.ts`) - replay the SAME turn with and
   without each candidate, through the real system prompt and tool
   definitions with every tool stubbed by the dry-run world: no database,
   sandbox, browser, mail or wallet is touched; sends and spends are
   recorded and refused.
4. **compose** (`src/lib/replay/judge.ts`, `lessons.ts`) - contrastive
   judging, no ground truth needed: deterministic rules first (a reply that
   admits failure loses to one that answers), a routed model judge only when
   rules can't call it, ties write nothing. A single clear winner writes one
   generalized, evidence-backed lesson to the lessons file.

## Hard rules

- **Offline only.** Driven by `scripts/replay-turn.mts`. Nothing runs per
  request; nothing in production reads the lessons file.
- **No auto-ship.** Every lesson lands as `needs_review`. A winner is raw
  material for a reviewed prompt patch (a normal PR), not a live edit.
  Voice-touching edits are flagged `voice` and gated on Halsey's review.
- **No real user data in the repo.** Captures and lessons live under
  `.replay/` (gitignored). The lessons writer refuses text that quotes the
  user's message (4+ verbatim words or a distinctive long token).
- **No pinned model.** Live replays, proposals and judging go through the
  Shipyard gateway with the environment's configured routing, same as prod.

## Usage

```
# replay one failed run from the logs (needs Supabase + gateway env)
npx tsx scripts/replay-turn.mts --run <run_id>

# replay a saved capture
npx tsx scripts/replay-turn.mts --file .replay/<run_id>/capture.json

# keyless demo: proves the whole loop on a fictional weather-stall turn
npx tsx scripts/replay-turn.mts --scripted
```

Artifacts: `.replay/<run_id>/capture.json`, `.replay/<run_id>/report.md`,
and `.replay/lessons.jsonl`.

Env for live runs (never committed): `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `SHIPYARD_GATEWAY_URL`, `SHIPYARD_API_KEY`,
`SHIPYARD_MODEL`.

## v1 scope

- Replays the chat/research/live-info tool surface (weather, web, Google
  reads, connect link). Computer/browser-session/workflow and recipe tools
  are excluded: their module chains load the sandbox bootstrap or the
  billing settler, which only exist on deployed runners. Turns in those
  failure classes are not replayable yet.
- Candidate edits are prompt steering notes; tool-description and gating
  edits are future work.
