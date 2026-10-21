import { describe, it, expect } from 'vitest'
import { classifyTier, meetsTier } from '@/lib/llm/tier'
import type { ChatMessage } from '@/lib/llm/types'

function msg(text: string): ChatMessage[] {
  return [{ role: 'user', content: text }]
}

describe('classifyTier', () => {
  it('routes frontier reasoning to frontier', () => {
    expect(classifyTier(msg('analyze the trade-offs between these two strategies'))).toBe('frontier')
    expect(classifyTier(msg('can you debug this typescript function and explain the bug'))).toBe('frontier')
    expect(classifyTier(msg('research the latest news and give me a report'))).toBe('frontier')
    expect(classifyTier(msg('what are the legal implications of this contract clause'))).toBe('frontier')
  })

  it('routes casual chat to economy', () => {
    expect(classifyTier(msg('hi, how are you?'))).toBe('economy')
    expect(classifyTier(msg('thanks!'))).toBe('economy')
    expect(classifyTier(msg('set a reminder for tomorrow'))).toBe('economy')
  })

  it('defaults to standard for ambiguous requests', () => {
    expect(classifyTier(msg('tell me more'))).toBe('standard')
    expect(classifyTier(msg('go on'))).toBe('standard')
  })

  it('reads the last user message, not earlier ones', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: 'analyze this complex financial model' },
      { role: 'assistant', content: 'here is the analysis' },
      { role: 'user', content: 'ok thanks' },
    ]
    expect(classifyTier(history)).toBe('economy')
  })

  it('defaults to standard on empty input', () => {
    expect(classifyTier([])).toBe('standard')
  })
})

describe('meetsTier', () => {
  it('orders economy < standard < frontier', () => {
    expect(meetsTier('frontier', 'economy')).toBe(true)
    expect(meetsTier('frontier', 'frontier')).toBe(true)
    expect(meetsTier('standard', 'frontier')).toBe(false)
    expect(meetsTier('economy', 'standard')).toBe(false)
  })
})
