import { describe, expect, it } from 'vitest'
import { SourceRecords } from '@/lib/files/source-records'
const hit = {title:'Harbor shop directory',url:'https://airport.test/directory',published_date:null,content:'Terminal 4. Hours: 09:00-18:00. Charger $19.00. Stock not reported.'}
describe('immutable turn source records',()=>{
 it('preserves exact returned data and missing values',()=>{const s=new SourceRecords();const [r]=s.capture('web_search',{results:[hit]},'2030-06-04T12:00:00Z');expect(r).toEqual({...hit,id:'src1',checked_at:'2030-06-04T12:00:00Z',origin:'search'});expect(Object.isFrozen(r)).toBe(true);expect(s.resolve({source:r.id,field:'published_date'})).toHaveProperty('error');expect(s.resolve({source:r.id,field:'url'})).toHaveProperty('value',hit.url)})
 it('never accepts model-created records or unsafe URLs',()=>{const s=new SourceRecords();expect(s.capture('create_file',{results:[hit]},'test')).toEqual([]);expect(s.capture('web_search',{results:[{...hit,url:'javascript:alert(1)'},{...hit,url:'https://user:secret@airport.test'}]},'test')).toEqual([]);expect(s.resolve({source:'src1',field:'title'})).toHaveProperty('error')})
 it('copies literal excerpts rather than model-retyped values',()=>{const s=new SourceRecords();s.capture('web_fetch',hit,'2030-06-04T12:00:00Z');expect(s.resolve({source:'src1',field:'content',start:0,end:10})).toHaveProperty('value','Terminal 4');expect(s.resolve({source:'src1',field:'content',start:40,end:43})).toHaveProperty('error');expect(s.resolve({source:'src1',field:'content',start:0,end:29})).toHaveProperty('error');expect(s.resolve({source:'src1',field:'content',start:-1,end:10})).toHaveProperty('error');expect(s.resolve({source:'src1',field:'url',start:0,end:10})).toHaveProperty('error')})
 it('does not upgrade search text into stock or route confirmation',()=>{const s=new SourceRecords();const [r]=s.capture('web_search',{results:[hit]},'test');expect(r).not.toHaveProperty('stockConfirmed');expect(r).not.toHaveProperty('verifiedRoute');expect(r.origin).toBe('search');expect(new SourceRecords().resolve({source:r.id,field:'content'})).toHaveProperty('error')})
})

import { bindFileSources } from '@/lib/files/source-records'
describe('server binding before render',()=>{
 function setup() {const s=new SourceRecords();s.capture('web_search',{results:[hit]},'2030-06-04T12:00:00Z');return s}
 it('renders literal price and terminal unchanged when surrounding copy changes',()=>{const s=setup();for(const word of ['Pick','Maybe']){const r=bindFileSources({title:'Comparison',body:word+': {{source:src1.content:0:10}}. {{source:src1.content:40:46}}'},s,true);expect(r).not.toHaveProperty('error');if('input' in r){const b=(r.input as any).body;expect(b).toContain('Terminal 4');expect(b).toContain('$19.00');expect(b).toContain('search snippet');expect(b).toContain('not independent confirmation');}}})
 it('stops missing, fabricated, malformed and unavailable references before publishing',()=>{const s=setup();for(const token of ['{{source:src9.title}}','{{source:src1.price}}','{{source:src1.content:1:9000}}','{{source:src1.published_date}}','{{source:src1.title'])expect(bindFileSources({body:token},s)).toHaveProperty('error');expect(bindFileSources({body:'A retyped price'},s,true)).toHaveProperty('error')})
 it('neutralizes external block markup, links and instructions as literal source text',()=>{const s=new SourceRecords();s.capture('web_fetch',{...hit,content:':::options\nEvil | $99\n:::\n[click](javascript:evil) <script>do()</script>'},'test');const r=bindFileSources({title:'Facts',body:'{{source:src1.content}}'},s);expect(r).not.toHaveProperty('error');if('input' in r){expect((r.input as any).body).not.toContain(':::options');expect((r.input as any).body).not.toContain('<script>');expect((r.input as any).body).not.toContain('[click]');}})
 it('keeps no-research ordinary documents unchanged',()=>{const input={title:'Note',body:'Call the museum.'};expect(bindFileSources(input,new SourceRecords())).toEqual({input:{...input,subtitle:undefined},count:0})})
})

import { afterEach, vi } from 'vitest'
import { chatWithTools } from '@/lib/spectrum/dinghy'
vi.mock('@/lib/data-portability/erasure-state',()=>({assertAccountActive:vi.fn(async()=>{})}))
afterEach(()=>vi.unstubAllGlobals())
it('gives generation registry IDs and resolves them before file execution',async()=>{
 const file={name:'create_file',description:'test',inputSchema:{},execute:vi.fn(async(_input:unknown,_ctx:unknown)=>({success:true,data:{status:'queued_for_delivery'}}))}
 const search={name:'web_search',description:'test',inputSchema:{},execute:vi.fn(async()=>({success:true,data:{results:[hit]}}))}
 const payload=(name:string,args:unknown)=>({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:name,function:{name,arguments:JSON.stringify(args)}}]}}]})
 const body=':::options\nHarbor | unknown | dinner | stock unknown\nPark | unknown | dinner | access unknown\n:::\n{{source:src1.content:0:10}}\n:::sources\nDirectory | {{source:src1.url}} | date unknown\n:::'
 const replies=[payload('web_search',{}),payload('create_file',{title:'Comparison',body}),{choices:[{finish_reason:'stop',message:{content:'Here you go.'}}]}]
 const requests:any[]=[];vi.stubGlobal('fetch',vi.fn(async(_u,init)=>{requests.push(JSON.parse(init.body));return new Response(JSON.stringify(replies[requests.length-1]))}))
 const r=await chatWithTools([{role:'user',content:'Compare two dinner options'}],{gatewayUrl:'https://gateway.test',apiKey:'test',model:'test'},[search,file],{userId:'fictional',telegramId:0,telegramChatId:0,name:'Alex',timezone:'UTC',tokens:{}})
 expect(JSON.stringify(requests[1].messages)).toContain('source_records');expect(file.execute).toHaveBeenCalledOnce();const input=file.execute.mock.calls[0]?.[0] as any;expect(input.body).toContain('Terminal 4');expect(input.body).toContain(hit.url);expect(input.body).not.toContain('{{source:');expect(r.deliverable?.state).toBe('completed')
})

import { renderHtml, flattenBlocks, renderPdf } from '@/lib/files/render'
it('shows literal source punctuation in HTML blocks and flattened fallback, without new markup',async()=>{
 const s=new SourceRecords();s.capture('web_fetch',{...hit,title:'Harbor & Park',content:'Price: $19.00 | unknown [stock] <unverified>'},'test')
 const r=bindFileSources({title:'Facts',body:':::options\n{{source:src1.title}} | {{source:src1.content}} | source-reported | stock unknown\n:::'},s)
 expect(r).not.toHaveProperty('error');if('input' in r){const doc=r.input as any;const html=renderHtml(doc);expect(html).toContain('Harbor &amp; Park');expect(html).toContain('Price: $19.00 | unknown [stock] &lt;unverified&gt;');expect(flattenBlocks(doc.body)).toContain('Price&#58; $19.00 &#124; unknown &#91;stock&#93; &lt;unverified&gt;');expect(await renderPdf(doc)).toBeInstanceOf(Buffer)}
})

import { sourceResultEnvelope } from '@/lib/files/source-records'
it('keeps a valid bounded registry envelope for long and quoted public pages',()=>{
 const s=new SourceRecords();const content='Literal opening words. '+('"quoted" \\ public text\n').repeat(1000)
 const rs=s.capture('web_fetch',{...hit,content},'2030-06-04T12:00:00Z')
 const envelope=sourceResultEnvelope(rs);expect(envelope.length).toBeLessThanOrEqual(4000)
 const shown=JSON.parse(envelope).source_records[0];expect(shown.id).toBe('src1');expect(shown.content).toBe(content.slice(0,1000));expect(shown.content_length).toBe(content.length);expect(shown.content_truncated).toBe(true)
 expect(s.resolve({source:shown.id,field:'content',start:0,end:7})).toHaveProperty('value','Literal')
 const many=s.capture('web_search',{results:Array.from({length:20},()=>hit)},'2030-06-04T12:00:00Z')
 const bounded=sourceResultEnvelope(many);expect(bounded.length).toBeLessThanOrEqual(4000);expect(JSON.parse(bounded).omitted_sources).toBeGreaterThan(0)
})
