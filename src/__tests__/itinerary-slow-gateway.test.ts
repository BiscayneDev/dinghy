import * as React from 'react'
;(globalThis as unknown as {React:unknown}).React=React
import {afterEach,expect,it,vi} from 'vitest'
const {published}=vi.hoisted(()=>({published:vi.fn()}))
vi.mock('@/lib/files/share',()=>({shareEnabled:()=>true,publishSite:published,revokeSite:vi.fn(),updateSite:vi.fn()}))
vi.mock('@/lib/files/imagery',async orig=>({...await orig<typeof import('@/lib/files/imagery')>(),verifyShareMetadata:async()=>true}))
vi.mock('@/lib/supabase/server',()=>({createServerClient:()=>({})}))
vi.mock('@/lib/data-portability/erasure-state',()=>({assertAccountActive:async()=>{}}))
import {toolsFor} from '@/lib/spectrum/imessage-tools'
import {gateTools} from '@/lib/spectrum/tool-gating'
import {chatWithTools} from '@/lib/spectrum/dinghy'
import {fileToolsFor} from '@/lib/files/tool'
const lineOf=(req:any,nm:string)=>{const sys=req.messages.find((m:any)=>m.role==='system'&&String(m.content).startsWith('Candidate lines'));const l=String(sys?.content).split('\n').find((x:string)=>/^L\d+ \| /.test(x)&&x.split(' | ')[1]===nm);return l?Number(l.split(' ')[0].slice(1)):9999}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();vi.clearAllMocks()})
// Fictional regression of the Oct 25 live run: model calls took 28s (ok) then exceeded the old fixed 25s cap twice
// while ~200s of the 240s itinerary budget remained, so a researched trip was published as an empty "unverified" page.
const baseAsk='Make an itinerary for fictional founders visiting Harbor on Friday. Office visit10am then working sessions, hotel and restaurant recommendations and weekend activities.'
const noAgendaAsk='Make an itinerary for fictional founders visiting Harbor on Friday. Hotel and restaurant recommendations and weekend activities.'
async function run(slowCalls:number[],SLOW_MS=40_000,ask=baseAsk){
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date']})
 vi.stubEnv('TAVILY_API_KEY','fictional-key')
 const url='https://harbor.test/visitors'
 const ctx={userId:'',telegramId:0,telegramChatId:0,name:'Synthetic test',timezone:'UTC',tokens:{}}
 const files=fileToolsFor(),stages:string[]=[],requests:any[]=[]
 published.mockResolvedValue({url:'https://fictional-slow.here.now/',slug:'fictional-slow',expiresAt:'2030-06-11T00:00:00Z'})
 const body='## Friday\n- 10:00 User supplied office visit.\n## Weekend\nPlans to confirm.'
 vi.stubGlobal('fetch',vi.fn(async(u,init)=>{
  if(String(u)==='https://api.tavily.com/search')return new Response(JSON.stringify({results:[{title:'Harbor public visitors',url,content:'Hotel, dining and museum public listings.'}]}))
  if(String(u)===url)return new Response('<html><title>Harbor public visitors</title><body>Harbor Inn rooms. Harbor Cafe dinner. Harbor Museum tickets. Rooms $200. Menu served. Hours, prices and availability unverified.</body></html>')
  const req=JSON.parse(init.body)
  if(req.max_tokens===8)return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'yes'}}]}))
  requests.push(req);const n=requests.length
  if(slowCalls.includes(n))await new Promise<void>((res,rej)=>{const t=setTimeout(res,SLOW_MS);init.signal?.addEventListener('abort',()=>{clearTimeout(t);rej(new DOMException('aborted','AbortError'))})})
  const name=n===1?'web_search':n<=3?'select_itinerary_candidates':'create_file'
  const args=name==='web_search'?{query:'Harbor official visitor listings'}:name==='select_itinerary_candidates'?{candidates:(n===2?[['hotel','Harbor Inn']]:[['restaurant','Harbor Cafe'],['activity','Harbor Museum']]).map(([kind,nm])=>({kind,line:lineOf(req,nm as string)}))}:{title:'Synthetic Harbor itinerary',body,format:'pdf',kind:'itinerary'}
  return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:String(n),function:{name,arguments:JSON.stringify(args)}}]}}]}))
 }))
 const tools=gateTools([...toolsFor(ctx),...files.tools],[ask]).active
 const p=chatWithTools([{role:'user',content:ask}],{gatewayUrl:'https://gateway.test',apiKey:'fictional',model:'auto',deadlineAt:Date.now()+240_000,onStage:async(_s,d)=>{if(d)stages.push(d)}},tools,ctx)
 for(let i=0;i<60;i++)await vi.advanceTimersByTimeAsync(5_000)
 return {result:await p,stages,files}
}
it('a model call that takes 40s (slower than the old 25s cap, far inside the turn budget) still yields the researched itinerary',async()=>{
 const {result,stages,files}=await run([2])
 expect(stages).not.toContain('itinerary:agenda_only_fallback')
 expect(stages).not.toContain('itinerary:gateway_retry')
 expect(result.deliverable?.state).toBe('completed')
 expect(published).toHaveBeenCalledTimes(1)
 expect(files.files()[0].markdown).not.toContain('Recommendations not verified')
})
it('two consecutive 40s calls both fit the window and research is kept',async()=>{
 const {result,stages}=await run([2,2])
 expect(stages).not.toContain('itinerary:agenda_only_fallback')
 expect(result.deliverable?.state).toBe('completed')
})
it('if every model call after research truly stalls, the reply is honest text with the ask and sources, never an empty page presented as done',async()=>{
 const {result,stages,files}=await run([2,3,4,5,6],200_000,noAgendaAsk)
 expect(stages).toContain('itinerary:gateway_retry')
 expect(stages).toContain('itinerary:no_agenda_content')
 expect(stages).not.toContain('itinerary:agenda_only_fallback')
 expect(files.files()).toHaveLength(0);expect(published).not.toHaveBeenCalled()
 expect(result.deliverable?.state).toBe('unfulfilled')
 expect(result.reply).toContain("I couldn't finish researching this trip")
 expect(result.reply).toContain('Harbor')
 expect(result.reply).toContain('https://harbor.test/visitors')
})
