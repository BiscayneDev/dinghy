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
import {writeFile,mkdir} from 'node:fs/promises'
const lineOf=(req:any,nm:string)=>{const sys=req.messages.find((m:any)=>m.role==='system'&&String(m.content).startsWith('Candidate lines'));const l=String(sys?.content).split('\n').find((x:string)=>/^L\d+ \| /.test(x)&&x.split(' | ')[1]===nm);return l?Number(l.split(' ')[0].slice(1)):9999}
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.clearAllMocks()})
it('mandatory actual production schema compiles first attempt, renders HTML/PDF/localcard and queues one file without sends',async()=>{
 vi.stubEnv('TAVILY_API_KEY','fictional-key')
 const url='https://harbor.test/visitors'
 const ask='Make an itinerary for fictional founders visiting Harbor on Friday. Office visit10am then working sessions, hotel and restaurant recommendations and weekend activities.'
 const body='## Friday\n- 10:00 User supplied office visit.\n- Working sessions: venue and duration to confirm.\n## Weekend\nPlans to confirm.'
 const ctx={userId:'',telegramId:0,telegramChatId:0,name:'Synthetic test',timezone:'UTC',tokens:{}}
 const files=fileToolsFor(),stages:string[]=[],requests:any[]=[]
 published.mockResolvedValue({url:'https://fictional-pipeline.here.now/',slug:'fictional-pipeline',expiresAt:'2030-06-11T00:00:00Z'})
 vi.stubGlobal('fetch',vi.fn(async(u,init)=>{
  if(String(u)==='https://api.tavily.com/search')return new Response(JSON.stringify({results:[{title:'Harbor public visitors',url,content:'Hotel, dining and museum public listings.'}]}))
  if(String(u)===url)return new Response('<html><title>Harbor public visitors</title><body>Harbor Inn rooms. Harbor Cafe dinner. Harbor Museum tickets. Rooms $200. Menu served. Hours, prices and availability unverified.</body></html>')
  requests.push(JSON.parse(init.body))
  if(requests.at(-1).max_tokens===8){requests.pop();return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'yes'}}]}))}
  const n=requests.length,source=JSON.parse(requests.at(-1).messages.filter((m:any)=>m.role==='tool').at(-1)?.content??'{}').source_records?.find((r:any)=>r.origin==='page')
  const name=n===1?'web_search':n<=3?'select_itinerary_candidates':'create_file'
  const args=name==='web_search'?{query:'Harbor official visitor listings'}:name==='select_itinerary_candidates'?{candidates:(n===2?[['hotel','Harbor Inn']]:[['restaurant','Harbor Cafe'],['activity','Harbor Museum'],['activity','Invented Tower']]).map(([kind,nm])=>({kind,line:lineOf(requests.at(-1),nm as string)}))}:{title:'Synthetic Harbor founders itinerary',body:body+'\n:::options\nHand | typed | rows | here\n:::',format:'pdf',kind:'itinerary'}
  return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:String(requests.length),function:{name,arguments:JSON.stringify(args)}}]}}]}))
 }))
 const tools=gateTools([...toolsFor(ctx),...files.tools],[ask]).active
 const result=await chatWithTools([{role:'user',content:ask}],{gatewayUrl:'https://gateway.test',apiKey:'fictional',model:'auto',deadlineAt:Date.now()+60000,onStage:async(_s,d)=>{if(d)stages.push(d)}},tools,ctx)
 expect(result.deliverable?.state).toBe('completed');expect(published).toHaveBeenCalledTimes(1);expect(files.files()).toHaveLength(1);expect(requests).toHaveLength(4)
 expect(stages).toContain('research:read_ok');expect(stages).toContain('itinerary:candidates_compiled');expect(stages).toContain('invalid:selection:missing_kind:restaurant_activity');expect(stages).toContain('itinerary:manual_blocks_stripped');expect(stages).toContain('itinerary:candidates_selected:3');expect(stages.some(x=>x.startsWith('itinerary:page_view:'))).toBe(true);expect(requests[1].tools.map((t:any)=>t.function.name)).toEqual(['select_itinerary_candidates']);for(const r of requests.slice(3)){const f=r.tools.find((t:any)=>t.function.name==='create_file');expect(f.function.parameters.properties.itinerary_candidates).toBeUndefined();expect(f.function.parameters.required).not.toContain('itinerary_candidates')};expect(stages.filter(s=>s.startsWith('invalid:')&&!s.startsWith('invalid:selection:missing_kind'))).toEqual([])
 const made=files.files()[0];expect(made.bytes.subarray(0,4).toString()).toBe('%PDF');expect(made.card?.subarray(1,4).toString()).toBe('PNG');expect(made.markdown).toContain('Source provenance');expect(made.markdown).not.toContain('{{source:')
 const html=published.mock.calls[0][0].find((f:any)=>f.path==='index.html').bytes.toString();expect(html).toContain('hero-title');expect(html).toContain('Harbor Inn')
 await mkdir('/tmp/itinerary-pipeline-proof',{recursive:true});await writeFile('/tmp/itinerary-pipeline-proof/page.html',html);await writeFile('/tmp/itinerary-pipeline-proof/file.pdf',made.bytes);await writeFile('/tmp/itinerary-pipeline-proof/card.png',made.card!);await writeFile('/tmp/itinerary-pipeline-proof/report.json',JSON.stringify({synthetic:true,noSend:true,stages,completed:true,httpMocked:true,publishMocked:true,files:1},null,2))
})

it('unverified requested kinds are noted truthfully as a distinct partial while the verified hotel still publishes',async()=>{
 vi.stubEnv('TAVILY_API_KEY','fictional-key')
 const url='https://harbor.test/visitors'
 const ask='Make an itinerary for fictional founders visiting Harbor on Friday. Office visit10am then working sessions, hotel and restaurant recommendations and weekend activities.'
 const body='## Friday\n- 10:00 User supplied office visit.\n- Working sessions: venue and duration to confirm.\n## Weekend\nPlans to confirm.'
 const ctx={userId:'',telegramId:0,telegramChatId:0,name:'Synthetic test',timezone:'UTC',tokens:{}}
 const files=fileToolsFor(),stages:string[]=[],requests:any[]=[]
 published.mockResolvedValue({url:'https://fictional-pipeline.here.now/',slug:'fictional-pipeline',expiresAt:'2030-06-11T00:00:00Z'})
 vi.stubGlobal('fetch',vi.fn(async(u,init)=>{
  if(String(u)==='https://api.tavily.com/search')return new Response(JSON.stringify({results:[{title:'Harbor public visitors',url,content:'Hotel, dining and museum public listings.'}]}))
  if(String(u)===url)return new Response('<html><title>Harbor public visitors</title><body>Harbor Inn rooms. Harbor Cafe dinner. Harbor Museum tickets. Rooms $200. Menu served. Hours, prices and availability unverified.</body></html>')
  requests.push(JSON.parse(init.body))
  if(requests.at(-1).max_tokens===8){requests.pop();return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'yes'}}]}))}
  const n=requests.length,source=JSON.parse(requests.at(-1).messages.filter((m:any)=>m.role==='tool').at(-1)?.content??'{}').source_records?.find((r:any)=>r.origin==='page')
  const name=n===1?'web_search':n<=4?'select_itinerary_candidates':'create_file'
  const args=name==='web_search'?{query:'Harbor official visitor listings'}:name==='select_itinerary_candidates'?{candidates:[['hotel','Harbor Inn']].map(([kind,nm])=>({kind,line:lineOf(requests.at(-1),nm as string)}))}:{title:'Synthetic Harbor founders itinerary',body,format:'pdf',kind:'itinerary'}
  return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:String(requests.length),function:{name,arguments:JSON.stringify(args)}}]}}]}))
 }))
 const tools=gateTools([...toolsFor(ctx),...files.tools],[ask]).active
 const result=await chatWithTools([{role:'user',content:ask}],{gatewayUrl:'https://gateway.test',apiKey:'fictional',model:'auto',deadlineAt:Date.now()+60000,onStage:async(_s,d)=>{if(d)stages.push(d)}},tools,ctx)
 expect(result.deliverable?.state).toBe('completed');expect(published).toHaveBeenCalledTimes(1);expect(files.files()).toHaveLength(1);expect(requests).toHaveLength(5)
 expect(stages).toContain('itinerary:partial_unverified:restaurant_activity');expect(stages).toContain('itinerary:candidates_selected:1')
 const made=files.files()[0];expect(made.bytes.subarray(0,4).toString()).toBe('%PDF');expect(made.card?.subarray(1,4).toString()).toBe('PNG');expect(made.markdown).toContain('Not found');expect(made.markdown).toContain('verify a pick');expect(made.markdown).toContain('Source provenance');expect(made.markdown).not.toContain('{{source:')
 const html=published.mock.calls[0][0].find((f:any)=>f.path==='index.html').bytes.toString();expect(html).toContain('hero-title');expect(html).toContain('Harbor Inn')
 await mkdir('/tmp/itinerary-pipeline-proof-unsupported',{recursive:true});await writeFile('/tmp/itinerary-pipeline-proof-unsupported/page.html',html);await writeFile('/tmp/itinerary-pipeline-proof-unsupported/file.pdf',made.bytes);await writeFile('/tmp/itinerary-pipeline-proof-unsupported/card.png',made.card!);await writeFile('/tmp/itinerary-pipeline-proof-unsupported/report.json',JSON.stringify({synthetic:true,noSend:true,stages,completed:true,httpMocked:true,publishMocked:true,files:1},null,2))
})

it('server states the requested working sessions when the model agenda omits the phrase',async()=>{
 vi.stubEnv('TAVILY_API_KEY','fictional-key')
 const url='https://harbor.test/visitors'
 const ask='Make an itinerary for fictional founders visiting Harbor on Friday. Office visit10am then working sessions, hotel and restaurant recommendations and weekend activities.'
 const body='## Friday\n- 10:00 User supplied office visit.\n- Working sessions: venue and duration to confirm.\n## Weekend\nPlans to confirm.'
 const ctx={userId:'',telegramId:0,telegramChatId:0,name:'Synthetic test',timezone:'UTC',tokens:{}}
 const files=fileToolsFor(),stages:string[]=[],requests:any[]=[]
 published.mockResolvedValue({url:'https://fictional-pipeline.here.now/',slug:'fictional-pipeline',expiresAt:'2030-06-11T00:00:00Z'})
 vi.stubGlobal('fetch',vi.fn(async(u,init)=>{
  if(String(u)==='https://api.tavily.com/search')return new Response(JSON.stringify({results:[{title:'Harbor public visitors',url,content:'Hotel, dining and museum public listings.'}]}))
  if(String(u)===url)return new Response('<html><title>Harbor public visitors</title><body>Harbor Inn rooms. Harbor Cafe dinner. Harbor Museum tickets. Rooms $200. Menu served. Hours, prices and availability unverified.</body></html>')
  requests.push(JSON.parse(init.body))
  if(requests.at(-1).max_tokens===8){requests.pop();return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'yes'}}]}))}
  const n=requests.length,source=JSON.parse(requests.at(-1).messages.filter((m:any)=>m.role==='tool').at(-1)?.content??'{}').source_records?.find((r:any)=>r.origin==='page')
  const name=n===1?'web_search':n<=3?'select_itinerary_candidates':'create_file'
  const args=name==='web_search'?{query:'Harbor official visitor listings'}:name==='select_itinerary_candidates'?{candidates:(n===2?[['hotel','Harbor Inn']]:[['restaurant','Harbor Cafe'],['activity','Harbor Museum'],['activity','Invented Tower']]).map(([kind,nm])=>({kind,line:lineOf(requests.at(-1),nm as string)}))}:{title:'Synthetic Harbor founders itinerary',body:body.replace('Working sessions','Sessions')+'\n:::options\nHand | typed | rows | here\n:::',format:'pdf',kind:'itinerary'}
  return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:String(requests.length),function:{name,arguments:JSON.stringify(args)}}]}}]}))
 }))
 const tools=gateTools([...toolsFor(ctx),...files.tools],[ask]).active
 const result=await chatWithTools([{role:'user',content:ask}],{gatewayUrl:'https://gateway.test',apiKey:'fictional',model:'auto',deadlineAt:Date.now()+60000,onStage:async(_s,d)=>{if(d)stages.push(d)}},tools,ctx)
 expect(result.deliverable?.state).toBe('completed');expect(published).toHaveBeenCalledTimes(1);expect(files.files()).toHaveLength(1);expect(requests).toHaveLength(4)
 expect(stages).toContain('research:read_ok');expect(stages).toContain('itinerary:candidates_compiled');expect(stages).toContain('invalid:selection:missing_kind:restaurant_activity');expect(stages).toContain('itinerary:manual_blocks_stripped');expect(stages).toContain('itinerary:working_sessions_added');expect(stages).toContain('itinerary:candidates_selected:3');expect(stages.some(x=>x.startsWith('itinerary:page_view:'))).toBe(true);expect(requests[1].tools.map((t:any)=>t.function.name)).toEqual(['select_itinerary_candidates']);for(const r of requests.slice(3)){const f=r.tools.find((t:any)=>t.function.name==='create_file');expect(f.function.parameters.properties.itinerary_candidates).toBeUndefined();expect(f.function.parameters.required).not.toContain('itinerary_candidates')};expect(stages.filter(s=>s.startsWith('invalid:')&&!s.startsWith('invalid:selection:missing_kind'))).toEqual([])
 const made=files.files()[0];expect(made.bytes.subarray(0,4).toString()).toBe('%PDF');expect(made.card?.subarray(1,4).toString()).toBe('PNG');expect(made.markdown).toContain('Source provenance');expect(made.markdown).not.toContain('{{source:')
 const html=published.mock.calls[0][0].find((f:any)=>f.path==='index.html').bytes.toString();expect(html).toContain('hero-title');expect(html).toContain('Harbor Inn')
 await mkdir('/tmp/itinerary-pipeline-proof-ws',{recursive:true});await writeFile('/tmp/itinerary-pipeline-proof-ws/page.html',html);await writeFile('/tmp/itinerary-pipeline-proof-ws/file.pdf',made.bytes);await writeFile('/tmp/itinerary-pipeline-proof-ws/card.png',made.card!);await writeFile('/tmp/itinerary-pipeline-proof-ws/report.json',JSON.stringify({synthetic:true,noSend:true,stages,completed:true,httpMocked:true,publishMocked:true,files:1},null,2))
})

it('verification accepts only a bare yes, caches verdicts across retries, and an unverified pick never publishes',async()=>{
 vi.stubEnv('TAVILY_API_KEY','fictional-key')
 const url='https://harbor.test/visitors',ask='Make an itinerary for fictional founders visiting Harbor on Friday. Hotel recommendations.'
 const ctx={userId:'',telegramId:0,telegramChatId:0,name:'Synthetic test',timezone:'UTC',tokens:{}}
 const files=fileToolsFor(),stages:string[]=[];let verifies=0,n=0
 vi.stubGlobal('fetch',vi.fn(async(u:any,init:any)=>{
  if(String(u)==='https://api.tavily.com/search')return new Response(JSON.stringify({results:[{title:'Harbor public visitors',url,content:'Hotel listings.'}]}))
  if(String(u)===url)return new Response('<html><title>Harbor</title><body>Harbor Inn rooms. Harbor Cafe dinner. Harbor Museum tickets. Rooms $200. Menu served.</body></html>')
  const b=JSON.parse(init.body)
  if(b.max_tokens===8){verifies++;return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'Yes, but I am not sure'}}]}))}
  n++;const name=n===1?'web_search':'select_itinerary_candidates'
  const args=n===1?{query:'Harbor listings'}:{candidates:[{kind:'hotel',line:1}]}
  return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:String(n),function:{name,arguments:JSON.stringify(args)}}]}}]}))
 }))
 const tools=gateTools([...toolsFor(ctx),...files.tools],[ask]).active
 await chatWithTools([{role:'user',content:ask}],{gatewayUrl:'https://gateway.test',apiKey:'fictional',model:'auto',deadlineAt:Date.now()+60000,onStage:async(_s,d)=>{if(d)stages.push(d)}},tools,ctx)
 expect(verifies).toBeLessThanOrEqual(1);expect(published).not.toHaveBeenCalled();expect(stages.filter(s=>s==='invalid:selection:not_verified').length).toBeGreaterThan(0)
})

it('verified picks survive later failed attempts and publish as an honest partial with a safe trace',async()=>{
 vi.stubEnv('TAVILY_API_KEY','fictional-key')
 const url='https://harbor.test/visitors',ask='Make an itinerary for fictional founders visiting Harbor on Friday. Hotel and restaurant recommendations.'
 const ctx={userId:'',telegramId:0,telegramChatId:0,name:'Synthetic test',timezone:'UTC',tokens:{}}
 const files=fileToolsFor(),stages:string[]=[];let n=0
 published.mockResolvedValue({url:'https://fictional-pipeline.here.now/',slug:'fictional-pipeline',expiresAt:'2030-06-11T00:00:00Z'})
 vi.stubGlobal('fetch',vi.fn(async(u:any,init:any)=>{
  if(String(u)==='https://api.tavily.com/search')return new Response(JSON.stringify({results:[{title:'Harbor public visitors',url,content:'Hotel listings.'}]}))
  if(String(u)===url)return new Response('<html><title>Harbor</title><body>Harbor Inn rooms. Harbor Cafe dinner. Harbor Museum tickets. Rooms $200. Menu served.</body></html>')
  const b=JSON.parse(init.body)
  if(b.max_tokens===8)return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'yes'}}]}))
  n++;const name=n===1?'web_search':n<=4?'select_itinerary_candidates':'create_file'
  const args=n===1?{query:'Harbor listings'}:n===2?{candidates:[{kind:'hotel',line:1}]}:n<=4?{candidates:[{kind:'restaurant',line:9999}]}:{title:'Synthetic Harbor itinerary',body:'## Friday\n- 10:00 User supplied office visit.\n## Weekend\nPlans to confirm.',format:'pdf',kind:'itinerary'}
  return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:String(n),function:{name,arguments:JSON.stringify(args)}}]}}]}))
 }))
 const tools=gateTools([...toolsFor(ctx),...files.tools],[ask]).active
 await chatWithTools([{role:'user',content:ask}],{gatewayUrl:'https://gateway.test',apiKey:'fictional',model:'auto',deadlineAt:Date.now()+60000,onStage:async(_s,d)=>{if(d)stages.push(d)}},tools,ctx)
 expect(stages).toContain('itinerary:accepted:h1_r0_a0');expect(stages.some(x=>x.startsWith('itinerary:rejected:line_unknown-1'))).toBe(true)
 expect(stages).toContain('itinerary:partial_unverified:restaurant');expect(published).toHaveBeenCalledTimes(1)
 for(const x of stages)expect(x.length).toBeLessThanOrEqual(80)
})
