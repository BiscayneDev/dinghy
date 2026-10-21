import { describe, it, expect, afterEach } from 'vitest'
import { routingFor, modelFields } from '@/lib/spectrum/routing'

afterEach(() => {
    delete process.env.DINGHY_MODEL_ROUTING
    delete process.env.DINGHY_PROVIDERS
})

describe('routingFor', () => {
    it('sends only the Hopscotch allowlist - Jev picks the tier', () => {
        expect(routingFor()).toEqual({ providers: ['hopscotch'] })
    })
    it('can be switched off or pointed elsewhere', () => {
        process.env.DINGHY_PROVIDERS = 'hopscotch, anthropic'
        expect(routingFor()?.providers).toEqual(['hopscotch', 'anthropic'])
        process.env.DINGHY_MODEL_ROUTING = 'off'
        expect(routingFor()).toBeUndefined()
    })
    it('builds the request fields', () => {
        expect(modelFields('pinned', undefined)).toEqual({ model: 'pinned' })
        // No max_tier by default: the gateway's per-task-class policy governs.
        expect(modelFields('pinned', { providers: ['hopscotch'] })).toEqual({ model: 'auto', shipyard: { providers: ['hopscotch'], attempt_timeout_ms: 15_000 } })
    })
    it('DINGHY_MAX_TIER is an explicit per-turn-cap override, not a default', () => {
        process.env.DINGHY_MAX_TIER = 'standard'
        expect(modelFields('pinned', { providers: ['hopscotch'] }).shipyard?.max_tier).toBe('standard')
        process.env.DINGHY_MAX_TIER = 'nonsense'
        expect(modelFields('pinned', { providers: ['hopscotch'] }).shipyard?.max_tier).toBeUndefined()
    })
})
