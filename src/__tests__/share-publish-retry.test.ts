import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
vi.mock('@/lib/data-portability/erasure-state',()=>({assertAccountActive:vi.fn(async()=>{})}))
vi.mock('@/lib/supabase/server',()=>({createServerClient:()=>({})}))
import {publishSite} from '@/lib/files/share'
const files=[{path:'index.html',bytes:Buffer.from('<p>fictional</p>'),contentType:'text/html'},{path:'a.pdf',bytes:Buffer.from('pdf'),contentType:'application/pdf'}]
const opts={title:'Fictional page',userId:'fictional'}
const json=(b:unknown,status=200)=>new Response(JSON.stringify(b),{status})
const created={slug:'fictional-slug',siteUrl:'https://fictional-slug.here.now/',upload:{versionId:'v1',uploads:[{path:'index.html',url:'https://up.test/i'},{path:'a.pdf',url:'https://up.test/p'}]}}
const timeout=()=>Object.assign(new Error('The operation was aborted due to timeout'),{name:'TimeoutError'})
/** Scripted network: key is "METHOD host+path", value is a queue of outcomes. */
function net(script:Record<string,Array<'ok'|'timeout'|number>>){
 const calls:string[]=[]
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
  const u=new URL(url);const key=`${init?.method??'GET'} ${u.host}${u.pathname}`;calls.push(key)
  const out=(script[key]??['ok']).shift()??'ok'
  if(out==='timeout')throw timeout()
  if(typeof out==='number')return new Response('',{status:out})
  if(key.endsWith('/publish'))return json(created)
  return json({})
 }))
 return calls
}
beforeEach(()=>{vi.stubEnv('HERENOW_API_KEY','fictional-key');vi.useFakeTimers()})
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs()})
const run=async(p:Promise<unknown>)=>{const r=p.then(v=>({v}),e=>({e}));await vi.runAllTimersAsync();return r}
describe('hosted publish retries a transient failure once per step',()=>{
 it('publishes on the first try without any retry',async()=>{
  const calls=net({});const r=await run(publishSite(files,opts))
  expect(r).toHaveProperty('v.url','https://fictional-slug.here.now/');expect(calls).toHaveLength(4)
 })
 it('recovers when the create call times out once',async()=>{
  const calls=net({'POST here.now/api/v1/publish':['timeout']});const r=await run(publishSite(files,opts))
  expect(r).toHaveProperty('v.slug','fictional-slug');expect(calls.filter(c=>c==='POST here.now/api/v1/publish')).toHaveLength(2)
 })
 it('recovers when one file upload times out once, without redoing earlier steps',async()=>{
  const calls=net({'PUT up.test/p':['timeout']});const r=await run(publishSite(files,opts))
  expect(r).toHaveProperty('v.slug','fictional-slug')
  expect(calls.filter(c=>c==='POST here.now/api/v1/publish')).toHaveLength(1);expect(calls.filter(c=>c==='PUT up.test/i')).toHaveLength(1);expect(calls.filter(c=>c==='PUT up.test/p')).toHaveLength(2)
 })
 it('recovers from a 503 on finalize',async()=>{
  net({'POST here.now/api/v1/publish/fictional-slug/finalize':[503]});expect(await run(publishSite(files,opts))).toHaveProperty('v.slug','fictional-slug')
 })
 it('gives up after the single retry and names the failing step',async()=>{
  const calls=net({'PUT up.test/p':['timeout','timeout','timeout']});const r=await run(publishSite(files,opts)) as {e:Error}
  expect(r.e.message).toMatch(/upload a\.pdf failed \(attempt 2\): timeout/);expect(calls.filter(c=>c==='PUT up.test/p')).toHaveLength(2)
 })
 it('does not retry a client error',async()=>{
  const calls=net({'POST here.now/api/v1/publish':[401]});const r=await run(publishSite(files,opts)) as {e:Error}
  expect(r.e.message).toMatch(/create failed \(attempt 1\).*401/);expect(calls).toHaveLength(1)
 })
 it('stops retrying once the total budget is spent',async()=>{
  // every call hangs to its own 15s limit: create(15s) + retry(15s) + 15s leaves < 5s, so no third try anywhere
  const slow=vi.fn(async()=>{await new Promise(r=>setTimeout(r,15_000));throw timeout()});vi.stubGlobal('fetch',slow)
  const r=await run(publishSite(files,opts)) as {e:Error}
  expect(r.e.message).toMatch(/create failed/);expect(slow.mock.calls.length).toBeLessThanOrEqual(3)
 })
})
