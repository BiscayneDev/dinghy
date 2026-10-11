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
const call=(name:string,input:unknown={})=>({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:name,function:{name,arguments:JSON.stringify(input)}}]}}]})
const stop=(content='Done.')=>({choices:[{finish_reason:'stop',message:{content}}]})
const ctx={userId:'fictional',telegramId:0,telegramChatId:0,name:'Alex',timezone:'UTC',tokens:{}}
function harness(seq:unknown[]){const requests:any[]=[];vi.stubGlobal('fetch',vi.fn(async(_u,init)=>{requests.push(JSON.parse(init.body));return new Response(JSON.stringify(seq[requests.length-1]??stop()))}));return requests}
const opts={gatewayUrl:'https://gateway.test',apiKey:'test',model:'test'}
describe('researched itinerary contract',()=>{
 it('preserves ordinary supplied plans without requiring public research',()=>{expect(itineraryNeedsResearch('Write an itinerary from my meeting notes')).toBe(false);expect(itineraryNeedsResearch(ask)).toBe(true);expect(itineraryPageError('## Friday\nOffice tour.','Write an itinerary from my notes',[])).toBeNull()})
 it('rejects plain itinerary recommendations even with a day heading',()=>{expect(itineraryPageError('## Friday\n- Office tour.\n## Hotels\n- Harbor Inn',ask,[])).toContain('source links')})
 it('requires requested structured cards and the working sessions, not manufactured facts',()=>{expect(itineraryPageError(body,ask,[url])).toBeNull();expect(itineraryPageError(body.replace(':::stay',':::plain'),ask,[url])).toContain(':::stay');expect(itineraryPageError(body.replace(':::options',':::plain'),ask,[url])).toContain(':::options');expect(itineraryPageError(body.replace('Working sessions','Free time'),ask,[url])).toContain('working sessions');expect(itineraryPageError(body,ask,['https://other.test/'])).toContain('source links')})
 it('forces search and read, blocks premature creation, then publishes bound structured content',async()=>{
  const file=tool('create_file'),search=tool('web_search',{results:[{title:'Harbor Visitor Guide',url,content:'Source-reported visitor listings'}]}),read=tool('web_fetch',{title:'Harbor directory',url,content:'Hotel and dining listings. Prices unknown.'})
  const requests=harness([call('create_file',{title:'Harbor',body:'## Friday\nFake picks'}),call('web_search'),call('web_fetch'),call('create_file',{title:'Harbor visit',body:body.replace('Visitor directory | '+url,'{{source:src2.title}} | {{source:src2.url}}')}),stop()])
  const result=await chatWithTools([{role:'user',content:ask}],opts,[file,search,read,tool('find_places')],ctx)
  expect(requests[0].tool_choice.function.name).toBe('web_search');expect(read.execute).toHaveBeenCalled();expect(file.execute).toHaveBeenCalledTimes(1);expect(result.deliverable?.state).toBe('completed');expect(JSON.stringify(requests[0].messages)).toContain('unspecified Friday');expect(requests[0].tools.some((t:any)=>t.function.name==='find_places')).toBe(false)
 })
 it('does not invent recommendations when public research is unavailable',async()=>{const file=tool('create_file');harness([call('create_file',{title:'Harbor',body}),stop('Office visit supplied by the user. Recommendations were not verified.')]);const result=await chatWithTools([{role:'user',content:ask}],opts,[file],ctx);expect(file.execute).not.toHaveBeenCalled();expect(result.deliverable?.state).toBe('unfulfilled')})
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
  const seq=[call('web_search',{query:'Harbor visitor official guide'}),call('web_fetch',{url}),call('create_file',{title:'Harbor founders visit',body:body.replace('Visitor directory | '+url,'{{source:src2.title}} | {{source:src2.url}}')}),stop()]
  vi.stubGlobal('fetch',vi.fn(async(u,init)=>{
   if(String(u)==='https://api.tavily.com/search')return new Response(JSON.stringify({results:[{title:'Harbor guide',url,content:'Visitor listings'}]}))
   if(String(u)===url)return new Response('<html><title>Harbor visitors</title><body>Hotel, dining and museum listings. Prices and hours unknown.'+' Repeated public visitor text.'.repeat(400)+'</body></html>')
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
  expect(fetchMock).not.toHaveBeenCalled();expect(file.execute).not.toHaveBeenCalled()
  expect(result.reply).toContain('not researched');expect(result.deliverable?.state).toBe('unfulfilled')
 })
 it('HTTP reader failure does not become a verified source or published file',async()=>{
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
  expect(file.execute).not.toHaveBeenCalled();expect(onStage).toHaveBeenCalledWith('tool','research:read_failed');expect(result.deliverable?.state).toBe('unfulfilled')
 })
})

describe('server-owned required read transition',()=>{
 it('reads observed URLs even when gateway ignores required tool choice and asks only for files',async()=>{
  const file=tool('create_file'),search=tool('web_search',{results:[{title:'Harbor',url,content:'Listings'}]}),read=tool('web_fetch',{title:'Harbor guide',url,content:'Hotel and dining listings.'}),onStage=vi.fn(async()=>{})
  const requests=harness([call('web_search'),call('create_file',{title:'Harbor',body:body.replace('Visitor directory | '+url,'{{source:src2.title}} | {{source:src2.url}}')}),stop()])
  const result=await chatWithTools([{role:'user',content:ask}],{...opts,onStage},[search,read,file],ctx)
  expect(read.execute).toHaveBeenCalledTimes(1);expect(file.execute).toHaveBeenCalledTimes(1);expect(result.deliverable?.state).toBe('completed')
  expect(onStage).toHaveBeenCalledWith('tool','research:read_ok');expect(requests).toHaveLength(2)
 })
 it('tries one other observed source on403 and never fabricates a URL',async()=>{
  const second='https://harbor.test/second',file=tool('create_file'),search=tool('web_search',{results:[{title:'One',url,content:'lead'},{title:'Two',url:second,content:'lead'}]}),read={...tool('web_fetch'),execute:vi.fn(async(i:any)=>i.url===url?{success:false,error:'HTTP403'}:{success:true,data:{url:second,title:'Second guide',content:'Public listing.'}})}
  harness([call('web_search'),call('create_file',{title:'Harbor',body:body.replaceAll(url,second).replace('Visitor directory | '+second,'{{source:src3.title}} | {{source:src3.url}}')}),stop()])
  const result=await chatWithTools([{role:'user',content:ask}],opts,[search,read,file],ctx)
  expect(read.execute.mock.calls.map(c=>c[0].url)).toEqual([url,second]);expect(file.execute).toHaveBeenCalledTimes(1);expect(result.deliverable?.state).toBe('completed')
 })
 it('empty source text never satisfies page research',async()=>{
  const file=tool('create_file'),search=tool('web_search',{results:[{title:'Harbor',url,content:'lead'}]}),read=tool('web_fetch',{title:'Empty page',url,content:''}),onStage=vi.fn(async()=>{})
  harness([call('web_search'),call('create_file',{title:'Harbor',body})])
  const result=await chatWithTools([{role:'user',content:ask}],{...opts,onStage},[search,read,file],ctx)
  expect(onStage).toHaveBeenCalledWith('tool','research:read_empty');expect(file.execute).not.toHaveBeenCalled();expect(result.deliverable?.state).toBe('unfulfilled')
 })
 it('honors full egress block on the required server read',async()=>{
  vi.stubEnv('DINGHY_EGRESS_POLICY','block');vi.stubEnv('DINGHY_PRIVATE_ROUTE','on');vi.stubEnv('DINGHY_PRIVATE_PROVIDERS','test-private')
  const file=tool('create_file'),search=tool('web_search'),read=tool('web_fetch'),onStage=vi.fn(async()=>{})
  harness([call('web_search'),stop('Research blocked.')])
  await chatWithTools([{role:'user',content:ask,googleDerived:true}],{...opts,onStage},[search,read,file],ctx)
  expect(search.execute).not.toHaveBeenCalled();expect(read.execute).not.toHaveBeenCalled();expect(file.execute).not.toHaveBeenCalled()
 })
})

it('publishes source-linked structured itinerary when the model omits literal binding tokens twice',async()=>{
 const file=tool('create_file'),search=tool('web_search',{results:[{title:'Harbor visitors',url,content:'listing'}]}),read=tool('web_fetch',{title:'Harbor visitors',url,content:'Public visitor listing.'}),onStage=vi.fn(async()=>{})
 harness([call('web_search'),call('create_file',{title:'Harbor synthetic',body}),call('create_file',{title:'Harbor synthetic',body}),stop()])
 const result=await chatWithTools([{role:'user',content:ask}],{...opts,onStage},[search,read,file],ctx)
 expect(file.execute).toHaveBeenCalledTimes(1);expect(onStage).toHaveBeenCalledWith('tool','binding:observed_links');expect(result.deliverable?.state).toBe('completed')
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
 const file=tool('create_file'),search=tool('web_search',{results:[{title:'Harbor public guide',url,content:'lead'}]}),read=tool('web_fetch',{title:'Harbor public guide',url,content:'public guide'}),stage=vi.fn(async()=>{})
 const bad=body.replace(/:::stay[\s\S]*?:::/,'Hotel unknown')
 const req=harness([call('web_search'),call('create_file',{title:'Synthetic',body:bad}),call('web_fetch',{url}),stop()])
 const result=await chatWithTools([{role:'user',content:ask}],{...opts,onStage:stage},[search,read,file],ctx)
 expect(req[2].tools.map((t:any)=>t.function.name)).toEqual(['create_file'])
 expect(stage).toHaveBeenCalledWith('tool','invalid:itinerary_shape:stay_rows')
 expect(read.execute).toHaveBeenCalledTimes(1);expect(file.execute).not.toHaveBeenCalled();expect(result.deliverable?.state).toBe('unfulfilled')
})
