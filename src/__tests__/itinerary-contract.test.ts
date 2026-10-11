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
  expect(requests[0].tool_choice.function.name).toBe('web_search');expect(requests[2].tool_choice.function.name).toBe('web_fetch');expect(file.execute).toHaveBeenCalledTimes(1);expect(result.deliverable?.state).toBe('completed');expect(JSON.stringify(requests[0].messages)).toContain('unspecified Friday');expect(requests[0].tools.some((t:any)=>t.function.name==='find_places')).toBe(false)
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
