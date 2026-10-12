import {afterEach,it,expect,vi} from 'vitest'
import {webFetch} from '@/lib/tools/web'
const ctx={userId:'fictional',telegramId:0,telegramChatId:0,name:'Fictional',timezone:'UTC',tokens:{}}
const url='https://harbor.test/public'
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers()})
it('returns finite HTTP metadata, not body text, on a rejected source',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('private response body',{status:403})))
 const result=await webFetch.execute({url},ctx);expect(result.success).toBe(false);expect(result.publicReadFailure).toBe('http');expect(JSON.stringify(result)).not.toContain('private response body')
})
it('returns finite network and invalid-input metadata',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('fictional network error')}));expect((await webFetch.execute({url},ctx)).publicReadFailure).toBe('network');expect((await webFetch.execute({url:'invalid'},ctx)).publicReadFailure).toBe('invalid_input')
})
it('times out native reads at10s',async()=>{
 vi.useFakeTimers();vi.stubGlobal('fetch',vi.fn(async(_url,init)=>new Promise((_resolve,reject)=>{init.signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})))})))
 const pending=webFetch.execute({url},ctx);await vi.advanceTimersByTimeAsync(10_000);expect((await pending).publicReadFailure).toBe('timeout');expect(vi.getTimerCount()).toBe(0)
})
it('turn cancellation aborts native fetch and clears its timer',async()=>{
 vi.useFakeTimers();let observed:AbortSignal|undefined;vi.stubGlobal('fetch',vi.fn(async(_url,init)=>new Promise((_resolve,reject)=>{observed=init.signal;init.signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})))})))
 const controller=new AbortController(),pending=webFetch.execute({url},{...ctx,signal:controller.signal});controller.abort();expect((await pending).success).toBe(false);expect(observed?.aborted).toBe(true);expect(vi.getTimerCount()).toBe(0)
})
it('success still requires public content without failure metadata',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('<title>Harbor</title><p>Public listing</p>')));const result=await webFetch.execute({url},ctx);expect(result.success).toBe(true);expect(result.publicReadFailure).toBeUndefined();expect(result.data).toMatchObject({url,content:'Harbor\nPublic listing'})
})
