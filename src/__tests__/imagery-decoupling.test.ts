import * as React from 'react'
;(globalThis as unknown as {React:unknown}).React=React
import {describe,it,expect,vi,afterEach} from 'vitest'
const {publish,update,photos,preview,verify}=vi.hoisted(()=>({publish:vi.fn(),update:vi.fn(),photos:vi.fn(),preview:vi.fn(),verify:vi.fn()}))
vi.mock('@/lib/files/share',()=>({publishSite:publish,updateSite:update,shareEnabled:()=>true,revokeSite:vi.fn()}))
vi.mock('@/lib/spectrum/plans',()=>({rememberFile:async()=>{},findFile:vi.fn()}))
vi.mock('@/lib/supabase/server',()=>({createServerClient:()=>({})}))
vi.mock('@/lib/files/photos',()=>({attachPhotos:photos}))
vi.mock('@/lib/brand/surface-preview',()=>({renderSurfacePreview:preview}))
vi.mock('@/lib/files/imagery',async(orig)=>({...await orig<typeof import('@/lib/files/imagery')>(),verifyShareMetadata:verify}))
import {fileToolsFor} from '@/lib/files/tool'
import {optionalWithin} from '@/lib/files/imagery'
import type {UserContext} from '@/lib/llm/types'
const site={url:'https://harbor-imagery.here.now/',slug:'harbor-imagery',versionId:'v1',expiresAt:'2030-01-01T00:00:00Z'}
const ctx={userId:'fictional',tokens:{},photosOk:true} as UserContext
const input={title:'Harbor notes',format:'html',body:'## Harbor decisions\nUseful fictional answer.'}
const deferred=<T>()=>{let resolve!:(v:T)=>void;return{promise:new Promise<T>(r=>{resolve=r}),resolve}}
const setup=()=>{publish.mockResolvedValue(site);update.mockResolvedValue(undefined);verify.mockResolvedValue(true);photos.mockImplementation(async(body:string)=>({body,photos:[]}));preview.mockResolvedValue({bytes:Buffer.from('fictional-preview'),route:'content_summary'});return fileToolsFor()}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.resetAllMocks()})
describe('imagery is separate from useful content',()=>{
 it('settles a verified source page without ever starting photo lookup',async()=>{const set=setup();photos.mockReturnValue(new Promise(()=>{}));expect((await set.tools[0].execute(input,ctx)).success).toBe(true);expect(photos).not.toHaveBeenCalled();expect(update).not.toHaveBeenCalled();expect(set.files()[0].imagery).toMatchObject({page:'fallback',share:'fallback',chat:'ready',metadata:'verified'});expect(publish.mock.calls[0][0][0].bytes.toString()).toContain('Useful fictional answer.')})
 it('settles with unverified metadata explicitly recorded',async()=>{const set=setup();verify.mockResolvedValue(false);await set.tools[0].execute(input,ctx);expect(set.files()[0].imagery?.metadata).toBe('unverified');expect(set.files()[0].hosted).toEqual(site)})
 it('bounds a hanging local preview without losing or mutating the queue later',async()=>{vi.useFakeTimers();const set=setup();const d=deferred<{bytes:Buffer;route:string}>();preview.mockReturnValue(d.promise);const run=set.tools[0].execute(input,ctx);await vi.advanceTimersByTimeAsync(1600);expect((await run).success).toBe(true);expect(set.files()[0].card).toBeUndefined();d.resolve({bytes:Buffer.from('late'),route:'content_summary'});await vi.advanceTimersByTimeAsync(1);expect(set.files()[0].card).toBeUndefined()})
 it('keeps private turns free of title-bearing remote image URLs and image calls',async()=>{const set=setup();preview.mockResolvedValue({bytes:null,route:'static_link',reason:'privacy_gate'});await set.tools[0].execute(input,{...ctx,photosOk:false});await set.files()[0].enrichImagery?.();expect(photos).not.toHaveBeenCalled();expect(publish.mock.calls[0][0][0].bytes.toString()).not.toContain('property="og:image"');expect(set.files()[0].imagery?.reason).toBe('privacy_gate')})
 it('bounds missing photos and enriches only when explicitly run after delivery',async()=>{vi.useFakeTimers();const set=setup();await set.tools[0].execute(input,ctx);photos.mockReturnValue(new Promise(()=>{}));const run=set.files()[0].enrichImagery!();await vi.advanceTimersByTimeAsync(12001);await run;expect(update).toHaveBeenCalledTimes(1);expect(set.files()[0].imagery).toMatchObject({page:'fallback',share:'ready',reason:'no_vetted_photo'})})
 it('preserves initial metadata and page on failed enrichment writes',async()=>{const set=setup();await set.tools[0].execute(input,ctx);update.mockRejectedValue(Error('fictional failure'));await set.files()[0].enrichImagery?.();expect(set.files()[0].imagery).toMatchObject({page:'fallback',share:'fallback',metadata:'verified',reason:'enrichment_failed'})})
 it('awaits an in-flight update rather than abandoning it on a write timeout',async()=>{vi.useFakeTimers();const set=setup();await set.tools[0].execute(input,ctx);const d=deferred<void>();update.mockReturnValue(d.promise);let done=false;const run=set.files()[0].enrichImagery!().then(()=>{done=true});await vi.advanceTimersByTimeAsync(20000);expect(done).toBe(false);d.resolve();await run;expect(done).toBe(true)})
 it('records stale final metadata without claiming a verified rich preview',async()=>{const set=setup();await set.tools[0].execute(input,ctx);verify.mockResolvedValue(false);await set.files()[0].enrichImagery?.();expect(set.files()[0].imagery).toMatchObject({metadata:'unverified',reason:'metadata_unverified'})})
 it('does not rerun enrichment or change the immutable answer body',async()=>{const set=setup();await set.tools[0].execute(input,ctx);await set.files()[0].enrichImagery?.();await set.files()[0].enrichImagery?.();expect(photos).toHaveBeenCalledTimes(1);expect(set.files()[0].markdown).toBe(input.body)})
 it('optional read timeouts never become unhandled rejections',async()=>{vi.useFakeTimers();const d=deferred<string>();const r=optionalWithin(d.promise,500,'fallback');await vi.advanceTimersByTimeAsync(501);expect(await r).toBe('fallback');d.resolve('late');expect(await r).toBe('fallback')})
})
describe('served metadata verification',()=>{
 it('requires assigned HTTPS host, matching final image and title metadata',async()=>{const {verifyShareMetadata:real}=await vi.importActual<typeof import('@/lib/files/imagery')>('@/lib/files/imagery');vi.stubGlobal('fetch',vi.fn(async()=>new Response('<meta property="og:title" content="Harbor"><meta property="og:image" content="https://harbor-imagery.here.now/og.png">')));expect(await real(site,'https://harbor-imagery.here.now/og.png')).toBe(true);expect(await real(site,'https://wrong.test/og.png')).toBe(false);expect(await real({...site,url:'https://other.test/'},null)).toBe(false)})
 it('accepts an explicit no-image fallback and rejects an unverifiable source',async()=>{const {verifyShareMetadata:real}=await vi.importActual<typeof import('@/lib/files/imagery')>('@/lib/files/imagery');vi.stubGlobal('fetch',vi.fn(async()=>new Response('<meta property="og:title" content="Harbor">')));expect(await real(site,null)).toBe(true);vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('fictional network error')}));expect(await real(site,null)).toBe(false)})
})
