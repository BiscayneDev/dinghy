import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib'

const denied = new BlockList()
for (const [ip, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) denied.addSubnet(ip, bits, 'ipv4')
const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')
for (const [ip, bits] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16]] as const) {
  denied.addSubnet(ip, bits, 'ipv6')
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !denied.check(address, 'ipv4')
  // Only global unicast IPv6. This also rejects IPv4-mapped/compatible,
  // loopback, ULA, link-local, multicast and NAT64 translation addresses.
  return family === 6 && globalV6.check(address, 'ipv6') && !denied.check(address, 'ipv6')
}

export function publicHttpsUrl(input: string | URL, allowHttp = false): URL {
  const url = new URL(input)
  if ((url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) || url.username || url.password) throw new Error('Only public HTTP(S) URLs without credentials are allowed')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host) && !isPublicAddress(host)) throw new Error('Private or reserved destination is not allowed')
  return url
}

export async function resolvePublicTarget(url: URL) {
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true, verbatim: true })
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error('Private or reserved destination is not allowed')
  }
  return addresses[0]
}

// Finite resource bounds are necessary for buffered JSON/SSE responses from
// untrusted servers. Operators can raise them for known large/slow MCP use.
export function publicNetworkLimits() {
  const configured = (name: string, fallback: number, minimum: number, maximum: number) => {
    const value = Number(process.env[name])
    return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : fallback
  }
  return {
    maxBytes: configured('PUBLIC_NETWORK_MAX_RESPONSE_BYTES', 5 * 1024 * 1024, 1024, 100 * 1024 * 1024),
    timeoutMs: configured('PUBLIC_NETWORK_TIMEOUT_MS', 30_000, 1000, 300_000),
  }
}
const HOP_HEADERS = ['host', 'connection', 'transfer-encoding', 'content-length', 'upgrade', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'keep-alive', 'accept-encoding']

async function requestOnce(url: URL, init: RequestInit): Promise<Response> {
  const { maxBytes, timeoutMs } = publicNetworkLimits()
  const target = await resolvePublicTarget(url)
  if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const headers = new Headers(init.headers)
  for (const name of HOP_HEADERS) headers.delete(name)
  // Callers here send strings only. Do not silently stringify other body types.
  if (init.body != null && typeof init.body !== 'string') throw new Error('Unsupported request body')
  return new Promise((resolve, reject) => {
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest
    const req = request(url, {
      method: init.method ?? 'GET', headers: Object.fromEntries(headers),
      // No second DNS lookup, connection reuse, proxy, or caller-supplied Host.
      // TLS still checks the original URL hostname, not the pinned IP.
      agent: false,
      lookup: (_host, options, callback) => {
        if (typeof options === 'object' && options.all) callback(null, [target])
        else callback(null, target.address, target.family)
      },
      signal: init.signal ?? undefined,
    }, res => {
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > maxBytes) { res.destroy(new Error('Response exceeds configured size limit')); return }
        chunks.push(chunk)
      })
      res.on('error', reject)
      res.on('end', () => {
        const responseHeaders = new Headers()
        for (const [key, value] of Object.entries(res.headers)) {
          if (value !== undefined) responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : value)
        }
        const status = res.statusCode ?? 502
        let body = Buffer.concat(chunks)
        try {
          const encoding = responseHeaders.get('content-encoding')
          const opts = { maxOutputLength: maxBytes }
          if (encoding === 'gzip') body = gunzipSync(body, opts)
          else if (encoding === 'deflate') body = inflateSync(body, opts)
          else if (encoding === 'br') body = brotliDecompressSync(body, opts)
          if (['gzip', 'deflate', 'br'].includes(encoding ?? '')) {
            responseHeaders.delete('content-encoding'); responseHeaders.delete('content-length')
          }
        } catch (error) { reject(error); return }
        resolve(new Response([204, 205, 304].includes(status) ? null : body, {
          status, statusText: res.statusMessage, headers: responseHeaders,
        }))
      })
    })
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Request timed out')))
    if (init.body) req.write(init.body)
    req.end()
  })
}

/** Server-side fetch for user-selected public endpoints. Validate and pin
 * every hop, cap time/size, and never forward credentials across origins. */
export async function publicHttpsFetch(input: string | URL, init: RequestInit = {}, policy: { allowHttp?: boolean } = {}): Promise<Response> {
  let url = publicHttpsUrl(input, policy.allowHttp)
  let options = { ...init, signal: AbortSignal.any([AbortSignal.timeout(publicNetworkLimits().timeoutMs), ...(init.signal ? [init.signal] : [])]) }
  for (let hop = 0; hop <= 5; hop++) {
    const response = await requestOnce(url, options)
    if (![301, 302, 303, 307, 308].includes(response.status) || !response.headers.has('location')) return response
    if (hop === 5) throw new Error('Too many redirects')
    const next = publicHttpsUrl(new URL(response.headers.get('location')!, url), policy.allowHttp)
    if (url.protocol === 'https:' && next.protocol === 'http:') throw new Error('HTTPS downgrade redirect is not allowed')
    const headers = new Headers(options.headers)
    if (response.status === 303 || ([301, 302].includes(response.status) && options.method?.toUpperCase() === 'POST')) {
      options = { ...options, method: 'GET', body: undefined }
      headers.delete('content-type')
    }
    if (url.origin !== next.origin) {
      // Custom MCP/API credentials can use arbitrary header names. Across
      // origins keep only non-sensitive representation headers.
      for (const key of [...headers.keys()]) if (!['accept', 'content-type', 'user-agent'].includes(key)) headers.delete(key)
      if (options.body) throw new Error('Cross-origin redirect with request body is not allowed')
    }
    options = { ...options, headers }
    url = next
  }
  throw new Error('Too many redirects')
}
