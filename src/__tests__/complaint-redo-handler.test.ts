import {afterEach,beforeEach,expect,it,vi} from 'vitest'
// Two-turn handler regression, all fictional. Persistence, sends and the gateway are in-memory; the handler and chatWithTools are real.
const state=vi.hoisted(()=>({messages:[] as {role:string;content:string;at?:string}[],sent:[] as string[],chatCalls:[] as any[],stages:[] as string[],verdict:'answer' as string|null,claims:new Set<string>(),freeze:null as any,decisions:0,now:Date.now(),verdict2:'itinerary' as string|null}))
const {published}=vi.hoisted(()=>({published:vi.fn()}))
vi.mock('@/lib/files/share',()=>({shareEnabled:()=>true,publishSite:published,revokeSite:vi.fn(),updateSite:vi.fn()}))
vi.mock('@/lib/files/imagery',async orig=>({...await orig<any>(),verifyShareMetadata:async()=>true}))
vi.mock('@/lib/supabase/server',()=>{const L=(globalThis as any);L.__locks=L.__locks??new Map();const mk=(table:string)=>{let px:any;const f:any={op:'select',eq:[] as any[]};const b:any={select:()=>px,delete:()=>{f.op='delete';return px},eq:(k:string,v:any)=>{f.eq.push([k,v]);return px},like:(k:string,v:string)=>{f.like=[k,v];return px},then:(r:any,j:any)=>{const locks=L.__locks as Map<string,any>;if(table==='spectrum_messages'&&f.like){const pre=String(f.like[1]).split('%')[0];const rows=((L.__state?.messages??[]) as any[]).filter(m=>m.role==='assistant'&&String(m.content).startsWith(pre)).reverse().map(m=>({content:m.content}));return Promise.resolve({data:rows,error:null}).then(r,j)}if(table==='spectrum_inbound_dedupe'&&f.op==='select'&&f.like){const re=new RegExp('^'+String(f.like[1]).replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/%/g,'.*')+'$');return Promise.resolve({data:[...locks.keys()].filter(k=>re.test(k)).map(k=>({message_id:k})),error:null}).then(r,j)}if(table==='spectrum_inbound_dedupe'){const key=f.eq.find((e:any)=>e[0]==='message_id')?.[1];if(f.op==='select'){if(L.__failRead)return Promise.resolve({data:null,error:{message:'x'}}).then(r,j);const v=locks.get(key);return Promise.resolve({data:v?[v]:[],error:null}).then(r,j)}const cid=f.eq.find((e:any)=>e[0]==='claim_id')?.[1];const v=locks.get(key);if(v&&(!cid||v.claim_id===cid))locks.delete(key);return Promise.resolve({data:null,error:null}).then(r,j)}return Promise.resolve({data:[],error:null,count:0}).then(r,j)}};px=new Proxy(b,{get:(t,k)=>k in t?t[k]:()=>px});return px};return {createServerClient:()=>({from:(t:string)=>mk(t),rpc:(name:string,a:any)=>{const locks=L.__locks as Map<string,any>;if(L.__failClaim)return Promise.resolve({data:null,error:{message:'down'}});if(name==='claim_inbound_delivery'&&a.p_message_id.startsWith('redo-')){if(locks.has(a.p_message_id))return Promise.resolve({data:false,error:null});locks.set(a.p_message_id,{claim_id:a.p_claim_id,received_at:new Date().toISOString()});return Promise.resolve({data:true,error:null})}return Promise.resolve({data:false,error:null})}})}})
vi.mock('@/spectrum/store',async orig=>({...await orig<any>(),ensureIdentity:async()=>{},isGoogleConnected:async()=>false,isPayboxConnected:async()=>false,isGithubConnected:async()=>false,isHealthConnected:async()=>false,loadFacts:async()=>[],loadHistory:async()=>(state.freeze??state.messages).map((m:any)=>({...m})),saveMessage:async(_g:string,role:string,content:string)=>{state.messages.push({role,content,at:new Date().toISOString()})},saveMessageReturningId:async()=>'id',updateMessageContent:async()=>{},createConnectLink:async()=>'https://x.test'}))
vi.mock('@/lib/spectrum/beta-gate',async orig=>({...await orig<any>(),getBetaRole:async()=>'owner'}))
vi.mock('@/lib/spectrum/outbox',async orig=>({...await orig<any>(),claimInboundDelivery:async(id:string)=>{if(state.claims.has(id))return false;state.claims.add(id);return true},enqueueOutbox:async()=>'o',markOutboxSent:async()=>{},markOutboxFailed:async()=>{}}))
vi.mock('@/lib/data-portability/erasure-state',async orig=>({...await orig<any>(),assertAccountActive:async()=>{},erasureEnabled:()=>false,isEraseIntent:()=>false}))
vi.mock('@/lib/allowance',async orig=>({...await orig<any>(),allowanceUsedUpMessage:()=>'',claimLimitNotice:async()=>false,isOverDailyAllowance:async()=>({over:false})}))
vi.mock('@/lib/spectrum/rate-limit',async orig=>({...await orig<any>(),hitRateLimit:async()=>false}))
vi.mock('@/lib/spectrum/metering',async orig=>({...await orig<any>(),recordUsage:async()=>{}}))
vi.mock('@/lib/spectrum/memory',async orig=>({...await orig<any>(),loadMemoryContext:async()=>({profile:'known',summaries:[],facts:[],plans:['Harborville trip · Chose: Stay in Harborville: Harborville Inn [source: user]'],files:[]}),updateMemory:async()=>{}}))
vi.mock('@/lib/spectrum/active-run',async orig=>({...await orig<any>(),earlierUserText:()=>'',loadActiveRuns:async()=>[],steerNote:()=>''}))
vi.mock('@/lib/spectrum/actions',async orig=>({...await orig<any>(),hasPendingAction:async()=>false,cancelPendingActions:async()=>0,takeLooseProposal:()=>null}))
vi.mock('@/lib/spectrum/memory-commands',async orig=>({...await orig<any>(),handlePendingMemoryWipe:async()=>null}))
vi.mock('@/lib/spectrum/run-stage',async orig=>({...await orig<any>(),runStageRecorder:()=>async(_s:string,d?:string)=>{state.stages.push(String(d))}}))
vi.mock('@/lib/spectrum/config',async orig=>({...await orig<any>(),SHIPYARD_API_KEY:'fictional',GATEWAY_URL:'https://gateway.test',SHIPYARD_MODEL:'auto'}))
vi.mock('@/lib/spectrum/dinghy',async orig=>{const m=await orig<any>();return {...m,chatWithTools:(h:any,o:any,t:any,c:any)=>{state.chatCalls.push({history:h,opts:o});return m.chatWithTools(h,o,t,c)}}})
vi.mock('@/lib/spectrum/imessage-tools',async orig=>({...await orig<any>(),loadImessageToolContext:async()=>({userId:'',telegramId:0,telegramChatId:0,name:'Synthetic test',timezone:'UTC',tokens:{}})}))

import {handleSpectrumMessage} from '@/lib/spectrum/handler'
const call=(name:string,args:unknown)=>new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:'1',function:{name,arguments:JSON.stringify(args)}}]}}]}))
const stop=(c:string)=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:c}}]}))
const lineOf=(req:any,nm:string)=>{const sys=req.messages.find((m:any)=>m.role==='system'&&String(m.content).startsWith('Candidate lines'));const l=String(sys?.content).split('\n').find((x:string)=>/^L\d+ \| /.test(x)&&x.split(' | ')[1]===nm);return l?Number(l.split(' | ')[0].slice(1)):0}
let gateway:any[]=[],selects=0
beforeEach(()=>{state.claims=new Set();state.freeze=null;state.messages=[];state.sent=[];state.chatCalls=[];gateway=[];selects=0;state.decisions=0;state.verdict2='redo_itinerary';published.mockReset();published.mockResolvedValue({url:'https://fictional.here.now/',expiresAt:new Date(Date.now()+86400000).toISOString(),files:[]})})
afterEach(()=>{(globalThis as any).__locks=new Map();(globalThis as any).__state=state;(globalThis as any).__noteCalls=0;(globalThis as any).__noteVerdict=undefined;(globalThis as any).__failRead=false;(globalThis as any).__failClaim=false;(globalThis as any).__rejectRedo=false;vi.unstubAllGlobals();vi.unstubAllEnvs()})
const space={id:'any;-;+15550000000',send:async(t:any)=>{state.sent.push(t)}}
const texts=()=>state.sent.filter((x:any)=>typeof x==='string') as string[]
const inbound=(id:string,text:string)=>({id,direction:'inbound',content:{type:'text',text},sender:{handle:'+15550000000'},timestamp:new Date()}) as any
const original='Help me plan an itinerary for fictional travellers to Harborville. Hotel and restaurant recommendations please.'
const delivered=()=>{const now=Date.now();return [{role:'user',content:original,at:new Date(now-9e5).toISOString()},{role:'assistant',content:'The supplied agenda is attached. Recommendations remain unverified.',at:new Date(now-8e5).toISOString()},{role:'assistant',content:'[file: Unverified itinerary] https://empty.here.now/',at:new Date(now-7e5).toISOString()}]}
function install(opts:{searchOnly?:boolean;blank?:boolean;onGateway?:()=>Promise<void>}={}){
 vi.stubEnv('TAVILY_API_KEY','fictional-key')
 vi.stubGlobal('fetch',vi.fn(async(u:any,init:any)=>{
  const url=String(u)
  if(url.includes('tavily'))return new Response(JSON.stringify({results:[{title:'Fictional listings',url:'https://harbor.test/v',content:'Hotel, dining and museum public listings.'}]}))
  if(url==='https://harbor.test/v')return new Response('<html><title>listings</title><body>public listings. Harborville Inn rooms. Harborville Cafe dinner. Harborville Museum tickets. Rooms $200. Menu served. Hours, prices and availability unverified.</body></html>')
  if(url.endsWith('/v1/decisions')&&String(init.body).includes('heldNote')){(globalThis as any).__noteCalls=((globalThis as any).__noteCalls??0)+1;const nv=(globalThis as any).__noteVerdict??'new_instruction';return new Response(JSON.stringify({provider:'jev',model:'jev',answers:{heldNote:{type:'choice',choice:nv,confidence:0.9,probabilities:{repeat:0.05,new_instruction:0.05,stop:0.05,[nv]:0.9}}}}))}
  if(url.endsWith('/v1/decisions')){state.decisions++;if((globalThis as any).__rejectRedo&&String(init.body).includes('redo_'))return new Response('bad',{status:400});if(state.verdict2===null)return new Response('no',{status:500});const v=state.verdict2;return new Response(JSON.stringify({provider:'jev',model:'jev',answers:{deliverable:{type:'choice',choice:v,confidence:0.9,probabilities:{none:0.05,itinerary:0.05,[v]:0.9}}}}))}
  if(!url.includes('gateway.test'))return new Response('{}')
  const b=JSON.parse(init.body);if(b.max_tokens===8)return stop('yes')
  gateway.push(b)
  if(opts.onGateway&&gateway.length===1)await opts.onGateway()
  const names=(b.tools??[]).map((t:any)=>t.function.name)
  const forced=b.tool_choice?.function?.name
  if(opts.blank)return new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:''}}]}))
  if(opts.searchOnly)return call('web_search',{query:'fictional harborville listings'})
  if(forced==='select_itinerary_candidates'){selects++;return call(forced,{candidates:(selects===1?[['hotel','Harborville Inn']]:[['restaurant','Harborville Cafe'],['activity','Harborville Museum']]).map(([kind,nm])=>({kind,line:lineOf(b,nm as string)}))})}
  if(forced==='create_file'||(selects>=2&&names.includes('create_file')))return call('create_file',{title:'Harborville itinerary',body:'## Day 1\n- Arrival.\n## Sunday\n- Evening departure.',format:'pdf',kind:'itinerary'})
  if(forced==='web_search'||forced==='web_fetch')return call('web_search',{query:'fictional harborville listings'})
  return stop('Sent.')
 }))
}
it('"That\'s not good" after an empty page: the model judges it a redo, the original request and settled choice travel, and a researched replacement is published',async()=>{
 install();state.messages=delivered() as any
 await handleSpectrumMessage(space,inbound('c1',"That's not good"))
 expect(state.decisions).toBe(1)
 const c=state.chatCalls[0];expect(c.opts.deliverable.kind).toBe('itinerary')
 expect(c.opts.deliverable.request).toContain(original);expect(c.opts.deliverable.request).toContain("That's not good")
 expect(JSON.stringify(gateway[0])).toContain('Chose: Stay in Harborville: Harborville Inn')
 expect(texts()[0]).toBe('I am putting the itinerary together. I will send it here when it is ready.')
 expect(published).toHaveBeenCalledTimes(1)
 const html=published.mock.calls[0][0].find((f:any)=>f.path==='index.html').bytes.toString()
 if(process.env.REDO_FIXTURE_OUT)(await import('fs')).writeFileSync(process.env.REDO_FIXTURE_OUT,html)
 expect(html).toContain('Harborville Inn');expect(html).toContain('Evening departure')
 expect(texts().join('\n')).not.toMatch(/couldn.t make that file|Ask me again|Unverified itinerary/)
})
it('venting, a question, a cancellation or "don\'t redo" (model says none): no job, no research, normal turn',async()=>{
 install();state.verdict2='none';state.messages=delivered() as any
 await handleSpectrumMessage(space,inbound('c2',"honestly this is trash"))
 expect(state.decisions).toBe(1);expect(state.chatCalls[0]?.opts.deliverable??null).toBeNull();expect(published).not.toHaveBeenCalled()
 expect(texts().join('\n')).not.toContain('putting the itinerary together')
})
it('decision service down: nothing is started on a guess and the turn still answers',async()=>{
 install();state.verdict2=null;state.messages=delivered() as any
 await handleSpectrumMessage(space,inbound('c3',"That's not good"))
 expect(state.decisions).toBe(1);expect(state.chatCalls[0]?.opts.deliverable??null).toBeNull();expect(texts().every(t=>t.trim().length>0)).toBe(true)
})
it('no file delivered recently: no extra decision call at all (thanks and ordinary follow-ups stay free)',async()=>{
 install();state.messages=[{role:'user',content:'hi',at:new Date().toISOString()},{role:'assistant',content:'hello',at:new Date().toISOString()}] as any
 await handleSpectrumMessage(space,inbound('c4',"That's not good"))
 expect(state.decisions).toBe(0)
})
it('keyword matcher already found a deliverable: no follow-up decision, no redo claim',async()=>{
 install();state.messages=delivered() as any
 await handleSpectrumMessage(space,inbound('c5','Make another itinerary for Harborville with hotel and restaurant recommendations'))
 expect(state.decisions).toBe(0);expect([...state.claims].some(k=>k.startsWith('redo:'))).toBe(false)
})
it('two complaints at once start exactly one redo job',async()=>{
 install();state.messages=delivered() as any;state.freeze=[...state.messages]
 await Promise.all([handleSpectrumMessage(space,inbound('d1',"That's not good")),handleSpectrumMessage(space,inbound('d2','What you sent me is bad'))])
 expect(state.decisions).toBe(2);expect(state.chatCalls).toHaveLength(1)
 expect(state.chatCalls.filter(c=>c.opts.deliverable?.kind==='itinerary')).toHaveLength(1)
 expect(texts().filter(t=>t.includes('just started from another message'))).toHaveLength(1)
 expect(published).toHaveBeenCalledTimes(1);expect(texts().filter(t=>t.includes('putting the itinerary together'))).toHaveLength(1)
})

it('redo that never gets a file (research only, or blank completions): honest reply, nothing published, never the ask-again line',async()=>{
 for(const o of [{searchOnly:true},{blank:true}]){
  state.sent=[];state.chatCalls=[];state.claims=new Set();published.mockReset();install(o);state.messages=delivered() as any
  await handleSpectrumMessage(space,inbound('e'+JSON.stringify(o),"That's not good"))
  expect(published).not.toHaveBeenCalled();expect(texts().length).toBeGreaterThan(0);expect(texts().every(t=>t.trim().length>0)).toBe(true)
  expect(texts().join('\n')).not.toMatch(/Ask me again|couldn.t make that file/)
 }
})

const hoursLater=()=>{const m=delivered() as any[];const ago=(h:number)=>new Date(Date.now()-h*36e5).toISOString();m.forEach((x,i)=>x.at=ago(5-i*0.01));return [...m,{role:'user',content:"That's not good",at:ago(1)},{role:'assistant',content:'I couldn\'t make that file just now. Ask me again in a moment.',at:ago(1)}]}
it('screenshot shape: complaint hours after the file and after an earlier failed complaint still redoes the original request, once',async()=>{
 install();state.messages=hoursLater() as any
 await handleSpectrumMessage(space,inbound('h1','What you sent me is bad'))
 expect(state.decisions).toBe(1);expect(state.chatCalls[0].opts.deliverable.request).toContain(original)
 expect(published).toHaveBeenCalledTimes(1);expect(texts().join('\n')).not.toMatch(/Ask me again/)
})
it('a revision after the replacement was delivered is a new job, not swallowed by the earlier claim',async()=>{
 install();state.messages=delivered() as any
 await handleSpectrumMessage(space,inbound('r1',"That's not good"))
 expect(published).toHaveBeenCalledTimes(1)
 state.messages=[...delivered(),{role:'user',content:"That's not good",at:new Date().toISOString()},{role:'assistant',content:'[file: Harborville itinerary] https://new.here.now/',at:new Date().toISOString()}] as any;state.sent=[];state.chatCalls=[];selects=0
 await handleSpectrumMessage(space,inbound('r2','The dinner pick is wrong, redo it'))
 expect(state.chatCalls[0].opts.deliverable?.kind).toBe('itinerary');expect(published).toHaveBeenCalledTimes(2)
})
it('flag on: the existing per-turn decision also offers redo (no extra call), original request travels',async()=>{
 vi.stubEnv('DINGHY_JEV_DELIVERABLE','on');install();state.messages=delivered() as any
 await handleSpectrumMessage(space,inbound('f1',"That's not good"))
 expect(state.decisions).toBe(1);expect(state.chatCalls[0].opts.deliverable.request).toContain(original);expect(published).toHaveBeenCalledTimes(1)
})
it('flag on: venting is none, ordinary turn',async()=>{
 vi.stubEnv('DINGHY_JEV_DELIVERABLE','on');install();state.verdict2='none';state.messages=delivered() as any
 await handleSpectrumMessage(space,inbound('f2','ugh'))
 expect(state.decisions).toBe(1);expect(state.chatCalls[0]?.opts.deliverable??null).toBeNull();expect(published).not.toHaveBeenCalled()
})

const ago=(ms:number)=>new Date(Date.now()-ms).toISOString()
it('request that never matched the keyword matcher: the model-originated request, clarification and artifact travel in full',async()=>{
 install();const ask='Surprise the Ortegas with a fun Saturday near the harbour.'
 state.messages=[{role:'user',content:ask,at:ago(9e6)},{role:'assistant',content:'Quick one: do they like museums?',at:ago(9e6)},{role:'user',content:'Yes, and no seafood.',at:ago(9e6)},{role:'assistant',content:'[file: Saturday plan] https://a.here.now/',at:ago(9e6)}] as any
 await handleSpectrumMessage(space,inbound('n1',"That's not good"))
 const r=state.chatCalls[0].opts.deliverable.request as string
 expect(r).toContain(ask);expect(r).toContain('Yes, and no seafood.');expect(r).toContain('Saturday plan');expect(r).toContain("That's not good")
})
it('two different deliverables in history, no stored origin: the fallback is the exchange behind the latest file only',async()=>{
 install();const mapAsk='Drop the fictional cafes on a map of Harborville.',planAsk='Plan a quiet Sunday for the fictional Ortegas.'
 state.messages=[{role:'user',content:mapAsk,at:ago(9e6)},{role:'assistant',content:'[file: Cafe map] https://m.here.now/',at:ago(9e6)},{role:'user',content:'thanks',at:ago(8e6)},{role:'assistant',content:'Anytime.',at:ago(8e6)},{role:'user',content:planAsk,at:ago(7e6)},{role:'assistant',content:'[file: Sunday plan] https://p.here.now/',at:ago(7e6)}] as any
 await handleSpectrumMessage(space,inbound('t1','this is wrong'))
 const r=state.chatCalls[0].opts.deliverable.request as string
 expect(r).toContain(planAsk);expect(r).not.toContain(mapAsk);expect(r).not.toContain('Cafe map')
})
const hashOf=async()=>{const {createHash}=await import('crypto');const line=(delivered() as any[]).at(-1).content;return createHash('sha1').update(`${space.id}\n${line}`).digest('hex').slice(0,16)}
const L=()=>globalThis as any
it('a repeated complaint while a redo runs (even 200s in): one job, a true one-line reply, no wait',async()=>{
 install();state.messages=delivered() as any;const h=await hashOf();L().__locks.set(`redo-lock:${h}`,{claim_id:'live',received_at:ago(200e3)});L().__noteVerdict='repeat'
 await handleSpectrumMessage(space,inbound('p1',"That's not good"))
 expect(state.chatCalls).toHaveLength(0);expect(published).not.toHaveBeenCalled();expect(texts().join('\n')).toMatch(/already covered by the redo/)
 expect(L().__locks.get(`redo-lock:${h}`).claim_id).toBe('live')
})
it('cancel or do-not-redo while a redo runs: honest line, no new job',async()=>{
 install();state.messages=delivered() as any;const h=await hashOf();L().__locks.set(`redo-lock:${h}`,{claim_id:'live',received_at:ago(20e3)});L().__noteVerdict='stop'
 await handleSpectrumMessage(space,inbound('p3',"stop, don't redo it"))
 expect(state.chatCalls).toHaveLength(0);expect(published).not.toHaveBeenCalled();expect(texts().join('\n')).toMatch(/Stopping that redo now/)
})
it('a changed instruction while a redo runs survives: it waits for the running redo, then a fresh redo carries the original request, the first replacement and the new note',async()=>{
 vi.stubEnv('DINGHY_REDO_WAIT_MS','2000');install();const base=delivered() as any[];state.messages=base as any;const h=await hashOf();L().__locks.set(`redo-lock:${h}`,{claim_id:'live',received_at:ago(20e3)});L().__locks.set(`redo-note:live:${(await import('crypto')).createHash('sha1').update('closed:live').digest('hex').slice(0,16)}`,{claim_id:'c',received_at:ago(1e3)});
 const note='Also the dates are 14-17 March and nothing before 9am.'
 setTimeout(async()=>{L().__locks.clear();state.messages=[...base,{role:'user',content:"That's not good",at:ago(30e3)},{role:'assistant',content:'[file: Harborville itinerary v2] https://v2.here.now/',at:ago(5e3)},{role:'assistant',content:(await import('@/lib/files/origin')).originMarker('https://v2.here.now/','Redo from request: '+original+' / feedback: not good'),at:ago(5e3)},{role:'user',content:note,at:ago(1e3)}] as any},300)
 await handleSpectrumMessage(space,inbound('n9',note))
 expect(published).toHaveBeenCalledTimes(1);const r=state.chatCalls[0].opts.deliverable.request as string
 expect(r).toContain(original);expect(r).toContain(note);expect([...L().__locks.keys()].some((k:string)=>k.startsWith('redo-lock:'))).toBe(false)
},15000)
it('a changed instruction when the running redo never finishes in the wait: the note stays in the chat and the reply says exactly that',async()=>{
 vi.stubEnv('DINGHY_REDO_WAIT_MS','300');install();state.messages=delivered() as any;const h=await hashOf();L().__locks.set(`redo-lock:${h}`,{claim_id:'live',received_at:ago(20e3)});L().__locks.set(`redo-note:live:${(await import('crypto')).createHash('sha1').update('closed:live').digest('hex').slice(0,16)}`,{claim_id:'c',received_at:ago(1e3)});
 await handleSpectrumMessage(space,inbound('n8','Also 14-17 March please'))
 expect(published).not.toHaveBeenCalled();expect(texts().join('\n')).toMatch(/note is saved in this chat and will be part of the next redo/);expect(L().__locks.get(`redo-lock:${h}`).claim_id).toBe('live')
},15000)
it('a job that throws still releases the lock (every exit from the guarded scope)',async()=>{
 install();state.messages=delivered() as any
 const f=globalThis.fetch as any;vi.stubGlobal('fetch',vi.fn(async(u:any,i:any)=>String(u).includes('gateway.test')&&JSON.parse(i.body).max_tokens!==8?new Response('boom',{status:500}):f(u,i)))
 await handleSpectrumMessage(space,inbound('th1',"That's not good"))
 expect([...L().__locks.keys()].some((k:string)=>k.startsWith('redo-lock:'))).toBe(false)
})
it('the lock is released when the job ends; a later complaint on the same file starts a new job',async()=>{
 install();state.messages=delivered() as any
 await handleSpectrumMessage(space,inbound('l1',"That's not good"));expect(published).toHaveBeenCalledTimes(1);expect([...L().__locks.keys()].some((k:string)=>k.startsWith('redo-lock:'))).toBe(false)
 state.sent=[];state.chatCalls=[];selects=0
 await handleSpectrumMessage(space,inbound('l2','still not right'));expect(published).toHaveBeenCalledTimes(2);expect([...L().__locks.keys()].some((k:string)=>k.startsWith('redo-lock:'))).toBe(false)
})
it('terminal failure (research-only, no file) also releases the lock',async()=>{
 install({searchOnly:true});state.messages=delivered() as any
 await handleSpectrumMessage(space,inbound('f1',"That's not good"));expect([...L().__locks.keys()].some((k:string)=>k.startsWith('redo-lock:'))).toBe(false)
})
it('a dead job (lock older than 300s) is recovered by compare-and-delete, then the redo runs once',async()=>{
 install();state.messages=delivered() as any;const h=await hashOf()
 L().__locks.set(`redo-lock:${h}`,{claim_id:'dead',received_at:ago(400e3)})
 await handleSpectrumMessage(space,inbound('s1',"That's not good"))
 expect(published).toHaveBeenCalledTimes(1);expect([...L().__locks.keys()].some((k:string)=>k.startsWith('redo-lock:'))).toBe(false)
})
it('claim read failure or timeout: nothing starts, honest line, no duplicate job',async()=>{
 install();state.messages=delivered() as any
 L().__failClaim=true;await handleSpectrumMessage(space,inbound('u1',"That's not good"))
 expect(published).not.toHaveBeenCalled();expect(texts().join('\n')).toMatch(/could not start the redo/)
 L().__failClaim=false;L().__failRead=true;const h=await hashOf();L().__locks.set(`redo-lock:${h}`,{claim_id:'x',received_at:ago(10e3)});state.sent=[]
 await handleSpectrumMessage(space,inbound('u2',"That's not good"))
 expect(published).not.toHaveBeenCalled();expect(texts().join('\n')).toMatch(/could not start the redo/)
})
it('context that cannot be rebuilt completely: no redo, honest line, no truncation of dates or constraints',async()=>{
 install();const long='Dates: 14-17 March, no flights before 9am. '+'x'.repeat(13000)
 state.messages=[{role:'user',content:long,at:ago(9e6)},{role:'assistant',content:'[file: Trip] https://t.here.now/',at:ago(9e6)}] as any
 await handleSpectrumMessage(space,inbound('x1',"That's not good"))
 expect(published).not.toHaveBeenCalled();expect(texts().join('\n')).toMatch(/could not rebuild the full original request/);expect([...L().__locks.keys()].some((k:string)=>k.startsWith('redo-lock:'))).toBe(false)
})
it('a short exchange passes its dates and constraints through whole',async()=>{
 install();state.messages=[{role:'user',content:'Plan a trip for the fictional Ortegas, 14-17 March, no flights before 9am, vegetarian dinners.',at:ago(9e6)},{role:'assistant',content:'[file: Trip] https://t.here.now/',at:ago(9e6)}] as any
 await handleSpectrumMessage(space,inbound('x2',"That's not good"))
 const r=state.chatCalls[0].opts.deliverable.request as string;expect(r).toContain('14-17 March, no flights before 9am, vegetarian dinners.')
})

it('origin association: a complaint redoes the exact request stored with the file, not the surrounding chat',async()=>{
 const {originMarker}=await import('@/lib/files/origin');install();const url='https://o.here.now/'
 state.messages=[{role:'user',content:'my cat is called Biscuit and she hates the vet',at:ago(9e6)},{role:'assistant',content:'Aww.',at:ago(9e6)},{role:'user',content:'weekend in Harborville for the fictional Ortegas',at:ago(8e6)},{role:'assistant',content:'[file: Weekend] '+url,at:ago(8e6)},{role:'assistant',content:originMarker(url,'EXACT ORIGIN: weekend in Harborville for the fictional Ortegas, 14-17 March, vegetarian'),at:ago(8e6)}] as any
 await handleSpectrumMessage(space,inbound('o1',"That's not good"))
 const r=state.chatCalls[0].opts.deliverable.request as string
 expect(r).toContain('EXACT ORIGIN');expect(r).toContain('14-17 March');expect(r).not.toContain('Biscuit');expect(r).not.toContain('the vet')
})
it('a shipped redo stores its own origin marker, so a second complaint on the replacement still has the whole request',async()=>{
 install();state.messages=delivered() as any
 await handleSpectrumMessage(space,inbound('m1',"That's not good"))
 const mk=(state.messages as any[]).find(m=>/^\[sent file: origin /.test(m.content));expect(mk).toBeTruthy()
})
it('a note sent while the redo runs is applied by that same redo before it publishes (one job, no second pass)',async()=>{
 const note='Also the dates are 14-17 March.'
 install({onGateway:async()=>{state.messages=[...(state.messages as any[]),{role:'user',content:note,at:new Date().toISOString()}] as any;await handleSpectrumMessage(space,inbound('nn2',note))}});state.messages=delivered() as any
 await handleSpectrumMessage(space,inbound('nn1',"That's not good"))
 expect(texts().join('\n')).toContain('Adding that to the redo that is running now.')
 expect(gateway.some(g=>JSON.stringify(g).includes('The user added this while you were working')&&JSON.stringify(g).includes(note))).toBe(true)
 expect(published).toHaveBeenCalledTimes(1);expect(L().__locks.size).toBeGreaterThan(0)
})
it('a cancel sent while the redo runs stops new work and nothing is published or sent from it',async()=>{
 L().__noteVerdict='stop'
 install({onGateway:async()=>{await handleSpectrumMessage(space,inbound('cc2',"stop, don't redo it"))}});state.messages=delivered() as any
 await handleSpectrumMessage(space,inbound('cc1',"That's not good"))
 expect(published).not.toHaveBeenCalled();expect(texts().join('\n')).toMatch(/Stopped that redo/);expect(texts().join('\n')).toMatch(/Stopping that redo now/)
})
