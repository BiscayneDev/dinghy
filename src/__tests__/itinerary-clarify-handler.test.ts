import {afterEach,beforeEach,expect,it,vi} from 'vitest'
// Two-turn handler regression, all fictional. Persistence, sends and the gateway are in-memory; the handler and chatWithTools are real.
const state=vi.hoisted(()=>({messages:[] as {role:string;content:string}[],sent:[] as string[],chatCalls:[] as any[]}))
vi.mock('@/lib/supabase/server',()=>{const chain:any=new Proxy(function(){},{get:(_t,k)=>k==='then'?(r:any)=>r({data:[],error:null,count:0}):chain,apply:()=>chain});return {createServerClient:()=>chain}})
vi.mock('@/spectrum/store',async orig=>({...await orig<any>(),ensureIdentity:async()=>{},isGoogleConnected:async()=>false,isPayboxConnected:async()=>false,isGithubConnected:async()=>false,isHealthConnected:async()=>false,loadFacts:async()=>[],loadHistory:async()=>state.messages.map(m=>({...m})),saveMessage:async(_g:string,role:string,content:string)=>{state.messages.push({role,content})},saveMessageReturningId:async()=>'id',updateMessageContent:async()=>{},createConnectLink:async()=>'https://x.test'}))
vi.mock('@/lib/spectrum/beta-gate',async orig=>({...await orig<any>(),getBetaRole:async()=>'owner'}))
vi.mock('@/lib/spectrum/outbox',async orig=>({...await orig<any>(),claimInboundDelivery:async()=>true,enqueueOutbox:async()=>'o',markOutboxSent:async()=>{},markOutboxFailed:async()=>{}}))
vi.mock('@/lib/data-portability/erasure-state',async orig=>({...await orig<any>(),assertAccountActive:async()=>{},erasureEnabled:()=>false,isEraseIntent:()=>false}))
vi.mock('@/lib/allowance',async orig=>({...await orig<any>(),allowanceUsedUpMessage:()=>'',claimLimitNotice:async()=>false,isOverDailyAllowance:async()=>({over:false})}))
vi.mock('@/lib/spectrum/rate-limit',async orig=>({...await orig<any>(),hitRateLimit:async()=>false}))
vi.mock('@/lib/spectrum/metering',async orig=>({...await orig<any>(),recordUsage:async()=>{}}))
vi.mock('@/lib/spectrum/memory',async orig=>({...await orig<any>(),loadMemoryContext:async()=>({profile:'known',summaries:[],facts:[],plans:[],files:[]}),updateMemory:async()=>{}}))
vi.mock('@/lib/spectrum/active-run',async orig=>({...await orig<any>(),earlierUserText:()=>'',loadActiveRuns:async()=>[],steerNote:()=>''}))
vi.mock('@/lib/spectrum/actions',async orig=>({...await orig<any>(),hasPendingAction:async()=>false,cancelPendingActions:async()=>0,takeLooseProposal:()=>null}))
vi.mock('@/lib/spectrum/memory-commands',async orig=>({...await orig<any>(),handlePendingMemoryWipe:async()=>null}))
vi.mock('@/lib/spectrum/run-stage',async orig=>({...await orig<any>(),runStageRecorder:()=>async()=>{}}))
vi.mock('@/lib/spectrum/config',async orig=>({...await orig<any>(),SHIPYARD_API_KEY:'fictional',GATEWAY_URL:'https://gateway.test',SHIPYARD_MODEL:'auto'}))
vi.mock('@/lib/spectrum/dinghy',async orig=>{const m=await orig<any>();return {...m,chatWithTools:(h:any,o:any,t:any,c:any)=>{state.chatCalls.push({history:h,opts:o});return m.chatWithTools(h,o,t,c)}}})
import {handleSpectrumMessage} from '@/lib/spectrum/handler'
const call=(name:string,args:unknown)=>new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:'1',function:{name,arguments:JSON.stringify(args)}}]}}]}))
const stop=(c:string)=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:c}}]}))
let gateway:any[]=[]
beforeEach(()=>{state.messages=[];state.sent=[];state.chatCalls=[];gateway=[]})
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()})
const space={id:'any;-;+15550000000',send:async(t:any)=>{state.sent.push(t)}}
const texts=()=>state.sent.filter((x:any)=>typeof x==='string') as string[]
const inbound=(id:string,text:string)=>({id,direction:'inbound',content:{type:'text',text},sender:{handle:'+15550000000'},timestamp:new Date()}) as any
it('question, bare answer, original task: request retained, answer applied, no re-ask, no ack before the decision, no empty completion',async()=>{
 vi.stubEnv('TAVILY_API_KEY','fictional-key')
 const original='Help me plan an itinerary for fictional travellers to Harborville after the event on the 15th. Hotel and restaurant recommendations please.'
 vi.stubGlobal('fetch',vi.fn(async(u:any,init:any)=>{
  const url=String(u)
  if(url.includes('tavily'))return new Response(JSON.stringify({results:[{title:'Fictional listings',url:'https://harbor.test/v',content:'Listings.'}]}))
  if(url==='https://harbor.test/v')return new Response('<html><title>Harbor</title><body>Harbor Inn rooms.</body></html>')
  if(!url.includes('gateway.test'))return new Response('{}')
  const b=JSON.parse(init.body);gateway.push(b)
  const names=(b.tools??[]).map((t:any)=>t.function.name)
  if(b.max_tokens===8)return stop('yes')
  if(names.includes('ask_clarifying_question')&&gateway.filter(g=>(g.tools??[]).some((t:any)=>t.function.name==='ask_clarifying_question')).length===1)return call('ask_clarifying_question',{question:'Which Harborville do you mean?'})
  return call('web_search',{query:'fictional harborville listings'})
 }))
 await handleSpectrumMessage(space,inbound('m1',original))
 expect(texts()).toEqual(['Which Harborville do you mean?'])           // no "putting it together" promise before the question
 expect(state.messages.at(-1)!.content.startsWith('[itinerary clarification pending] ')).toBe(true)
 expect(state.chatCalls[0].opts.onCommit).toBeTypeOf('function')
 state.sent.length=0
 await handleSpectrumMessage(space,inbound('m2','The one in the fictional north'))
 const second=state.chatCalls[1]
 expect(second.opts.clarified).toBe(true)
 expect(second.opts.deliverable?.kind).toBe('itinerary')
 expect(second.opts.deliverable.request).toContain(original);expect(second.opts.deliverable.request).toContain('fictional north')
 expect(JSON.stringify(second.history)).not.toContain('[itinerary clarification pending]')
 expect(texts()[0]).toBe('I am putting the itinerary together. I will send it here when it is ready.') // ack only now that the work starts
 expect(texts().filter(t=>t.includes('Which Harborville')).length).toBe(0)  // no re-ask
 // The mock model only searches, so the turn ends in the honest failure path: text, never an empty artifact presented as done.
 expect(texts().every(t=>t.trim().length>0)).toBe(true);expect(texts().join('\n')).not.toMatch(/agenda is attached|Unverified itinerary/)
 const secondGateway=gateway.filter(g=>g.max_tokens!==8).slice(1)
 for(const g of secondGateway)expect((g.tools??[]).map((t:any)=>t.function.name)).not.toContain('ask_clarifying_question')
})
