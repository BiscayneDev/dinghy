import type { ChatMessage } from './types'

/**
 * Deterministic task classifier that maps a request to a minimum quality tier.
 *
 * Why this exists: Dinghy's Router uses `costOptimized()`, which sorts purely by
 * cost and ignores quality. A request that needs frontier reasoning can get routed
 * to the cheapest economy model. This classifier is the cheap, deterministic
 * "quality oracle" — it inspects the latest user message and returns the minimum
 * tier the chosen model must meet, so the Router picks the cheapest model AT-OR-
 * ABOVE that tier instead of the cheapest model, period.
 *
 * It mirrors the tier judgment Shipyard's Jev applies on the gateway side
 * (casual -> economy, research/news/comparisons/corrections -> frontier), but
 * runs locally so Dinghy can enforce a floor even when routing through its own
 * Router. Deliberately keyword/regex based — no LLM call, no latency, no cost.
 *
 * The tiers are ordered economy < standard < frontier (see shipyard-inference
 * ModelTier). A request is classified to the HIGHEST tier it matches.
 */

export type QualityTier = 'economy' | 'standard' | 'frontier'

const TIER_RANK: Record<QualityTier, number> = { economy: 0, standard: 1, frontier: 2 }

/** Signals that the task needs frontier-grade reasoning. */
const FRONTIER_PATTERNS: RegExp[] = [
  // complex reasoning / analysis
  /\b(analy[sz]e|analysis|compare|comparison|contrast|evaluate|assess|reason|reasoning|synthesi[sz]e|synthesis|explain why|how does|why does|implications|trade-offs|tradeoffs|pros and cons|pros & cons)\b/i,
  // math / code / debugging
  /\b(calculat|compute|equation|deriv|integral|proof|prove|algorithm|complexity|refactor|debug|bug|compile|syntax|regex|regexp|typescript|javascript|python|sql|api|endpoint|function|class|component|deploy|migration|schema)\b/i,
  // research / news / current events
  /\b(research|investigat|news|current events|latest|report|deep dive|deep-dive|literature|paper|study|findings|sources|cite|citation)\b/i,
  // high-stakes domains
  /\b(legal|law|contract|compliance|regulat|tax|financial|finance|invest|portfolio|medical|health|diagnos|security|vulnerab|exploit|threat)\b/i,
  // corrections / judgment calls
  /\b(correct|fix|improve|optimize|optimise|review|critique|edit|rewrite|draft|plan|strategy|recommend|advice|decision)\b/i,
]

/** Signals the task is casual / low-stakes — safe on the cheapest model. */
const ECONOMY_PATTERNS: RegExp[] = [
  /\b(hi|hello|hey|thanks|thank you|ok|okay|sure|yes|no|good|great|nice|awesome|bye|goodbye|morning|afternoon|evening)\b/i,
  /\b(how are you|what's up|whats up|who are you|what can you do|help me with|quick question|remind me|set a reminder|what time|what day|weather|joke|fun fact)\b/i,
  /\b(short|brief|quick|simple|one line|one-line|tl;dr|tldr)\b/i,
]

/** The last user message, lowercased — the signal the classifier reads. */
function lastUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'user' && m.content) return m.content
  }
  return ''
}

/**
 * Classify a request to a minimum quality tier. Returns the highest tier any
 * pattern matches; defaults to `standard` when nothing matches (the safe middle).
 */
export function classifyTier(messages: ChatMessage[]): QualityTier {
  const text = lastUserText(messages)
  if (!text) return 'standard'

  let tier: QualityTier = 'standard'
  if (FRONTIER_PATTERNS.some((re) => re.test(text))) tier = 'frontier'
  else if (ECONOMY_PATTERNS.some((re) => re.test(text))) tier = 'economy'
  return tier
}

/** True when `a` is at least as capable as `b` (a >= b in tier rank). */
export function meetsTier(a: QualityTier, min: QualityTier): boolean {
  return TIER_RANK[a] >= TIER_RANK[min]
}
