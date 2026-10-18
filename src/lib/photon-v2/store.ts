/**
 * photon_v2_chats: maps a synthetic Dinghy chat_guid (`v2;<platform>;<spaceId>`)
 * to the v2 Space and the agent User id sends must come from. Upserted on
 * every inbound v2 message (the agent id arrives as receivedBy.id); read by
 * proactive sends (reminders, briefs) that have no inbound message in hand.
 *
 * Test-project scope only for now: fictional senders, no real user data.
 */

import { createServerClient } from '@/lib/supabase/server'

export interface V2ChatBinding {
    chat_guid: string
    space_id: string
    platform: string
    agent_user_id: string
    peer_handle: string | null
}

export function v2ChatGuid(platform: string, spaceId: string): string {
    return `v2;${platform};${spaceId}`
}

export function parseV2ChatGuid(chatGuid: string): { platform: string; spaceId: string } | null {
    const m = /^v2;([a-z_]+);(pho_spc_[0-7][0-9a-hjkmnp-tv-z]{25})$/.exec(chatGuid)
    return m ? { platform: m[1]!, spaceId: m[2]! } : null
}

export async function upsertV2ChatBinding(binding: V2ChatBinding): Promise<void> {
    try {
        const { error } = await createServerClient().from('photon_v2_chats').upsert({
            chat_guid: binding.chat_guid,
            space_id: binding.space_id,
            platform: binding.platform,
            agent_user_id: binding.agent_user_id,
            peer_handle: binding.peer_handle,
            updated_at: new Date().toISOString(),
        })
        if (error) console.error('upsertV2ChatBinding failed:', error.message)
    } catch (err) {
        console.error('upsertV2ChatBinding threw:', err instanceof Error ? err.message : String(err))
    }
}

export async function loadV2ChatBinding(chatGuid: string): Promise<V2ChatBinding | null> {
    try {
        const { data, error } = await createServerClient()
            .from('photon_v2_chats').select('chat_guid, space_id, platform, agent_user_id, peer_handle')
            .eq('chat_guid', chatGuid).limit(1).maybeSingle()
        if (error) {
            console.error('loadV2ChatBinding failed:', error.message)
            return null
        }
        return (data as V2ChatBinding | null) ?? null
    } catch (err) {
        console.error('loadV2ChatBinding threw:', err instanceof Error ? err.message : String(err))
        return null
    }
}
