import { beforeEach, describe, expect, it, vi } from 'vitest'
import { gzipSync } from 'node:zlib'
import { EventEmitter } from 'node:events'
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn(), httpRequest: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }))
vi.mock('node:http', () => ({ request: mocks.httpRequest }))
vi.mock('node:https', () => ({ request: mocks.request }))
import { isPublicAddress, publicHttpsUrl, publicHttpsFetch, publicNetworkLimits } from './public-https'

beforeEach(() => { vi.clearAllMocks(); mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]) })
function respond(status: number, headers: Record<string, string> = {}, text: string | Buffer = 'ok') {
  mocks.request.mockImplementationOnce((_url, options, callback) => {
    const req = new EventEmitter() as EventEmitter & { write: ReturnType<typeof vi.fn>; setTimeout: ReturnType<typeof vi.fn>; end: () => void }
    req.write = vi.fn(); req.setTimeout = vi.fn()
    req.end = () => {
      const res = Object.assign(new EventEmitter(), { statusCode: status, statusMessage: 'test', headers })
      callback(res)
      queueMicrotask(() => { res.emit('data', Buffer.from(text)); res.emit('end') })
    }
    return req
  })
}
describe('public HTTPS transport', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.31.0.1', '192.168.1.1', '169.254.169.254', '100.64.1.1', '0.0.0.0', '224.0.0.1', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', 'fc00::1', 'fd00::1', 'fe80::1', '64:ff9b::7f00:1', '2002:7f00:1::', '2001:db8::1'])('rejects reserved address %s', ip => { expect(isPublicAddress(ip)).toBe(false) })
  it.each(['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111'])('accepts public address %s', ip => { expect(isPublicAddress(ip)).toBe(true) })
  it.each(['http://example.test', 'https://user:pass@example.test', 'https://2130706433', 'https://0x7f000001', 'https://[::ffff:127.0.0.1]'])('rejects unsafe URL %s', url => { expect(() => publicHttpsUrl(url)).toThrow() })
  it('rejects DNS resolving to private IP or mixed public/private answers without connecting', async () => {
    mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }])
    await expect(publicHttpsFetch('https://example.test')).rejects.toThrow('Private')
    expect(mocks.request).not.toHaveBeenCalled()
  })
  it('pins actual TLS connection to validated address, keeping URL hostname and rejecting Host override', async () => {
    respond(200)
    const result = await publicHttpsFetch('https://example.test', { headers: { Host: 'internal.test' } })
    expect(await result.text()).toBe('ok')
    const [url, options] = mocks.request.mock.calls[0]
    expect(url.hostname).toBe('example.test'); expect(options.agent).toBe(false); expect(options.headers.host).toBeUndefined()
    const callback = vi.fn(); options.lookup('example.test', {}, callback)
    expect(callback).toHaveBeenCalledWith(null, '93.184.216.34', 4)
    expect(mocks.lookup).toHaveBeenCalledTimes(1)
  })
  it('revalidates redirects before connecting and refuses private DNS', async () => {
    respond(302, { location: 'https://second.test' })
    mocks.lookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]).mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
    await expect(publicHttpsFetch('https://first.test')).rejects.toThrow('Private')
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })
  it('refuses private literal, credentialed and downgrade redirect URLs', async () => {
    for (const location of ['https://127.0.0.1', 'https://[::1]', 'http://public.test', 'https://user:pass@public.test']) {
      respond(302, { location })
      await expect(publicHttpsFetch('https://first.test')).rejects.toThrow()
    }
    expect(mocks.request).toHaveBeenCalledTimes(4)
  })
  it('follows public relative redirects and strips custom credentials across origins', async () => {
    respond(302, { location: '/next' }); respond(302, { location: 'https://second.test' }); respond(200)
    await publicHttpsFetch('https://first.test', { headers: { Authorization: 'fictional', 'X-Api-Key': 'fictional', Cookie: 'fictional', Accept: 'application/json' } })
    expect(mocks.request.mock.calls[1][1].headers.authorization).toBe('fictional')
    expect(mocks.request.mock.calls[2][1].headers).toEqual({ accept: 'application/json' })
  })
  it('never forwards sensitive request bodies to a different origin', async () => {
    respond(307, { location: 'https://second.test' })
    await expect(publicHttpsFetch('https://first.test', { method: 'POST', body: 'fictional-private-data' })).rejects.toThrow('Cross-origin')
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })
  it('allows public plaintext HTTP only for explicit MCP policy, never an HTTPS downgrade', async () => {
    respond(200); mocks.httpRequest.mockImplementationOnce((...args) => mocks.request(...args))
    expect(await (await publicHttpsFetch('http://example.test', {}, { allowHttp: true })).text()).toBe('ok')
    expect(mocks.httpRequest).toHaveBeenCalledTimes(1)
    respond(302, { location: 'http://second.test' })
    await expect(publicHttpsFetch('https://first.test', {}, { allowHttp: true })).rejects.toThrow('downgrade')
  })
  it('decodes compressed public replies with a bounded output size', async () => {
    respond(200, { 'content-encoding': 'gzip' }, gzipSync('fictional JSON'))
    const response = await publicHttpsFetch('https://example.test')
    expect(await response.text()).toBe('fictional JSON')
    expect(response.headers.has('content-encoding')).toBe(false)
    respond(200, { 'content-encoding': 'gzip' }, gzipSync('x'.repeat(6 * 1024 * 1024)))
    await expect(publicHttpsFetch('https://example.test')).rejects.toThrow()
  })
  it('caps redirect loops', async () => {
    for (let i = 0; i < 6; i++) respond(302, { location: '/again' })
    await expect(publicHttpsFetch('https://first.test')).rejects.toThrow('Too many')
    expect(mocks.request).toHaveBeenCalledTimes(6)
  })
})

it('resource limits can be raised for known MCP use, but malformed/unbounded overrides fail safe', () => {
  vi.stubEnv('PUBLIC_NETWORK_MAX_RESPONSE_BYTES', '10485760')
  vi.stubEnv('PUBLIC_NETWORK_TIMEOUT_MS', '60000')
  expect(publicNetworkLimits()).toEqual({ maxBytes: 10485760, timeoutMs: 60000 })
  vi.stubEnv('PUBLIC_NETWORK_MAX_RESPONSE_BYTES', 'Infinity')
  vi.stubEnv('PUBLIC_NETWORK_TIMEOUT_MS', '-1')
  expect(publicNetworkLimits()).toEqual({ maxBytes: 5242880, timeoutMs: 30000 })
  vi.unstubAllEnvs()
})
