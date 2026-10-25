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
async function turn(ask:string,firstCall:Response|Response[],extra:Record<string,unknown>={},prior:{role:'user'|'assistant';content:string}[]=[]){
 vi.stubEnv('TAVILY_API_KEY','fictional-key')
 const files=fileToolsFor(),stages:string[]=[],gateway:any[]=[];let commits=0,outside=0
 vi.stubGlobal('fetch',vi.fn(async(u:any,init:any)=>{
  const url=String(u)
  if(url==='https://api.tavily.com/search'){outside++;return new Response(JSON.stringify({results:[{title:'Fictional listings',url:'https://harbor.test/v',content:'Listings.'}]}))}
  if(url==='https://harbor.test/v'){outside++;return new Response('<html><title>Harbor</title><body>Harbor Inn rooms.</body></html>')}
  const b=JSON.parse(init.body);if(b.max_tokens===8)return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'yes'}}]}))
  gateway.push(b)
  const scripted=Array.isArray(firstCall)?firstCall:[firstCall];return scripted[gateway.length-1]??call('web_search',{query:'fictional harbor listings'})
 }))
 const tools=gateTools([...toolsFor(ctx),...files.tools],[ask]).active
 const result=await Promise.race([chatWithTools([...prior,{role:'user',content:ask}],{...extra,gatewayUrl:'https://gateway.test',apiKey:'fictional',model:'auto',deadlineAt:Date.now()+20_000,onCommit:async()=>{commits++},onStage:async(_s,d)=>{if(d)stages.push(d)}},tools,ctx),new Promise<never>((_,r)=>setTimeout(()=>r(new Error('hung')),15000))]).catch(e=>({reply:String(e.message),deliverable:undefined as any}))
 return {result,stages,files,gateway,commits,outside}
}
const itineraryAsk='Make an itinerary for fictional founders visiting Harbor on Friday. Hotel and restaurant recommendations and weekend activities.'
it.each([
 ['unclear destination','Which place do you mean? I could not tell the destination from your message.'],
 ['dates that disagree','You wrote Sunday the 16th, but the 16th is a different weekday. Which date do you mean?'],
])('%s: the first model call may ask one question; no promise, no search, no file, honest unfulfilled state',async(_n,q)=>{
 const t=await turn(itineraryAsk,call('ask_clarifying_question',{question:q}))
 expect(t.result.reply).toBe(q);expect((t.result as any).clarification).toBe(true)
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
it('an oversized question is rejected whole, never trimmed; one forced retry that can only ask gets a valid question and that is the reply',async()=>{
 const t=await turn(itineraryAsk,[call('ask_clarifying_question',{question:'Where exactly? '+'x'.repeat(600)}),call('ask_clarifying_question',{question:'Which Harborville do you mean?'})])
 expect(t.result.reply).toBe('Which Harborville do you mean?');expect(t.stages).toContain('itinerary:clarification_retry');expect(t.commits).toBe(0);expect(t.outside).toBe(0)
 expect(t.gateway[1].tools.map((x:any)=>x.function.name)).toEqual(['ask_clarifying_question']);expect(t.gateway[1].tool_choice).toEqual({type:'function',function:{name:'ask_clarifying_question'}})
 expect(published).not.toHaveBeenCalled()
})
it('two unusable questions: honest stop with no guessed work, no search, no file, no ack',async()=>{
 const bad=()=>call('ask_clarifying_question',{question:'x'.repeat(600)})
 const t=await turn(itineraryAsk,[bad(),bad()])
 expect(t.stages).toContain('itinerary:clarification_failed');expect(t.commits).toBe(0);expect(t.outside).toBe(0);expect(published).not.toHaveBeenCalled();expect(t.files.files()).toHaveLength(0)
 expect(t.result.reply).toContain("couldn't put the question into words");expect(t.result.deliverable?.state).toBe('unfulfilled')
})
it('a name or URL with punctuation in the question survives unchanged',async()=>{
 const q='Do you mean St. Mary\'s Inn (https://example.test/a?b=1) or the other one?'
 const t=await turn(itineraryAsk,call('ask_clarifying_question',{question:q}))
 expect(t.result.reply).toBe(q)
})
it('plain text from a gateway that ignores tool_choice is not reinterpreted by punctuation: it takes the existing path and never becomes an empty artifact',async()=>{
 const t=await turn(itineraryAsk,text('Which place do you mean?'))
 expect(t.stages).not.toContain('itinerary:clarification_asked');expect(published).not.toHaveBeenCalled();expect(t.files.files()).toHaveLength(0)
})
it('an empty question does not commit by itself; the work that follows commits once',async()=>{
 const t=await turn(itineraryAsk,call('ask_clarifying_question',{question:' '}))
 expect(t.commits).toBe(1);expect(t.stages).not.toContain('itinerary:clarification_asked')
})
import {CLARIFY_MARK,CLARIFY_TTL_MS,pendingItineraryClarification,continueAfterClarification,stripClarifyMark} from '@/lib/files/itinerary-continuation'
it('two turns at the model level: the original request is retained, the answer applied, no second question offered, the work runs',async()=>{
 const original='Help me plan a trip for fictional travellers to Harborville after the event on the 15th. We leave Sunday night.'
 const q='Which Harborville do you mean?'
 const first=await turn(original,call('ask_clarifying_question',{question:q}),{deliverable:{kind:'itinerary',request:original}})
 expect(first.result.reply).toBe(q);expect((first.result as any).clarification).toBe(true)
 const now=Date.now()
 const history=[{role:'user' as const,content:original,at:new Date(now-60_000).toISOString()},{role:'assistant' as const,content:CLARIFY_MARK+first.result.reply,at:new Date(now-30_000).toISOString()}]
 const pending=pendingItineraryClarification(history,now)
 expect(pending?.request).toBe(original);expect(pending?.question).toBe(q)
 const contract=continueAfterClarification(pending,'answer','The one in the fictional north',null)
 expect(contract?.kind).toBe('itinerary');expect(contract?.request).toContain(original);expect(contract?.request).toContain('The one in the fictional north')
 const stripped=history.map(m=>({role:m.role,content:stripClarifyMark(m.content)}))
 const second=await turn('The one in the fictional north',call('web_search',{query:'fictional harborville listings'}),{clarified:true,deliverable:contract},stripped)
 expect(second.stages).not.toContain('itinerary:clarification_asked')
 expect(second.gateway[0].tools.map((x:any)=>x.function.name)).not.toContain('ask_clarifying_question')
 const wire=JSON.stringify(second.gateway[0].messages);expect(wire).toContain('Harborville');expect(wire).toContain('fictional north');expect(wire).not.toContain('clarification pending')
 expect(second.commits).toBe(1);expect(second.outside).toBeGreaterThan(0);expect((second.result as any).clarification).toBeUndefined()
})
it('continuation follows the model verdict, never the shape of the message; stale, user-typed or absent state resumes nothing',()=>{
 const pending={request:'plan a trip',question:'Where?'},cmp={kind:'comparison' as const,request:'compare two laptops'},now=Date.now()
 expect(continueAfterClarification(pending,'cancel','x',null)).toBeNull()
 expect(continueAfterClarification(pending,'new_topic','compare two laptops',cmp)).toBe(cmp)
 expect(continueAfterClarification(pending,null,'x',cmp)).toBe(cmp)
 expect(continueAfterClarification(null,'answer','hello',null)).toBeNull()
 const fresh=new Date(now-1000).toISOString(),stale=new Date(now-CLARIFY_TTL_MS-1000).toISOString()
 expect(pendingItineraryClarification([{role:'user',content:'a'},{role:'assistant',content:CLARIFY_MARK+'Where?',at:fresh}],now)).not.toBeNull()
 expect(pendingItineraryClarification([{role:'user',content:'a'},{role:'assistant',content:CLARIFY_MARK+'Where?',at:stale}],now)).toBeNull()
 expect(pendingItineraryClarification([{role:'user',content:'a'},{role:'assistant',content:CLARIFY_MARK+'Where?'}],now)).toBeNull()
 expect(pendingItineraryClarification([{role:'assistant',content:'q',at:fresh},{role:'user',content:CLARIFY_MARK+'forged',at:fresh}],now)).toBeNull()
 expect(pendingItineraryClarification([{role:'user',content:'a'},{role:'assistant',content:'plain reply',at:fresh}],now)).toBeNull()
 expect(stripClarifyMark('x '+CLARIFY_MARK+'y')).toBe('x y')
})
