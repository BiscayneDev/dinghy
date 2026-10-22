# Dinghy <-> Dock connector

Status: built on `feat/dock-connector`. Not merged. Dock's side of the contract below does not exist on Dock's `origin/main` yet.

## Flows

| Flow | Entry | Code |
|---|---|---|
| Pair | iMessage `pair <CODE>` (not linked) | `src/lib/dock/service.ts` `pairChat` |
| Unlink | iMessage `unlink dock`, or Dock event `link.revoked` | `unlinkChat`, `applyDockEvent` |
| Dock to Dinghy | `POST /api/dock/webhook` (HMAC) | `applyDockEvent` |
| Approval reply | `yes`/`no`/`approve`/`reject` (+ optional label) | `handleReply`, `planReply` in `logic.ts` |
| @ routing | message with `@<chief name>` | `matchChiefMention`, `routeToChief` |
| Rename | Dock event `chief.renamed` then user yes/no | `applyDockEvent`, `handleReply` |
| Offline queue | sweep cron calls `drainDockQueue` | `dueQueueHeads`, `sendQueued` |

The inbound hook is in `src/lib/spectrum/handler.ts`, after the beta gate and before any LLM work. Chats with no Dock link take the existing path. A connector error also falls through, so no message is dropped.

## Dock must provide (Dinghy calls these)

All calls are `POST`, JSON, `Authorization: Bearer <connector_token>` except pair.

- `POST /api/connector/pair` body `{code, link_ref}` returns 200 `{connector_token, workspace_id, chief_name}`. Dock enforces 10-minute expiry (410) and single use (409). Dock stores only the hash of the token.
- `POST /api/connector/unlink` returns 200.
- `POST /api/connector/runs` body `{agent, message, client_message_id}` returns 201 `{run_id, agent_name}`. Dock dedupes on `client_message_id`.
- `POST /api/connector/approvals/{id}/decision` body `{decision: approve|reject, expected_details_hash}`. Dock refuses with 410 if expired and 422 if the details hash no longer matches. Returns 200 `{status}`, or 409 if already decided.

Status mapping in `client.ts`: 401/403 unauthorized, 404 not_found, 409 conflict, 410 expired, 422 changed, 5xx and network unreachable (queued), other 4xx rejected.

## Dock sends Dinghy (webhook)

`POST https://getdinghy.sh/api/dock/webhook`, JSON body:

```json
{"event_id":"...","type":"approval.requested","link_ref":"<from pairing>","workspace_id":"<dock workspace id>","data":{...}}
```

Headers: `x-dinghy-timestamp` (unix seconds), `x-dinghy-signature` (hex HMAC-SHA256 of `"<timestamp>.<raw body>"` with the shared secret). Window is 300 seconds. Replays are deduped by `event_id`.

Event types: `approval.requested` (data: approval_id, label, action, amount_text, destination, details_hash, expires_at, card_url), `approval.closed`, `run.update` (agent_name, text), `chief.renamed` (old_name, new_name), `link.revoked`.

## Env

- Dinghy: `DINGHY_DOCK_WEBHOOK_SECRET` (required; the webhook returns 500 without it, so the feature is inert until set), `DOCK_BASE_URL` (default `https://dock-harness.vercel.app`, https only).
- Dock: the same secret as `DINGHY_WEBHOOK_SECRET`. Roll out one value to both projects together.

## Data

Migration `supabase/migrations/074_dock_connector.sql`, applied to project `lrucvslmyrowrfenytes`. Tables: `dock_links` (token encrypted with `encryptTokenForDb`), `dock_pair_codes` (sha256 of code, PK), `dock_approvals` (with `details_hash` and `shown_hash`), `dock_events`, `dock_outbound`. RLS on all; owner read on `dock_links` and `dock_approvals`; writes through the service role.

## Money rule

Dinghy never starts a money action. `dockApi` has four methods only (pair, unlink, submitRun, decideApproval), and a test pins that. Dinghy relays approvals Dock creates and sends the user's yes or no. An approval is refused when expired, when its details changed after the user was shown them, or when it was already decided.
