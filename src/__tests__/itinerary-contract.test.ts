import * as React from "react"
;(globalThis as unknown as {React:unknown}).React=React
import {afterEach,describe,it,expect,vi} from 'vitest'
import {itineraryNeedsResearch,itineraryPageError} from '@/lib/files/itinerary-contract'
import {chatWithTools} from '@/lib/spectrum/dinghy'
import {renderSurfacePreview} from '@/lib/brand/surface-preview'
vi.mock('@/lib/data-portability/erasure-state',()=>({assertAccountActive:async()=>{}}))
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()})
const ask='Make an itinerary for founders visiting Harbor on Friday. Office tour at 10am then working sessions, hotel and restaurant recommendations, fun things to do on the weekend.'
const url='https://harbor.test/visitors'
const body='## Friday\n- 10:00 Office tour, supplied by user.\n- Working sessions: duration and venue to confirm.\n## Weekend\n:::stay\nHarbor Inn | unknown | unknown | Harbor | availability unverified | | '+url+'\n:::\n:::options\nHarbor Cafe | unknown | source-listed dining | hours unverified '+url+'\nHarbor Museum | unknown | source-listed activity | tickets unverified '+url+'\n:::\n:::sources\nVisitor directory | '+url+' | date unknown\n:::'
const tool=(name:string,data:unknown={})=>({name,description:'fictional',inputSchema:{type:'object'},execute:vi.fn(async()=>({success:true,data}))})
const candidateInput=(input:any)=>{if(typeof input.body!=='string')return input;const source=input.body.match(/source:(src\d+)/)?.[1]??'src2';const offset=input.pageOffset??0;const ref=(start:number,end:number)=>({source,field:'content',start:start+offset,end:end+offset});const missingStay=!input.body.includes(':::stay');const {pageOffset:_offset,...rest}=input;return {...rest,body:input.body.replace(/:::(stay|options|sources)[\s\S]*?:::/g,''),itinerary_candidates:[...(missingStay?[]:[{kind:'hotel',name:ref(0,10)}]),{kind:'restaurant',name:ref(12,23)},{kind:'activity',name:ref(25,38)}]}}
const call=(name:string,raw:unknown={})=>{const input=name==='create_file'?candidateInput(raw):raw;return ({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:name,function:{name,arguments:JSON.stringify(input)}}]}}]})}
const stop=(content='Done.')=>({choices:[{finish_reason:'stop',message:{content}}]})
const ctx={userId:'fictional',telegramId:0,telegramChatId:0,name:'Alex',timezone:'UTC',tokens:{}}
function harness(seq:unknown[]){const requests:any[]=[];vi.stubGlobal('fetch',vi.fn(async(_u,init)=>{requests.push(JSON.parse(init.body));return new Response(JSON.stringify(seq[requests.length-1]??stop()))}));return requests}
const opts={gatewayUrl:'https://gateway.test',apiKey:'test',model:'test'}
describe('researched itinerary contract',()=>{
 it('preserves ordinary supplied plans without requiring public research',()=>{expect(itineraryNeedsResearch('Write an itinerary from my meeting notes')).toBe(false);expect(itineraryNeedsResearch(ask)).toBe(true);expect(itineraryPageError('## Friday\nOffice tour.','Write an itinerary from my notes',[])).toBeNull()})
 it('rejects plain itinerary recommendations even with a day heading',()=>{expect(itineraryPageError('## Friday\n- Office tour.\n## Hotels\n- Harbor Inn',ask,[])).toContain('source links')})
 it('requires requested structured cards and the working sessions, not manufactured facts',()=>{expect(itineraryPageError(body,ask,[url])).toBeNull();expect(itineraryPageError(body.replace(':::stay',':::plain'),ask,[url])).toContain(':::stay');expect(itineraryPageError(body.replace(':::options',':::plain'),ask,[url])).toContain(':::options');expect(itineraryPageError(body.replace('Working sessions','Free time'),ask,[url])).toContain('working sessions');expect(itineraryPageError(body,ask,['https://other.test/'])).toContain('source links')})
 it('forces search and read, blocks premature creation, then publishes bound structured content',async()=>{
  const file=tool('create_file'),search=tool('web_search',{results:[{title:'Harbor Visitor Guide',url,content:'Source-reported visitor listings'}]}),read=tool('web_fetch',{title:'Harbor directory',url,content:'Harbor Inn. Harbor Cafe. Harbor Museum.'})
  const requests=harness([call('create_file',{title:'Harbor',body:'## Friday\nFake picks'}),call('web_search'),call('web_fetch'),call('create_file',{title:'Harbor visit',body:body.replace('Visitor directory | '+url,'{{source:src2.title}} | {{source:src2.url}}')}),stop()])
  const result=await chatWithTools([{role:'user',content:ask}],opts,[file,search,read,tool('find_places')],ctx)
  expect(requests[0].tool_choice).toBe('required');expect(requests[0].tools.map((t:any)=>t.function.name)).toContain('web_search');expect(read.execute).toHaveBeenCalled();expect(file.execute).toHaveBeenCalledTimes(1);expect(result.deliverable?.state).toBe('completed');expect(JSON.stringify(requests[0].messages)).toContain('unspecified Friday');expect(requests[0].tools.some((t:any)=>t.function.name==='find_places')).toBe(false)
 })
 it('does not invent recommendations when public research is unavailable',async()=>{const file=tool('create_file');harness([call('create_file',{title:'Harbor',body}),stop('Office visit supplied by the user. Recommendations were not verified.')]);const result=await chatWithTools([{role:'user',content:ask}],opts,[file],ctx);expectAgendaOnly(file);expect(result.deliverable?.state).toBe('completed')})
 it('local structured chat card never calls the network, including unsupported text',async()=>{
  const network=vi.fn(async()=>{throw Error('No network permitted')});vi.stubGlobal('fetch',network)
  const card=await renderSurfacePreview({title:'Harbor founders itinerary',subtitle:'Office visit and weekend options',body},'chat',[],true)
  expect(card.route).toBe('specialized');expect(card.bytes?.subarray(1,4).toString()).toBe('PNG');expect(network).not.toHaveBeenCalled()
  await renderSurfacePreview({title:'東京',body:'## 旅行\n東京'},'chat',[],true);expect(network).not.toHaveBeenCalled()
 })
})

describe('uncertainty stays in body, not decorative hero',()=>{
 it('uses the hotel name as hero when price/rating are unknown',async()=>{const {renderHtml}=await import('@/lib/files/render');const html=renderHtml({title:'Harbor founders visit',body});expect(html).toContain('hero-title">Harbor Inn');expect(html).not.toContain('★ unknown');expect(html).toContain('unknown')})
})

describe('production iMessage itinerary research wiring',()=>{
 it('uses actual offered search/reader to publish researched cards inside the short budget',async()=>{
  vi.stubEnv('TAVILY_API_KEY','fictional-key')
  const {toolsFor}=await import('@/lib/spectrum/imessage-tools')
  const requests:any[]=[]
  const file=tool('create_file')
  const seq=[call('web_search',{query:'Harbor visitor official guide'}),call('web_fetch',{url}),call('create_file',{title:'Harbor founders visit',pageOffset:16,body:body.replace('Visitor directory | '+url,'{{source:src2.title}} | {{source:src2.url}}')}),stop()]
  vi.stubGlobal('fetch',vi.fn(async(u,init)=>{
   if(String(u)==='https://api.tavily.com/search')return new Response(JSON.stringify({results:[{title:'Harbor guide',url,content:'Visitor listings'}]}))
   if(String(u)===url)return new Response('<html><title>Harbor visitors</title><body>Harbor Inn. Harbor Cafe. Harbor Museum.'+' Repeated public visitor text.'.repeat(400)+'</body></html>')
   const r=JSON.parse(init.body);requests.push(r);return new Response(JSON.stringify(seq[requests.length-1]??stop()))
  }))
  const result=await chatWithTools([{role:'user',content:ask}],{...opts,deadlineAt:Date.now()+55_000},[...toolsFor(ctx),file],ctx)
  expect(requests[0].tools.map((t:any)=>t.function.name)).toContain('web_fetch')
  expect(requests[1].messages.filter((m:any)=>m.role==='tool').at(-1).content).toContain('src2')
  expect(requests[1].messages.filter((m:any)=>m.role==='tool').at(-1).content).toContain('source_records')
  const readResult=JSON.parse(requests[1].messages.filter((m:any)=>m.role==='tool').at(-1).content)
  expect(readResult.source_records[0].id).toBe('src2');expect(readResult.source_records[0].content_truncated).toBe(true)
  expect(requests[1].messages.filter((m:any)=>m.role==='tool').at(-1).content.length).toBeLessThanOrEqual(4000)
  expect(file.execute).toHaveBeenCalledTimes(1)
  expect(result.deliverable?.state).toBe('completed')
  expect(JSON.stringify((file.execute.mock.calls as unknown[][])[0][0])).toContain('Source provenance')
 })
 it('identifies missing page-reader once without repeated gateway/file attempts',async()=>{
  const search=tool('web_search'),file=tool('create_file'),onStage=vi.fn(async()=>{})
  const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock)
  const result=await chatWithTools([{role:'user',content:ask}],{...opts,onStage},[search,file],ctx)
  expect(onStage).toHaveBeenCalledWith('tool','research:unavailable:web_fetch')
  expect(fetchMock).not.toHaveBeenCalled();expectAgendaOnly(file)
  expect(result.reply).toContain('unverified');expect(result.deliverable?.state).toBe('completed')
 })
 it('HTTP reader failure publishes agenda only, never verified sources',async()=>{
  vi.stubEnv('TAVILY_API_KEY','fictional-key')
  const {liveInfoTools}=await import('@/lib/spectrum/imessage-tools')
  const file=tool('create_file'),onStage=vi.fn(async()=>{})
  let iteration=0
  vi.stubGlobal('fetch',vi.fn(async(u)=>{
   if(String(u)==='https://api.tavily.com/search')return new Response(JSON.stringify({results:[{title:'Harbor guide',url,content:'Visitor listings'}]}))
   if(String(u)===url)return new Response('Unavailable',{status:403})
   return new Response(JSON.stringify([call('web_search',{query:'Harbor official guide'}),call('web_fetch',{url}),call('create_file',{title:'Harbor',body}),stop('Page read blocked; recommendations unverified.')][iteration++]??stop()))
  }))
  const result=await chatWithTools([{role:'user',content:ask}],{...opts,onStage},[...liveInfoTools(),file],ctx)
  expectAgendaOnly(file);expect(onStage).toHaveBeenCalledWith('tool','research:read_failed');expect(result.deliverable?.state).toBe('completed')
 })
})

describe('server-owned required read transition',()=>{
 it('reads observed URLs even when gateway ignores required tool choice and asks only for files',async()=>{
  const file=tool('create_file'),search=tool('web_search',{results:[{title:'Harbor',url,content:'Listings'}]}),read=tool('web_fetch',{title:'Harbor guide',url,content:'Harbor Inn. Harbor Cafe. Harbor Museum.'}),onStage=vi.fn(async()=>{})
  const requests=harness([call('web_search'),call('create_file',{title:'Harbor',body:body.replace('Visitor directory | '+url,'{{source:src2.title}} | {{source:src2.url}}')}),stop()])
  const result=await chatWithTools([{role:'user',content:ask}],{...opts,onStage},[search,read,file],ctx)
  expect(read.execute).toHaveBeenCalledTimes(1);expect(file.execute).toHaveBeenCalledTimes(1);expect(result.deliverable?.state).toBe('completed')
  expect(onStage).toHaveBeenCalledWith('tool','research:read_ok');expect(requests).toHaveLength(2)
 })
 it('tries one other observed source on403 and never fabricates a URL',async()=>{
  const second='https://harbor.test/second',file=tool('create_file'),search=tool('web_search',{results:[{title:'One',url,content:'lead'},{title:'Two',url:second,content:'lead'}]}),read={...tool('web_fetch'),execute:vi.fn(async(i:any)=>i.url===url?{success:false,error:'HTTP403'}:{success:true,data:{url:second,title:'Second guide',content:'Harbor Inn. Harbor Cafe. Harbor Museum.'}})}
  harness([call('web_search'),call('create_file',{title:'Harbor',body:body.replaceAll(url,second).replace('Visitor directory | '+second,'{{source:src3.title}} | {{source:src3.url}}')}),stop()])
  const result=await chatWithTools([{role:'user',content:ask}],opts,[search,read,file],ctx)
  expect(read.execute.mock.calls.map(c=>c[0].url)).toEqual([url,second]);expect(file.execute).toHaveBeenCalledTimes(1);expect(result.deliverable?.state).toBe('completed')
 })
 it('empty source text never satisfies page research',async()=>{
  const file=tool('create_file'),search=tool('web_search',{results:[{title:'Harbor',url,content:'lead'}]}),read=tool('web_fetch',{title:'Empty page',url,content:''}),onStage=vi.fn(async()=>{})
  harness([call('web_search'),call('create_file',{title:'Harbor',body})])
  const result=await chatWithTools([{role:'user',content:ask}],{...opts,onStage},[search,read,file],ctx)
  expect(onStage).toHaveBeenCalledWith('tool','research:read_empty');expectAgendaOnly(file);expect(result.deliverable?.state).toBe('completed')
 })
 it('honors full egress block on the required server read',async()=>{
  vi.stubEnv('DINGHY_EGRESS_POLICY','block');vi.stubEnv('DINGHY_PRIVATE_ROUTE','on');vi.stubEnv('DINGHY_PRIVATE_PROVIDERS','test-private')
  const file=tool('create_file'),search=tool('web_search'),read=tool('web_fetch'),onStage=vi.fn(async()=>{})
  harness([call('web_search'),stop('Research blocked.')])
  await chatWithTools([{role:'user',content:ask,googleDerived:true}],{...opts,onStage},[search,read,file],ctx)
  expect(search.execute).not.toHaveBeenCalled();expect(read.execute).not.toHaveBeenCalled();expect(file.execute).not.toHaveBeenCalled()
 })
})

it('publishes compiled candidates with no manual binding tokens in body on first attempt',async()=>{
 const file=tool('create_file'),search=tool('web_search',{results:[{title:'Harbor visitors',url,content:'listing'}]}),read=tool('web_fetch',{title:'Harbor visitors',url,content:'Harbor Inn. Harbor Cafe. Harbor Museum.'}),onStage=vi.fn(async()=>{})
 harness([call('web_search'),call('create_file',{title:'Harbor synthetic',body}),call('create_file',{title:'Harbor synthetic',body}),stop()])
 const result=await chatWithTools([{role:'user',content:ask}],{...opts,onStage},[search,read,file],ctx)
 expect(file.execute).toHaveBeenCalledTimes(1);expect(onStage).toHaveBeenCalledWith('tool','itinerary:candidates_compiled');expect(result.deliverable?.state).toBe('completed')
})

import {itineraryShapeErrorCode} from '@/lib/files/itinerary-contract'
it('records safe finite shape codes without retaining user body or raw errors',()=>{
 expect(itineraryShapeErrorCode('Itinerary contract: organize by day')).toBe('day_sections')
 expect(itineraryShapeErrorCode('Itinerary recommendations require observed source links')).toBe('source_rows')
 expect(itineraryShapeErrorCode('Use a supported :::stay hotel row')).toBe('stay_rows')
 expect(itineraryShapeErrorCode('Use :::options rows')).toBe('options_rows')
 expect(itineraryShapeErrorCode('Preserve the requested working sessions')).toBe('working_sessions')
 expect(itineraryShapeErrorCode('private unexpected text')).toBe('other')
})
it('offers only create_file on the bounded itinerary repair and keeps research unexecuted if the gateway ignores it',async()=>{
 const file=tool('create_file'),search=tool('web_search',{results:[{title:'Harbor public guide',url,content:'lead'}]}),read=tool('web_fetch',{title:'Harbor public guide',url,content:'Harbor Inn. Harbor Cafe. Harbor Museum.'}),stage=vi.fn(async()=>{})
 const bad=body.replace(/:::stay[\s\S]*?:::/,'Hotel unknown')
 const req=harness([call('web_search'),call('create_file',{title:'Synthetic',body:bad}),call('web_fetch',{url}),stop()])
 const result=await chatWithTools([{role:'user',content:ask}],{...opts,onStage:stage},[search,read,file],ctx)
 expect(req[2].tools.map((t:any)=>t.function.name)).toEqual(['create_file'])
 expect(stage).toHaveBeenCalledWith('tool','invalid:itinerary_shape:stay_rows')
 expect(read.execute).toHaveBeenCalledTimes(1);expectAgendaOnly(file);expect(result.deliverable?.state).toBe('completed')
})

import {ITINERARY_DAY_HEADING_NOTE,itineraryDayFormatCode} from '@/lib/files/itinerary-contract'
import {deliverablePageError,contractNote} from '@/lib/files/deliverable-contract'
describe('explicit day heading grammar, unchanged strict gate',()=>{
 const contract={kind:'itinerary' as const,request:ask}
 it.each(['## Friday','### Fri','## Day 1','### Stop 2','## 2026-10-16'])('accepts supported heading %s',(h)=>{expect(deliverablePageError(contract,{body:body.replace('## Friday',h)},[url])).toBeNull()})
 it.each([['# Friday','h1'],['#### Friday','h4_plus'],['## 🌴 Friday','unsupported_heading_prefix'],['## Schedule','unsupported_heading_prefix'],['**Friday**','bold_heading'],['Friday','no_markdown_heading']])('rejects unsupported heading %s with safe code',(h,code)=>{const b=body.replace('## Friday',h).replace('## Weekend','Weekend');expect(deliverablePageError(contract,{body:b},[url])).toContain(ITINERARY_DAY_HEADING_NOTE);expect(itineraryDayFormatCode(b)).toBe(code)})
 it('puts the same literal grammar in primary tool/body/contract instructions',async()=>{const {fileToolsFor}=await import('@/lib/files/tool');const files=fileToolsFor();const create=files.tools.find(t=>t.name==='create_file')!;expect(create.description).toContain(ITINERARY_DAY_HEADING_NOTE);expect((create.inputSchema as any).properties.body.description).toContain(ITINERARY_DAY_HEADING_NOTE);expect(contractNote(contract)).toContain(ITINERARY_DAY_HEADING_NOTE);expect(ITINERARY_DAY_HEADING_NOTE).toContain('## Friday');files.close()})
 it('first attempt succeeds using the instructed literal heading',async()=>{const file=tool('create_file'),search=tool('web_search',{results:[{title:'Harbor',url,content:'Harbor Inn. Harbor Cafe. Harbor Museum.'}]}),read=tool('web_fetch',{url,title:'Harbor',content:'Harbor Inn. Harbor Cafe. Harbor Museum.'}),stage=vi.fn(async()=>{});const req=harness([call('web_search'),call('create_file',{title:'Fictional',body}),stop()]);const result=await chatWithTools([{role:'user',content:ask}],{...opts,onStage:stage},[search,read,file],ctx);expect(JSON.stringify(req[0].messages)).toContain(ITINERARY_DAY_HEADING_NOTE);expect(file.execute).toHaveBeenCalledTimes(1);expect(stage).not.toHaveBeenCalledWith('tool','repair:file_once');expect(result.deliverable?.state).toBe('completed')})
 it('diagnoses unsupported heading and returns exact grammar on the existing single repair',async()=>{const file=tool('create_file'),search=tool('web_search',{results:[{title:'Harbor',url,content:'Harbor Inn. Harbor Cafe. Harbor Museum.'}]}),read=tool('web_fetch',{url,title:'Harbor',content:'Harbor Inn. Harbor Cafe. Harbor Museum.'}),stage=vi.fn(async()=>{});const b=body.replace('## Friday','# Friday');const req=harness([call('web_search'),call('create_file',{title:'Fictional',body:b}),call('create_file',{title:'Fictional',body}),stop()]);const result=await chatWithTools([{role:'user',content:ask}],{...opts,onStage:stage},[search,read,file],ctx);expect(stage).toHaveBeenCalledWith('tool','invalid:itinerary_format:h1');expect(JSON.stringify(req[2].messages)).toContain(ITINERARY_DAY_HEADING_NOTE);expect(req[2].tools.map((t:any)=>t.function.name)).toEqual(['create_file']);expect(file.execute).toHaveBeenCalledTimes(1);expect(result.deliverable?.state).toBe('completed')})
})

import {SourceRecords,compileItinerarySources,bindFileSources} from '@/lib/files/source-records'
describe('server-owned itinerary sources',()=>{
 const withoutSources=body.replace(/:::sources[\s\S]*?:::/,'')
 it('first attempt creates source rows from actually bound registry entries without a model sources block',async()=>{const file=tool('create_file'),search=tool('web_search',{results:[{title:'Harbor',url,content:'Harbor Inn. Harbor Cafe. Harbor Museum.'}]}),read=tool('web_fetch',{url,title:'Harbor guide',content:'Harbor Inn. Harbor Cafe. Harbor Museum.'}),stage=vi.fn(async()=>{});harness([call('web_search'),call('create_file',{title:'Fictional',body:withoutSources}),stop()]);const result=await chatWithTools([{role:'user',content:ask}],{...opts,onStage:stage},[search,read,file],ctx);expect(result.deliverable?.state).toBe('completed');expect(file.execute).toHaveBeenCalledTimes(1);const b=(file.execute.mock.calls as unknown[][])[0][0] as any;expect(b.body).toContain(':::sources');expect(b.body).toContain('Harbor guide | '+url);expect(stage).toHaveBeenCalledWith('tool','itinerary:sources_compiled');expect(stage).not.toHaveBeenCalledWith('tool','repair:file_once')})
 it('repair restores explicitly typed hotel while server still owns sources, one publication',async()=>{const file=tool('create_file'),search=tool('web_search',{results:[{title:'Harbor',url,content:'Harbor Inn. Harbor Cafe. Harbor Museum.'}]}),read=tool('web_fetch',{url,title:'Harbor guide',content:'Harbor Inn. Harbor Cafe. Harbor Museum.'}),stage=vi.fn(async()=>{});harness([call('web_search'),call('create_file',{title:'Fictional',body:withoutSources.replace(/:::stay[\s\S]*?:::/,'Hotel unknown')}),call('create_file',{title:'Fictional',body:withoutSources}),stop()]);const result=await chatWithTools([{role:'user',content:ask}],{...opts,onStage:stage},[search,read,file],ctx);expect(result.deliverable?.state).toBe('completed');expect(stage).toHaveBeenCalledWith('tool','invalid:itinerary_shape:stay_rows');expect(stage).toHaveBeenCalledWith('tool','repair:file_once');expect(file.execute).toHaveBeenCalledTimes(1)})
 it('still rejects unknown explicit sources rather than hiding them',()=>{const records=new SourceRecords();const used=records.capture('web_fetch',{title:'Harbor',url,content:'Harbor Inn. Harbor Cafe. Harbor Museum.'},'fictional-check');expect(compileItinerarySources({body:':::sources\nOther | https://unknown.test/\n:::'},used,[url])).toHaveProperty('error')})
 it('does not promote unused search entries, preserves source provenance, and deduplicates used URLs',()=>{const records=new SourceRecords();records.capture('web_search',{results:[{title:'Unused',url:'https://unused.test/',content:'snippet'}]},'fictional-check');const used=records.capture('web_fetch',{title:'Harbor | source',url,content:'Harbor Inn. Harbor Cafe. Harbor Museum.'},'fictional-check');const bound=bindFileSources({body:'## Friday\n{{source:src2.url}}'},records,true);if('error'in bound)throw Error(bound.error);expect(bound.usedSources).toEqual(used);const compiled=compileItinerarySources(bound.input,[...used,...used],[url]);if('error'in compiled)throw Error(compiled.error);const text=(compiled.input as any).body;expect(text).toContain('Source provenance');expect(text).not.toContain('unused.test');expect(text).toContain('Harbor &#124; source | '+url);expect(text.match(/Harbor &#124; source \|/g)).toHaveLength(1);expect(compileItinerarySources(compiled.input,used,[url])).toEqual(compiled)})
 it('does not hide a malformed explicit sources block',()=>{const records=new SourceRecords();const used=records.capture('web_fetch',{url,title:'Harbor',content:'Harbor Inn. Harbor Cafe. Harbor Museum.'},'fictional-check');expect(compileItinerarySources({body:'## Friday\n:::sources\nBroken'},used,[url])).toHaveProperty('error')})
 it('does not manufacture a source from an empty used registry',()=>{expect(compileItinerarySources({body:'## Friday\nNo evidence'},[],[url])).toHaveProperty('error')})
})

describe('bounded required read fallback',()=>{
 const urls=Array.from({length:8},(_,i)=>`https://harbor.test/source${i}`)
 const search=()=>tool('web_search',{results:urls.map((u,i)=>({title:`Fictional ${i}`,url:u,content:'Search lead, not verified page'}))})
 it('passes on the third actual URL after HTTP and network failures, without another gateway turn',async()=>{
  const file=tool('create_file'),stage=vi.fn(async()=>{}),read={...tool('web_fetch'),execute:vi.fn(async(i:any)=>i.url===urls[2]?{success:true,data:{title:'Harbor verified',url:i.url,content:'Harbor Inn. Harbor Cafe. Harbor Museum.'}}:{success:false,publicReadFailure:i.url===urls[0]?'http' as const:'network' as const,error:'untrusted private raw error'})}
  const req=harness([call('web_search'),call('create_file',{title:'Harbor',body:body.replaceAll(url,urls[2]).replace('Visitor directory | '+urls[2],'{{source:src9.title}} | {{source:src9.url}}')}),stop()])
  const result=await chatWithTools([{role:'user',content:ask}],{...opts,onStage:stage},[search(),read,file],ctx)
  expect(read.execute.mock.calls.map(c=>c[0].url).slice(0,3)).toEqual(urls.slice(0,3));expect(read.execute.mock.calls.length).toBeLessThanOrEqual(6);expect(file.execute).toHaveBeenCalledTimes(1);expect(result.deliverable?.state).toBe('completed');expect(req).toHaveLength(2)
  expect(stage).toHaveBeenCalledWith('tool','research:read_failure:http');expect(stage).toHaveBeenCalledWith('tool','research:read_failure:network');expect(JSON.stringify(stage.mock.calls)).not.toContain('private raw')
 })
 it('stops at six actual URLs with no recommendation from search snippets',async()=>{
  const file=tool('create_file'),stage=vi.fn(async()=>{}),read={...tool('web_fetch'),execute:vi.fn(async(_input:any)=>({success:false,publicReadFailure:'timeout' as const,error:'raw'}))};harness([call('web_search')])
  const result=await chatWithTools([{role:'user',content:ask}],{...opts,onStage:stage},[search(),read,file],ctx)
  expect(read.execute.mock.calls.map(c=>(c[0] as any).url)).toEqual(urls.slice(0,6));expectAgendaOnly(file);expect(result.deliverable?.state).toBe('completed');expect(stage).toHaveBeenCalledWith('tool','research:read_failure:timeout')
 })
 it('stops fallback when synthesis headroom falls below18s',async()=>{
  const start=Date.now();const clock=vi.spyOn(Date,'now').mockReturnValue(start),file=tool('create_file'),stage=vi.fn(async()=>{}),read={...tool('web_fetch'),execute:vi.fn(async()=>{clock.mockReturnValue(start+83_000);return{success:false,publicReadFailure:'http' as const}})};harness([call('web_search')])
  try{await chatWithTools([{role:'user',content:ask}],{...opts,deadlineAt:start+100_000,onStage:stage},[search(),read,file],ctx);expect(read.execute).toHaveBeenCalledTimes(1);expect(stage).toHaveBeenCalledWith('tool','research:read_budget');expectAgendaOnly(file)}finally{clock.mockRestore()}
 })
 it('classifies thrown custom reader errors without retaining their text',async()=>{
  const file=tool('create_file'),stage=vi.fn(async()=>{}),read={...tool('web_fetch'),execute:vi.fn(async()=>{throw Error('private message')})};harness([call('web_search')]);await chatWithTools([{role:'user',content:ask}],{...opts,onStage:stage},[search(),read,file],ctx);expect(stage).toHaveBeenCalledWith('tool','research:read_failure:network');expect(JSON.stringify(stage.mock.calls)).not.toContain('private message');expectAgendaOnly(file)
 })
})

function expectAgendaOnly(file:{execute:{mock:{calls:unknown[][]}}}){
 expect(file.execute).toHaveBeenCalledTimes(1)
 const input=file.execute.mock.calls[0][0] as {body:string;title:string}
 expect(input.title).toBe('Unverified itinerary');expect(input.body).toContain('No hotel, restaurant or activity is recommended')
 expect(input.body).not.toMatch(/:::stay|:::options|:::sources|Harbor Inn|Harbor Cafe|Harbor Museum/)
 expect(input.body).toContain('10am');expect(input.body).toContain('Working sessions')
}
