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

it('a missing kind reopens research on the server and the new pages feed a second selection',async()=>{
 vi.stubEnv('TAVILY_API_KEY','fictional-key')
 const u1='https://harbor.test/stays',u2='https://harbor.test/eats',junk1='https://harbor.test/chrome-one',junk2='https://harbor.test/chrome-two',ask='Make an itinerary for fictional founders visiting Harbor on Friday. Hotel and restaurant recommendations.'
 const ctx={userId:'',telegramId:0,telegramChatId:0,name:'Synthetic test',timezone:'UTC',tokens:{}}
 const files=fileToolsFor(),stages:string[]=[],queries:string[]=[];let n=0
 published.mockResolvedValue({url:'https://fictional-pipeline.here.now/',slug:'fictional-pipeline',expiresAt:'2030-06-11T00:00:00Z'})
 const find=(b:any,nm:string)=>{const ls=b.messages.filter((m:any)=>m.role==='system'&&/\nL\d+ \| /.test('\n'+String(m.content))).flatMap((m:any)=>String(m.content).split('\n'));const l=[...ls].reverse().find((x:string)=>/^L\d+ \| /.test(x)&&x.split(' | ')[1]===nm);return l?Number(l.split(' ')[0].slice(1)):9999}
 vi.stubGlobal('fetch',vi.fn(async(u:any,init:any)=>{
  if(String(u)==='https://api.tavily.com/search'){const q=JSON.parse(init.body).query;queries.push(q);return new Response(JSON.stringify({results:[...(/restaurant recommendations/.test(q)?[{title:'Harbor eats guide',url:u2,content:'Dining.'}]:/^best restaurants/.test(q)?[{title:'Harbor best restaurants guide one',url:junk1,content:'Dining.'},{title:'Harbor best restaurants guide two',url:junk2,content:'Dining.'}]:[{title:'Harbor stays guide',url:u1,content:'Hotels.'}])]}))}
  if(String(u)===u1)return new Response('<html><title>Harbor stays</title><body><h2>Harbor Inn</h2><p>Harbor Inn has quiet rooms near the water in Harbor.</p></body></html>')
  if(String(u)===junk1||String(u)===junk2)return new Response('<html><title>Harbor guide</title><body><h2>Season Menus</h2><p>Savor the Stories in Harbor.</p></body></html>')
  if(String(u)===u2)return new Response('<html><title>Harbor eats</title><body><h2>Lantern Table</h2><p>Lantern Table serves seafood dinners in Harbor.</p></body></html>')
  const b=JSON.parse(init.body)
  if(b.max_tokens===8)return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'yes'}}]}))
  n++;const name=n===1?'web_search':n<=4?'select_itinerary_candidates':'create_file'
  const args=n===1?{query:'Harbor listings'}:n===2?{candidates:[{kind:'hotel',line:find(b,'Harbor Inn')}]}:n===3?{candidates:[{kind:'restaurant',line:9999}]}:n===4?{candidates:[{kind:'restaurant',line:find(b,'Lantern Table')}]}:{title:'Synthetic Harbor itinerary',body:'## Friday\n- 10:00 User supplied office visit.\n',format:'pdf',kind:'itinerary'}
  return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:String(n),function:{name,arguments:JSON.stringify(args)}}]}}]}))
 }))
 const tools=gateTools([...toolsFor(ctx),...files.tools],[ask]).active
 await chatWithTools([{role:'user',content:ask}],{gatewayUrl:'https://gateway.test',apiKey:'fictional',model:'auto',deadlineAt:Date.now()+90000,onStage:async(_s,d)=>{if(d)stages.push(d)}},tools,ctx)
 expect(stages.some(x=>x.startsWith('itinerary:widen:r_'))).toBe(true)
 expect(stages.filter(s=>s==='itinerary:dining_page:0_skip')).toHaveLength(2)
 expect(queries.some(q=>q.startsWith('best restaurants in harbor'))).toBe(true)
 expect(queries.some(q=>q.includes('restaurant recommendations'))).toBe(true)
 expect(stages).toContain('itinerary:accepted:h0_r1_a0');expect(stages.some(x=>x.startsWith('itinerary:partial_unverified'))).toBe(false)
 expect(published).toHaveBeenCalledTimes(1)
})

it('two create_file calls in one gateway response publish and queue only the first file',async()=>{
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
  return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:name==='create_file'?[{id:'first-file',function:{name,arguments:JSON.stringify(args)}},{id:'second-file',function:{name,arguments:JSON.stringify({...args,title:'Duplicate fictional itinerary'})}}]:[{id:String(requests.length),function:{name,arguments:JSON.stringify(args)}}]}}]}))
 }))
 const tools=gateTools([...toolsFor(ctx),...files.tools],[ask]).active
 const result=await chatWithTools([{role:'user',content:ask}],{gatewayUrl:'https://gateway.test',apiKey:'fictional',model:'auto',deadlineAt:Date.now()+60000,onStage:async(_s,d)=>{if(d)stages.push(d)}},tools,ctx)
 expect(result.deliverable?.state).toBe('completed');expect(published).toHaveBeenCalledTimes(1);expect(files.files()).toHaveLength(1);expect(requests).toHaveLength(4)
 expect(stages).toContain('research:read_ok');expect(stages).toContain('itinerary:candidates_compiled');expect(stages).toContain('invalid:selection:missing_kind:restaurant_activity');expect(stages).toContain('itinerary:manual_blocks_stripped');expect(stages).toContain('itinerary:candidates_selected:3');expect(stages.some(x=>x.startsWith('itinerary:page_view:'))).toBe(true);expect(requests[1].tools.map((t:any)=>t.function.name)).toEqual(['select_itinerary_candidates']);for(const r of requests.slice(3)){const f=r.tools.find((t:any)=>t.function.name==='create_file');expect(f.function.parameters.properties.itinerary_candidates).toBeUndefined();expect(f.function.parameters.required).not.toContain('itinerary_candidates')};expect(stages.filter(s=>s.startsWith('invalid:')&&!s.startsWith('invalid:selection:missing_kind'))).toEqual([])
 const made=files.files()[0];expect(made.bytes.subarray(0,4).toString()).toBe('%PDF');expect(made.card?.subarray(1,4).toString()).toBe('PNG');expect(made.markdown).toContain('Source provenance');expect(made.markdown).not.toContain('{{source:')
 const html=published.mock.calls[0][0].find((f:any)=>f.path==='index.html').bytes.toString();expect(html).toContain('hero-title');expect(html).toContain('Harbor Inn')
 expect(made.title).toBe('Synthetic Harbor founders itinerary');files.close()
})

it('typed provider listings feed model selection and publish attribution without page-name parsing',async()=>{
 vi.stubEnv('TAVILY_API_KEY','fictional-key')
 vi.stubEnv('GEOAPIFY_API_KEY','fictional-key')
 const url='https://harbor.test/visitors'
 const ask='Make an itinerary for fictional founders visiting Harbor on Friday. Office visit10am then working sessions, hotel and restaurant recommendations and weekend activities.'
 const body='## Friday\n- 10:00 User supplied office visit.\n- Working sessions: venue and duration to confirm.\n## Weekend\nPlans to confirm.'
 const ctx={userId:'',telegramId:0,telegramChatId:0,name:'Synthetic test',timezone:'UTC',tokens:{}}
 const files=fileToolsFor(),stages:string[]=[],requests:any[]=[]
 published.mockResolvedValue({url:'https://fictional-pipeline.here.now/',slug:'fictional-pipeline',expiresAt:'2030-06-11T00:00:00Z'})
 vi.stubGlobal('fetch',vi.fn(async(u,init)=>{
  if(String(u).startsWith('https://api.geoapify.com/')){const url=new URL(String(u));if(url.pathname.includes('geocode'))return new Response(JSON.stringify({results:[{lat:25,lon:-80,rank:{confidence:1}}]}));const category=url.searchParams.get('categories')!,name=category.startsWith('accommodation')?'Harbor &amp;amp; Reed Inn':category.startsWith('catering')?'Harbor Cafe':'Harbor Museum';return new Response(JSON.stringify({features:[{properties:{name,categories:[category],lat:25,lon:-80,place_id:name,formatted:'42 Quay St, Harbor'}}]}))}
  if(String(u)==='https://api.tavily.com/search'&&JSON.parse(init.body).query.startsWith('"'))return new Response(JSON.stringify({results:[{url:'https://harbor.test/venue',title:'Harbor venue'}]}))
  if(String(u)==='https://harbor.test/venue')return new Response('<html><title>Harbor venues</title><body>Harbor city. Harbor &amp; Reed Inn has a courtyard garden and a reading lounge. Harbor Cafe serves seasonal vegetable bowls and wood-fired noodles. Harbor Museum houses maritime paintings and model ships.</body></html>')
  if(String(u)==='https://api.tavily.com/search')return new Response(JSON.stringify({results:[{title:'Harbor public visitors',url,content:'Hotel, dining and museum public listings.'}]}))
  if(String(u)===url)return new Response('<html><title>Harbor public visitors</title><body>Harbor Inn rooms. Harbor Cafe dinner. Harbor Museum tickets. Rooms $200. Menu served. Hours, prices and availability unverified.</body></html>')
  const reasonReq=JSON.parse(init.body);if(reasonReq.max_tokens===180){const packet=JSON.parse(reasonReq.messages.find((m:any)=>String(m.content).includes('Packet: ')).content.split('Packet: ')[1]);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({spanIds:[packet.spans.find((s:any)=>s.text.includes(packet.venue.kind==='hotel'?'courtyard':packet.venue.kind==='restaurant'?'vegetable':'maritime'))?.id].filter(Boolean)})}}]}))}if(reasonReq.max_tokens===120)return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({verdict:'yes',reason:'none'})}}]}));if(reasonReq.max_tokens===2200){return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({activities:[{line:3,decision:'recommend',spanId:'span3_3',unknowns:[]}]})}}]}))}if(reasonReq.max_tokens===900){
   const whys=['The source describes a courtyard garden and reading lounge.','The source describes seasonal vegetable bowls and wood-fired noodles.','The source describes maritime paintings and model ships.']
   const claims=['A courtyard garden and reading lounge','Seasonal vegetable bowls and wood-fired noodles','Maritime paintings and model ships']
   const packet=JSON.parse(reasonReq.messages.find((m:any)=>String(m.content).includes('Evidence: ')).content.split('Evidence: ')[1])[0]
   const reasons=[packet.venue.line].map(line=>({line,why:whys[line-1],claims:[{text:claims[line-1],evidenceIds:['ev'+line+'_1']}],unknowns:['Hours and availability not checked']}))
   return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({reasons})}}]}))
  }
  requests.push(reasonReq)
  if(requests.at(-1).max_tokens===8){requests.pop();return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'yes'}}]}))}
  const n=requests.length,source=JSON.parse(requests.at(-1).messages.filter((m:any)=>m.role==='tool').at(-1)?.content??'{}').source_records?.find((r:any)=>r.origin==='page')
  const name=n===1?'web_search':n===2?'select_itinerary_candidates':'create_file'
  const args=name==='web_search'?{query:'Harbor visitor guide'}:name==='select_itinerary_candidates'?{candidates:[{kind:'hotel',line:1},{kind:'restaurant',line:9999},{kind:'restaurant',line:1},{kind:'activity',line:3}]}:{title:'Synthetic Harbor itinerary',subtitle:'Invented dates June 12 to June 14',body:body+'\n- Hotel Recommendations unknown / learn-more\n- Restaurant Recommendations unknown / learn-more\n- Exotic seafood dishes for dinner\n- Liberty Tower\n- 10am office visit\n',itinerary_candidates:[{kind:'restaurant',name:'Invented Cafe'}],format:'pdf',kind:'itinerary'}
  return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:String(requests.length),function:{name,arguments:JSON.stringify(args)}}]}}]}))
 }))
 const tools=gateTools([...toolsFor(ctx),...files.tools],[ask]).active
 const result=await chatWithTools([{role:'user',content:ask}],{gatewayUrl:'https://gateway.test',apiKey:'fictional',model:'auto',deadlineAt:Date.now()+60000,onStage:async(_s,d)=>{if(d)stages.push(d)}},tools,ctx)
 expect(result.deliverable?.state).toBe('completed');expect(published).toHaveBeenCalledTimes(1);expect(stages).toContain('itinerary:places_api:ready_3');expect(stages).toContain('itinerary:accepted:h1_r1_a1');expect(stages).toContain('itinerary:venue_evidence:r3_m0');expect(stages).toContain('itinerary:reasons:a3_r0');expect(stages).toContain('itinerary:evidence_first:a3_v3');expect(requests).toHaveLength(2)
 const html=published.mock.calls[0][0].find((f:any)=>f.path==='index.html').bytes.toString(),markdown=files.files()[0].markdown;
 if(typeof markdown!=='string')throw new Error('Expected itinerary markdown')
 expect(html).not.toContain('Invented dates');expect(stages).toContain('itinerary:reason_judge:yes');expect(html).toContain('Recommendation evidence');expect(markdown).toContain('https://harbor.test/venue');expect(html).not.toContain('{{source:');expect(html).toContain('courtyard garden');expect(html).toContain('wood-fired noodles');expect(html).toContain('maritime paintings');expect(html).toContain('Geoapify');expect(html).toContain('OpenStreetMap contributors');expect(html).not.toContain('apiKey=');expect(html).toContain('Harbor &amp; Reed Inn');for(const forbidden of ['amp;amp','Address&amp;#58','learn-more','Exotic seafood','Liberty Tower','Invented Cafe'])expect(html).not.toContain(forbidden);expect((markdown.match(/Office visit/gi)||[])).toHaveLength(1);expect((markdown.match(/© OpenStreetMap contributors/g)||[])).toHaveLength(1);expect((markdown.match(/## Source provenance/g)||[])).toHaveLength(1);await mkdir('/tmp/venue-proof',{recursive:true});await writeFile('/tmp/venue-proof/page.html',html);await writeFile('/tmp/venue-proof/file.pdf',files.files()[0].bytes)

})

it('actual handler omits a rejected activity and preserves an explicit weekend gap',async()=>{
 vi.stubEnv('TAVILY_API_KEY','fictional-key')
 vi.stubEnv('GEOAPIFY_API_KEY','fictional-key')
 const url='https://harbor.test/visitors'
 const ask='Make an itinerary for fictional founders visiting Harbor on Friday. Office visit10am then working sessions, hotel and restaurant recommendations and weekend activities.'
 const body='## Friday\n- 10:00 User supplied office visit.\n- Working sessions: venue and duration to confirm.\n## Weekend\nPlans to confirm.'
 const ctx={userId:'',telegramId:0,telegramChatId:0,name:'Synthetic test',timezone:'UTC',tokens:{}}
 const files=fileToolsFor(),stages:string[]=[],requests:any[]=[]
 published.mockResolvedValue({url:'https://fictional-pipeline.here.now/',slug:'fictional-pipeline',expiresAt:'2030-06-11T00:00:00Z'})
 vi.stubGlobal('fetch',vi.fn(async(u,init)=>{
  if(String(u).startsWith('https://api.geoapify.com/')){const url=new URL(String(u));if(url.pathname.includes('geocode'))return new Response(JSON.stringify({results:[{lat:25,lon:-80,rank:{confidence:1}}]}));const category=url.searchParams.get('categories')!,name=category.startsWith('accommodation')?'Harbor &amp;amp; Reed Inn':category.startsWith('catering')?'Harbor Cafe':'Harbor Museum';return new Response(JSON.stringify({features:[{properties:{name,categories:[category],lat:25,lon:-80,place_id:name,formatted:'42 Quay St, Harbor'}}]}))}
  if(String(u)==='https://api.tavily.com/search'&&JSON.parse(init.body).query.startsWith('"'))return new Response(JSON.stringify({results:[{url:'https://harbor.test/venue',title:'Harbor venue'}]}))
  if(String(u)==='https://harbor.test/venue')return new Response('<html><title>Harbor venues</title><body>Harbor city. Harbor &amp; Reed Inn has a courtyard garden and a reading lounge. Harbor Cafe serves seasonal vegetable bowls and wood-fired noodles. Harbor Museum houses maritime paintings and model ships.</body></html>')
  if(String(u)==='https://api.tavily.com/search')return new Response(JSON.stringify({results:[{title:'Harbor public visitors',url,content:'Hotel, dining and museum public listings.'}]}))
  if(String(u)===url)return new Response('<html><title>Harbor public visitors</title><body>Harbor Inn rooms. Harbor Cafe dinner. Harbor Museum tickets. Rooms $200. Menu served. Hours, prices and availability unverified.</body></html>')
  const reasonReq=JSON.parse(init.body);if(reasonReq.max_tokens===180){const packet=JSON.parse(reasonReq.messages.find((m:any)=>String(m.content).includes('Packet: ')).content.split('Packet: ')[1]);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({spanIds:[packet.spans.find((s:any)=>s.text.includes(packet.venue.kind==='hotel'?'courtyard':packet.venue.kind==='restaurant'?'vegetable':'maritime'))?.id].filter(Boolean)})}}]}))}if(reasonReq.max_tokens===120){const activity=reasonReq.messages.some((m:any)=>String(m.content).startsWith('Verify experience and reason'));return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(activity?{verdict:'no',reason:'no_experience'}:{verdict:'yes',reason:'none'})}}]}));}if(reasonReq.max_tokens===2200){return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({activities:[{line:3,decision:'recommend',spanId:'span3_3',unknowns:[]}]})}}]}))}if(reasonReq.max_tokens===900){
   const whys=['The source describes a courtyard garden and reading lounge.','The source describes seasonal vegetable bowls and wood-fired noodles.','The source describes maritime paintings and model ships.']
   const claims=['A courtyard garden and reading lounge','Seasonal vegetable bowls and wood-fired noodles','Maritime paintings and model ships']
   const packet=JSON.parse(reasonReq.messages.find((m:any)=>String(m.content).includes('Evidence: ')).content.split('Evidence: ')[1])[0]
   const reasons=[packet.venue.line].map(line=>({line,why:whys[line-1],claims:[{text:claims[line-1],evidenceIds:['ev'+line+'_1']}],unknowns:['Hours and availability not checked']}))
   return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({reasons})}}]}))
  }
  requests.push(reasonReq)
  if(requests.at(-1).max_tokens===8){const req=requests.pop();const activity=req.messages.some((m:any)=>String(m.content).startsWith('Verify experience and reason'));return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:activity?'no':'yes'}}]}))}
  const n=requests.length,source=JSON.parse(requests.at(-1).messages.filter((m:any)=>m.role==='tool').at(-1)?.content??'{}').source_records?.find((r:any)=>r.origin==='page')
  const name=n===1?'web_search':n===2?'select_itinerary_candidates':'create_file'
  const args=name==='web_search'?{query:'Harbor visitor guide'}:name==='select_itinerary_candidates'?{candidates:[{kind:'hotel',line:1},{kind:'restaurant',line:9999},{kind:'restaurant',line:1},{kind:'activity',line:3}]}:{title:'Synthetic Harbor itinerary',subtitle:'Invented dates June 12 to June 14',body:body+'\n- Hotel Recommendations unknown / learn-more\n- Restaurant Recommendations unknown / learn-more\n- Exotic seafood dishes for dinner\n- Liberty Tower\n- 10am office visit\n',itinerary_candidates:[{kind:'restaurant',name:'Invented Cafe'}],format:'pdf',kind:'itinerary'}
  return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:String(requests.length),function:{name,arguments:JSON.stringify(args)}}]}}]}))
 }))
 const tools=gateTools([...toolsFor(ctx),...files.tools],[ask]).active
 const result=await chatWithTools([{role:'user',content:ask}],{gatewayUrl:'https://gateway.test',apiKey:'fictional',model:'auto',deadlineAt:Date.now()+60000,onStage:async(_s,d)=>{if(d)stages.push(d)}},tools,ctx)
 expect(result.deliverable?.state).toBe('completed');expect(published).toHaveBeenCalledTimes(1);expect(stages).toContain('itinerary:places_api:ready_3');expect(stages).toContain('itinerary:accepted:h1_r1_a0');expect(stages).toContain('itinerary:partial_unverified:activity');expect(stages).toContain('itinerary:venue_evidence:r3_m0');expect(stages).toContain('itinerary:reasons:a2_r1');expect(stages).toContain('itinerary:evidence_first:a2_v3');expect(requests).toHaveLength(2)
 const html=published.mock.calls[0][0].find((f:any)=>f.path==='index.html').bytes.toString(),markdown=files.files()[0].markdown;
 if(typeof markdown!=='string')throw new Error('Expected itinerary markdown')
 expect(html).not.toContain('Invented dates');expect(stages).toContain('itinerary:reason_judge:yes');expect(html).toContain('Recommendation evidence');expect(markdown).toContain('https://harbor.test/venue');expect(html).not.toContain('{{source:');expect(html).toContain('courtyard garden');expect(html).toContain('wood-fired noodles');expect(html).not.toContain('Harbor Museum');expect(markdown).toContain('No evidence-backed meaningful weekend activity');expect(html).toContain('Geoapify');expect(html).toContain('OpenStreetMap contributors');expect(html).not.toContain('apiKey=');expect(html).toContain('Harbor &amp; Reed Inn');for(const forbidden of ['amp;amp','Address&amp;#58','learn-more','Exotic seafood','Liberty Tower','Invented Cafe'])expect(html).not.toContain(forbidden);expect((markdown.match(/Office visit/gi)||[])).toHaveLength(1);expect((markdown.match(/© OpenStreetMap contributors/g)||[])).toHaveLength(1);expect((markdown.match(/## Source provenance/g)||[])).toHaveLength(1);await mkdir('/tmp/venue-proof',{recursive:true});await writeFile('/tmp/venue-proof/page.html',html);await writeFile('/tmp/venue-proof/file.pdf',files.files()[0].bytes)

})
