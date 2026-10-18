# Dinghy on Photon 2.0: migration design (M4)

Status: design, no production changes. The v2 transport (PR #309) runs behind
`PHOTON_V2_*` env vars and is inert until they are set per environment.
Production cutover of anything below waits for Halsey's explicit go.

## Principles

1. **No cutoff for current users.** Legacy spectrum-ts v12 stays live for
   every user until that user is individually migrated and healthy on v2 -
   and even after migration the legacy path keeps working. There is no
   big-bang switch and no deadline for any user.
2. **Parallel, not replacement.** v2 chat_guids are namespaced
   `v2;<platform>;<spaceId>` and can never collide with legacy iMessage
   guids. Both transports feed the same handler (`handleSpectrumMessage`),
   the same outbox, the same beta gate, the same brain.
3. **Dinghy owns the memory.** Conversation context lives in our Supabase,
   keyed off identity - not in Photon's line history. Migrating a user
   means pointing a new line at their existing identity, not copying
   messages.

## Building blocks (already true)

- v2 adapter normalizes inbound events to the legacy InboundSpace /
  InboundMessage shapes; replies go out via the v2 Messages API with
  idempotency keys (PR #309).
- `supabase/migrations/072_photon_v2_chats.sql` adds `photon_v2_chats`
  (chat_guid ↔ space_id, platform, agent_user_id, peer_handle). Additive
  only. The adapter works with a swallowed upsert failure + in-memory
  fallback, so the table can be applied lazily - but it is required for
  durable send routing on serverless (module cache does not survive cold
  starts).
- v2 shared lines can't text a user first (same constraint as legacy), so
  onboarding nudges always originate on a channel the user already has:
  legacy Dinghy line or email.
- Seat math: shared assignments are per-platform, 25 on Free / 100 on Pro.
  Migration pace, not features, is what a plan upgrade gates.

## Per-user migration flow

1. **Assign** - create the v2 shared assignment for the user's handle
   (iMessage and/or WhatsApp independently) via
   `POST /v1/projects/{id}/platforms/{platform}/assignments`.
   Idempotency-keyed by `migrate-<platform>-<handle>`; replay-safe.
2. **Invite the first text** - the user texts the v2 line once (from an
   onboarding beat on the legacy line or email). Until this happens nothing
   changes for them; legacy keeps serving.
3. **Bind** - first inbound on the v2 line creates the `photon_v2_chats`
   row and the synthetic `v2;<platform>;<spaceId>` chat_guid.
4. **Link identity** - the handler resolves identity for the v2 chat_guid
   in this order:
   a. exact `spectrum_identities` row for the v2 chat_guid (repeat visit);
   b. fallback by phone handle (`peer_handle` on the binding): reuse the
      identity the legacy chat already has, so beta role, preferences and
      brain context carry over with zero action from the user;
   c. neither: treat as a brand-new user (current invite-only behavior).
   (b) is the load-bearing piece and is new handler logic (M4a, separate
   PR): today identity is keyed by chat_guid only, and the synthetic v2
   guid is unknown - proven on the preview, where Halsey's own text got
   the beta-gate notice.
5. **Steady state** - the user may keep both lines. Replies always go out
   on the transport the message came in on (space-scoped sender cache +
   binding row). No message ever requires them to switch.
6. **Retire (optional, per user)** - after N days of clean v2 operation
   (default 14) we may release the legacy assignment to free the seat.
   Even then, if they text the old line, legacy still answers; releasing
   is a capacity move, not a cutoff.

## WhatsApp as a first-class outcome

WhatsApp is the reason for v2, not a side effect. The same flow applies
with `platform=whatsapp`: assignment, first text, binding, identity link.
A user can be legacy-iMessage and v2-WhatsApp at once; namespaces keep the
two brains of state apart. Shared v2 WhatsApp lines need no Meta business
verification (that only applies to dedicated WABA lines later).

## Rollback

- Global: unset `PHOTON_V2_*` in the environment; the v2 route 500s closed
  and legacy is untouched. Delete the v2 webhook destination to stop
  deliveries.
- Per user: delete the v2 assignment (`DELETE .../assignments/{id}`); the
  binding row is harmless residue and the legacy line never stopped.

## Production cutover checklist (each step needs Halsey's go)

1. Apply migration 072 to prod Supabase.
2. Set `PHOTON_V2_PROJECT_ID` / `PHOTON_V2_API_KEY` / `PHOTON_V2_WEBHOOK_SECRET`
   in Vercel **Production** scope (Preview-only today; the secret belongs to
   a new prod-URL destination, not the preview one).
3. Point a v2 webhook destination at the prod URL; verify signature on the
   first real delivery (Standard Webhooks, confirmed against the beta).
4. Migrate Halsey himself first (already assigned on the test project for
   iMessage), then the beta cohort in paced batches (seat limits + support
   load), then everyone.
5. Keep legacy env and code paths indefinitely; removal is its own future
   decision, not part of this migration.

## Known platform gaps (as of Oct 18, 2026)

- Photon's "Migrate from legacy platform" dashboard action reads "Not
  available yet"; migration is our own per-user assignment + identity
  mapping, as above.
- `POST .../platforms/whatsapp/assignments` returns an edge 403 on the
  beta (iMessage equivalent works; phone-verified account). Tracked; retry
  loop running; support note drafted pending Halsey's review.
- No vCard content type on v2: contact cards go out as `.vcf` attachments
  (adapter handles this).

## Test evidence so far

- Real iMessage round trip on the throwaway v2 project (Oct 18, 1:11am):
  Halsey's "Ping" -> preview route -> Dinghy beta-gate notice delivered
  back to his phone in 9s. Signature scheme (Standard Webhooks,
  `v1,<base64-HMAC>` over `{id}.{ts}.{body}`) verified mathematically
  against both real deliveries.
- Synthetic signed event: full handler trace (dedupe, rate limit,
  identity, gate, outbox, v2 send).
