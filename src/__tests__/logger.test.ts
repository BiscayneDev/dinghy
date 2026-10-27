import { afterEach, describe, expect, it, vi } from 'vitest'
import { logger } from '@/lib/logger'

afterEach(() => vi.restoreAllMocks())

describe('structured logger redaction', () => {
  it('redacts camelCase, snake_case, hyphenated and case-insensitive sensitive fields', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const fields = ['accessToken', 'refresh_token', 'API_KEY', 'api-key', 'Authorization', 'signingKey', 'clientSecret', 'Cookie', 'set-cookie', 'privateKey']
    logger.info('safe event', Object.fromEntries(fields.map(key => [key, 'fictional-secret-do-not-log'])))
    const output = String(log.mock.calls[0][0])
    expect(output).not.toContain('fictional-secret-do-not-log')
    for (const field of fields) expect(output).toContain(`"${field}":"[REDACTED]"`)
    expect(spy).not.toHaveBeenCalled()
  })

  it('redacts nested objects and arrays without mutating input, preserving diagnostic fields', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const input = { status: 502, nested: { accessToken: 'fictional-nested' }, attempts: [{ apiKey: 'fictional-array', count: 2 }] }
    logger.error('request failed', input)
    const output = String(spy.mock.calls[0][0])
    expect(output).not.toContain('fictional-nested')
    expect(output).not.toContain('fictional-array')
    expect(output).toContain('"status":502')
    expect(output).toContain('"count":2')
    expect(input.nested.accessToken).toBe('fictional-nested')
  })

  it('handles cycles and repeated objects without throwing or losing safe diagnostics', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const shared = { token: 'fictional-cycle-secret', status: 'ok' }
    const context: Record<string, unknown> = { left: shared, right: shared }
    context.self = context
    expect(() => logger.warn('cycle', context)).not.toThrow()
    const output = String(spy.mock.calls[0][0])
    expect(output).not.toContain('fictional-cycle-secret')
    expect(output).toContain('[Circular]')
    expect(output.match(/"status":"ok"/g)).toHaveLength(2)
  })

  it('keeps plain events and truncates excessively deep values', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    logger.info('plain event')
    expect(spy.mock.calls[0][0]).toBe('[INFO] plain event')
    let node: Record<string, unknown> = { token: 'fictional-deep-secret' }
    for (let i = 0; i < 30; i++) node = { child: node }
    logger.info('deep', node)
    expect(spy.mock.calls[1][0]).toContain('[Truncated]')
    expect(spy.mock.calls[1][0]).not.toContain('fictional-deep-secret')
  })
})
