// Wires the shared @shipyard/memory package to Dinghy's infrastructure.
// Imported by every shim in this folder, so configuration happens before first use.
import { configureMemory } from '@shipyard/memory'
import { createServerClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { getLLMProvider } from '@/lib/llm/index'

configureMemory({
  getSupabase: () => createServerClient(),
  logger,
  complete: async ({ system, user, model, maxTokens }) => {
    const res = await getLLMProvider().chat({
      system,
      messages: [{ role: 'user', content: user }],
      tools: [],
      model,
      maxTokens,
    })
    return res.content ?? ''
  },
})
