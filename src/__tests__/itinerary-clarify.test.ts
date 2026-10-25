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
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.clearAllMocks()})
// All inputs fictional. The model is mocked: these tests prove the wiring (the first call may ask, nothing is promised or published
// before the model decides to work, nothing is gated on a place-name lookup), not live model judgment.
const ctx={userId:'',telegramId:0,telegramChatId:0,name:'Synthetic test',timezone:'UTC',tokens:{}}
const call=(name:string,args:unknown)=>new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:'1',function:{name,arguments:JSON.stringify(args)}}]}}]}))
async function turn(ask:string,firstCall:Response){
 vi.stubEnv('TAVILY_API_KEY','fictional-key')
 const files=fileToolsFor(),stages:string[]=[],gateway:any[]=[];let commits=0,outside=0
 vi.stubGlobal('fetch',vi.fn(async(u:any,init:any)=>{
  const url=String(u)
  if(url==='https://api.tavily.com/search'){outside++;return new Response(JSON.stringify({results:[{title:'Fictional listings',url:'https://harbor.test/v',content:'Listings.'}]}))}
  if(url==='https://harbor.test/v'){outside++;return new Response('<html><title>Harbor</title><body>Harbor Inn rooms.</body></html>')}
  const b=JSON.parse(init.body);if(b.max_tokens===8)return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'yes'}}]}))
  gateway.push(b)
  return gateway.length===1?firstCall:call('web_search',{query:'fictional harbor listings'})
 }))
 const tools=gateTools([...toolsFor(ctx),...files.tools],[ask]).active
 const result=await Promise.race([chatWithTools([{role:'user',content:ask}],{gatewayUrl:'https://gateway.test',apiKey:'fictional',model:'auto',deadlineAt:Date.now()+20_000,onCommit:async()=>{commits++},onStage:async(_s,d)=>{if(d)stages.push(d)}},tools,ctx),new Promise<never>((_,r)=>setTimeout(()=>r(new Error('hung')),15000))]).catch(e=>({reply:String(e.message),deliverable:undefined as any}))
 return {result,stages,files,gateway,commits,outside}
}
const itineraryAsk='Make an itinerary for fictional founders visiting Harbor on Friday. Hotel and restaurant recommendations and weekend activities.'
it.each([
 ['unclear destination','Which place do you mean? I could not tell the destination from your message.'],
 ['dates that disagree','You wrote Sunday the 16th, but the 16th is a different weekday. Which date do you mean?'],
])('%s: the first model call may ask one question; no promise, no search, no file, honest unfulfilled state',async(_n,q)=>{
 const t=await turn(itineraryAsk,call('ask_clarifying_question',{question:q}))
 expect(t.result.reply).toBe(q.slice(0,q.indexOf('?')+1))
 expect(t.result.deliverable?.state).toBe('unfulfilled')
 expect(t.commits).toBe(0);expect(t.outside).toBe(0);expect(published).not.toHaveBeenCalled();expect(t.files.files()).toHaveLength(0)
 expect(t.gateway).toHaveLength(1);expect(t.stages).toContain('itinerary:clarification_asked')
 expect(t.gateway[0].tools.map((x:any)=>x.function.name)).toContain('ask_clarifying_question')
 expect(t.gateway[0].tool_choice).toBe('required')
})
it('a request the model can act on proceeds to real research, the work is committed once, and the question tool is only offered on the first call',async()=>{
 const t=await turn(itineraryAsk,call('web_search',{query:'fictional harbor listings'}))
 expect(t.commits).toBe(1);expect(t.outside).toBeGreaterThan(0)
 expect(t.stages).not.toContain('itinerary:clarification_asked')
 for(const g of t.gateway.slice(1))expect(g.tools.map((x:any)=>x.function.name)).not.toContain('ask_clarifying_question')
})
it('a non-geographic destination (a venue name) is never gated on a place lookup: the model decides, research runs',async()=>{
 const t=await turn('Make an itinerary for a visit to the fictional Harbor Inn Conference Center on Friday. Hotel and restaurant recommendations.',call('web_search',{query:'fictional conference center listings'}))
 expect(t.commits).toBe(1);expect(t.stages).not.toContain('itinerary:clarification_asked');expect(t.outside).toBeGreaterThan(0)
})
it('an empty or malformed question is not turned into a reply: the turn continues to the work',async()=>{
 const t=await turn(itineraryAsk,call('ask_clarifying_question',{question:'   '}))
 expect(t.stages).not.toContain('itinerary:clarification_asked');expect(t.result.reply).not.toBe('')
})
const text=(content:string)=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content}}]}))
it('a gateway that ignores tool_choice and answers with one short plain-text question: the question is kept, not swallowed or turned into an empty artifact',async()=>{
 const q='Which place do you mean by the destination you typed? I will start once I know.'
 const t=await turn(itineraryAsk,text(q))
 expect(t.result.reply).toBe('Which place do you mean by the destination you typed?')
 expect(t.result.deliverable?.state).toBe('unfulfilled');expect(t.commits).toBe(0);expect(t.outside).toBe(0);expect(published).not.toHaveBeenCalled();expect(t.files.files()).toHaveLength(0)
})
it('a long multi-question tool argument is cut to one short question',async()=>{
 const t=await turn(itineraryAsk,call('ask_clarifying_question',{question:'Where exactly? And when do you land? '+'x'.repeat(500)}))
 expect(t.result.reply).toBe('Where exactly?')
})
it('the acknowledgement fires only on real work: an empty question does not commit by itself, and the work that follows does commit once',async()=>{
 const t=await turn(itineraryAsk,call('ask_clarifying_question',{question:' '}))
 expect(t.commits).toBe(1);expect(t.stages).not.toContain('itinerary:clarification_asked')
})
