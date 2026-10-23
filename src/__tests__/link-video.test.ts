import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { LINK_VIDEO } from '@/lib/brand/link-video'
import { renderHtml } from '@/lib/files/render'
import { verifyShareMetadata } from '@/lib/files/imagery'

const doc = { title: 'Harbor notebook', body: '## Decisions\nA fictional sailing plan.' }
const image = 'https://example.test/og.png'
describe('Messages video metadata', () => {
    it('ships a direct HTTPS MP4 with matching aspect ratio and preserves the image', () => {
        const html = renderHtml(doc, {ogImage:image, ogVideo:LINK_VIDEO})
        expect(html).toContain(`<meta property="og:video" content="${LINK_VIDEO.url}">`)
        expect(html).toContain(`<meta property="og:video:secure_url" content="${LINK_VIDEO.url}">`)
        expect(html).toContain('property="og:video:type" content="video/mp4"')
        expect(html).toContain('property="og:video:width" content="1200"')
        expect(html).toContain('property="og:video:height" content="630"')
        expect(html).toContain(`property="og:image" content="${image}"`)
        expect(html).toContain('name="twitter:card" content="summary_large_image"')
        expect(html).toContain('property="og:title" content="Harbor notebook"')
        expect(html).toContain('A fictional sailing plan.')
    })
    it('does not opt private/default renders into video or image previews', () => {
        const html = renderHtml(doc)
        expect(html).not.toContain('property="og:video')
        expect(html).not.toContain('property="og:image')
    })
    it('escapes metadata values', () => {
        const html = renderHtml(doc, {ogVideo:{...LINK_VIDEO,url:'https://example.test/a.mp4?x="&y=1'}})
        expect(html).toContain('a.mp4?x=&quot;&amp;y=1')
    })
    it('bundles a small real MP4, not an HTML player or a runtime encoder', () => {
        const bytes = readFileSync('public/dinghy-link-preview-v1.mp4')
        expect(bytes.subarray(4,8).toString()).toBe('ftyp')
        expect(bytes.length).toBeGreaterThan(1000)
        expect(bytes.length).toBeLessThan(2_000_000)
        expect(bytes.indexOf(Buffer.from('moov'))).toBeLessThan(bytes.indexOf(Buffer.from('mdat')))
        expect(new URL(LINK_VIDEO.url).pathname).toBe('/dinghy-link-preview-v1.mp4')
    })
    it('rejects missing or stale served video metadata', async () => {
        const site = {url:'https://harbor-video.here.now/',slug:'harbor-video',expiresAt:'2030-01-01T00:00:00Z'}
        vi.stubGlobal('fetch', vi.fn(async () => new Response(renderHtml(doc,{ogVideo:LINK_VIDEO}))))
        try {
            expect(await verifyShareMetadata(site,null,doc.title,LINK_VIDEO.url)).toBe(true)
            expect(await verifyShareMetadata(site,null,doc.title)).toBe(false)
            expect(await verifyShareMetadata(site,null,doc.title,'https://example.test/stale.mp4')).toBe(false)
        } finally { vi.unstubAllGlobals() }
    })
})
