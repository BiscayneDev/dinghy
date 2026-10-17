-- photon_v2_chats: binds a synthetic Dinghy chat_guid (v2;<platform>;<spaceId>)
-- to the Photon 2.0 Space and the agent User id outbound sends come from.
-- Written on every inbound v2 message; read by proactive sends.
-- Test-project scope: fictional senders only, no real user data.

create table if not exists photon_v2_chats (
    chat_guid text primary key,
    space_id text not null,
    platform text not null,
    agent_user_id text not null,
    peer_handle text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- No anon access: bindings are server-only, like spectrum_outbox.
revoke all on photon_v2_chats from anon, authenticated;
alter table photon_v2_chats enable row level security;
