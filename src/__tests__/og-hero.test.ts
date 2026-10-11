import * as React from 'react'
;(globalThis as unknown as { React: unknown }).React = React
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { publishSite, updateSite } = vi.hoisted(() => ({
  publishSite: vi.fn(async (files: { path: string }[]) => ({ url: 'https://harbor-test.here.now/', slug: 'harbor-test', expiresAt: '2030-01-01T00:00:00Z', versionId: 'v1', files })),
  updateSite: vi.fn(async () => undefined),
}))
vi.mock('@/lib/spectrum/plans', () => ({ rememberFile: vi.fn(async () => undefined), findFile: vi.fn() }))
vi.mock('@/lib/spectrum/line-for-chat', () => ({ dinghyLineFor: vi.fn(async () => '+10000000000') }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/data-portability/erasure-state', () => ({ assertAccountActive: vi.fn(async () => undefined) }))
vi.mock('@/lib/files/share', async (orig) => ({ ...(await orig<typeof import('@/lib/files/share')>()), publishSite, updateSite, shareEnabled: () => true }))
vi.mock('@/lib/files/imagery',async(orig)=>({...await orig<typeof import('@/lib/files/imagery')>(),verifyShareMetadata:async()=>true}))
vi.mock('@/lib/files/photos', () => ({ attachPhotos: vi.fn(async (body: string) => ({ body, photos: [] })) }))

import { renderHeroOg } from '@/lib/brand/kind-card'
import { fileToolsFor } from '@/lib/files/tool'
import type { UserContext } from '@/lib/llm/types'

const bodies: Record<string, string> = {
  weather: ':::weather\nPort Marlow | 61° | Light rain | 64° | 52° | 9 mph NW | 70%\n:::',
  scores: ':::scores\nGulls | 3 | Otters | 1 | Final\n:::',
  stay: ':::stay\nHarbor Inn | $2,680 | 4.6 | Shelburne | rooms on request |\n:::',
  media: ':::media\nThe Salt Road | book | 2019 | 4.5 | Ana Verrin | a slow coastal novel | |\n:::',
  route: ':::route\nHarbor Inn | Lakeside path | walk | 9 min | flat\nLakeside path | Aquarium | walk | 5 min | ramp\n:::',
}
const ctx = (photosOk?: boolean) => ({ userId: 'u1', tokens: {}, ...(photosOk === undefined ? {} : { photosOk }) }) as unknown as UserContext
const input = (kind: string) => ({ title: 'Harbor week', format: 'pdf', body: bodies[kind] })

describe('renderHeroOg', () => {
  it.each(Object.keys(bodies))('draws a 1200x630 png for %s', async (k) => {
    const b = await renderHeroOg({ title: 'Harbor week', body: bodies[k] })
    expect(b && [...b.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(b!.readUInt32BE(16)).toBe(1200)
    expect(b!.readUInt32BE(20)).toBe(630)
  }, 60000)
  it('returns null for a page with no hero kind', async () => {
    expect(await renderHeroOg({ title: 'Notes', body: 'plain text' })).toBeNull()
  })
})

describe('create_file og phase 2', () => {
  beforeEach(() => { publishSite.mockClear(); updateSite.mockReset().mockResolvedValue(undefined) })
  const run = async (kind:string,photosOk?:boolean)=>{const set=fileToolsFor();const r=await set.tools[0].execute(input(kind),ctx(photosOk));await set.files()[0]?.enrichImagery?.();return r}

  it('ships useful fallback first, then enriches the full set with site-relative og:image', async () => {
    await run('weather', true)
    const first = (publishSite.mock.calls[0][0] as { path: string }[]).map((f) => f.path)
    expect(first).not.toContain('og.png')
    expect(updateSite).toHaveBeenCalledTimes(1)
    const [slug, files] = updateSite.mock.calls[0] as unknown as [string, { path: string; bytes: Buffer }[]]
    expect(slug).toBe('harbor-test')
    expect(files.map((f) => f.path).sort()).toEqual([...first,'og.png'].sort())
    const html = files.find((f) => f.path === 'index.html')!.bytes.toString('utf8')
    expect(html).toContain('<meta property="og:image" content="https://harbor-test.here.now/og.png">')
    expect(html).not.toContain('getdinghy.sh/api/og/file')
  }, 60000)

  it('a failed or throwing update never fails the page', async () => {
    updateSite.mockRejectedValue(new Error('boom'))
    const r = await run('route', true)
    expect(JSON.stringify(r)).not.toMatch(/boom/)
    expect(publishSite).toHaveBeenCalledTimes(1)
  }, 60000)

  it('unclean turns get no og.png; clean plain pages use their content image', async () => {
    await run('weather', false)
    await run('weather')
    expect(updateSite).not.toHaveBeenCalled()
    for (const c of publishSite.mock.calls) expect((c[0] as { path: string }[]).map((f) => f.path)).not.toContain('og.png')
    publishSite.mockClear()
    const set=fileToolsFor();await set.tools[0].execute({title:'Notes',format:'pdf',body:'## Decisions\nplain'},ctx(true));await set.files()[0].enrichImagery?.()
    expect(updateSite).toHaveBeenCalledTimes(1)
    expect((publishSite.mock.calls[0][0] as { path: string }[]).map(f => f.path)).not.toContain('og.png')
  }, 60000)
})

describe('updateSite', () => {
  it('PUTs the full manifest to the slug, uploads, then finalizes', async () => {
    const { updateSite: real } = await vi.importActual<typeof import('@/lib/files/share')>('@/lib/files/share')
    vi.stubEnv('HERENOW_API_KEY', 'test-key')
    const calls: { url: string; method: string; body?: string }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? 'GET', body: typeof init.body === 'string' ? init.body : undefined })
      if (url.endsWith('/publish/harbor-test') && init.method === 'PUT') return new Response(JSON.stringify({ slug: 'harbor-test', siteUrl: 'https://harbor-test.here.now/', upload: { versionId: 'v2', uploads: [{ path: 'index.html', url: 'https://upload.example.test/a' }, { path: 'og.png', url: 'https://upload.example.test/b' }] } }), { status: 200 })
      return new Response('{}', { status: 200 })
    }))
    try {
      await real('harbor-test', [
        { path: 'index.html', bytes: Buffer.from('<html>'), contentType: 'text/html' },
        { path: 'og.png', bytes: Buffer.from([1, 2]), contentType: 'image/png' },
      ], { title: 'Harbor week', userId: 'u1', baseVersionId: 'v1' })
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs() }
    expect(JSON.parse(calls[0].body!).baseVersionId).toBe('v1')
    expect(calls[0].method).toBe('PUT')
    expect(calls[0].url).toBe('https://here.now/api/v1/publish/harbor-test')
    expect(JSON.parse(calls[0].body!).files.map((f: { path: string }) => f.path)).toEqual(['index.html', 'og.png'])
    expect(calls.filter((c) => c.method === 'PUT' && c.url.startsWith('https://upload.example.test')).length).toBe(2)
    expect(calls.at(-1)!.url).toBe('https://here.now/api/v1/publish/harbor-test/finalize')
    expect(JSON.parse(calls.at(-1)!.body!)).toEqual({ versionId: 'v2' })
  })
})

 describe('og fail-closed guards', () => {
 it('omits unsupported text instead of corrupting it', async () => { expect(await renderHeroOg({title:'港',body:bodies.weather})).toBeNull() })
 it('requires a base version before replacement', async () => {
 const {updateSite: real}=await vi.importActual<typeof import('@/lib/files/share')>('@/lib/files/share');vi.stubEnv('HERENOW_API_KEY','test-key')
 try{await expect(real('harbor-test',[],{title:'Test',userId:'u1'})).rejects.toThrow('missing base version')}finally{vi.unstubAllEnvs()}
 })
 })
