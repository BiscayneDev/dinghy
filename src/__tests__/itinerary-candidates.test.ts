import {expect,it,describe,vi,afterEach} from 'vitest'
import {SourceRecords,bindFileSources,compileItinerarySources,sourceResultEnvelope} from '@/lib/files/source-records'
import {compileItineraryCandidates,ITINERARY_CANDIDATE_NOTE} from '@/lib/files/itinerary-candidates'
import {itineraryPageError} from '@/lib/files/itinerary-contract'
import {chatWithTools} from '@/lib/spectrum/dinghy'
vi.mock('@/lib/data-portability/erasure-state',()=>({assertAccountActive:async()=>{}}))
afterEach(()=>vi.unstubAllGlobals())
const url='https://harbor.test/guide',text='Harbor Inn rooms. Harbor Cafe dinner. Harbor Museum tickets. Rooms $200. Menu served.'
const ref=(start:number,end:number,source='src2')=>({source,field:'content',start,end})
const candidates=[{kind:'hotel',name:ref(0,10),reason:'Selected for this plan',catch:'Availability unverified'},{kind:'restaurant',name:ref(18,29),reason:'Dining choice',catch:'Hours unverified'},{kind:'activity',name:ref(38,51),reason:'Weekend choice',catch:'Tickets unverified'}]
const body='## Friday\n-10:00 User supplied office visit.\n- Working sessions: venue and duration to confirm.\n## Weekend\nPlans to confirm.'
const ask='Make an itinerary for fictional founders on an unspecified Friday. Office10am then working sessions. Hotel and restaurant recommendations and weekend activities.'
const input={title:'Fictional Harbor',body,itinerary_candidates:candidates}
function registry(){const r=new SourceRecords();r.capture('web_search',{results:[{url,title:'Harbor directory',content:'search snippet'}]},'2030-01-01');r.capture('web_fetch',{url,title:'Harbor directory',content:text},'2030-01-01');return r}
describe('typed itinerary candidate compiler',()=>{
 it('builds exact columns from page excerpts, preserves reasons/catches and leaves absentfactsunknown',()=>{
  const r=registry(),compiled=compileItineraryCandidates(input,r);expect('error'in compiled).toBe(false);if('error'in compiled)return
  const bound=bindFileSources(compiled.input,r,true);if('error'in bound)throw Error(bound.error)
  const sourced=compileItinerarySources(bound.input,bound.usedSources,[url]);if('error'in sourced)throw Error(sourced.error)
  const b=(sourced.input as any).body;expect(b).toContain('Harbor Inn | unknown | unknown | unknown | Availability unverified | | '+url);expect(b).toContain('Harbor Cafe | unknown | Dining choice | Hours unverified '+url);expect(b).toContain('Selected for this plan');expect(itineraryPageError(b,ask,[url])).toBeNull();expect((compiled.input as any).itinerary_candidates).toBeUndefined()
 })
 it.each([
  ['nonhotel discarded fact',[{kind:'restaurant',name:ref(18,29),area:ref(0,10)}]],['missing name',[{kind:'hotel'}]],['ambiguous kind',[{kind:'place',name:ref(0,10)}]],['snippet',[{kind:'hotel',name:ref(0,6,'src1')}]],['page title',[{kind:'hotel',name:{source:'src2',field:'title'}}]],['unknown source',[{kind:'hotel',name:ref(0,10,'src99')}]],['cut name',[{kind:'hotel',name:ref(1,10)}]],['bad optional',[{kind:'hotel',name:ref(0,10),price:'$50'}]],['null optional',[{kind:'hotel',name:ref(0,10),rating:null}]],['unknown key',[{kind:'hotel',name:ref(0,10),book:true}]],['empty',[]],['overflow',Array(7).fill(candidates[0])]
 ])('rejects %s without guessing',(_label,value)=>expect(compileItineraryCandidates({...input,itinerary_candidates:value},registry())).toHaveProperty('error'))
 it('rejects mixing typed candidates with handwritten renderer blocks',()=>expect(compileItineraryCandidates({...input,body:body+'\n:::stay\nmalformed\n:::'},registry())).toHaveProperty('error'))
 it('escapes literal reason/catch controls without creating links or newblocks',()=>{const compiled=compileItineraryCandidates({...input,itinerary_candidates:[{...candidates[0],reason:'one|two\n:::stay <b>keep</b>',catch:'{{source:src9.url}}'}]},registry());if('error'in compiled)throw Error(compiled.error);const b=(compiled.input as any).body;expect(b).toContain('one&#124;two');expect(b).not.toContain('<b>');expect(b).not.toContain('{{source:src9.url}}');expect((b.match(/:::stay/g)??[])).toHaveLength(1)})
 it('legacy omission leaves strict handwritten input untouched',()=>{const v={title:'Fictional',body};expect(compileItineraryCandidates(v,registry())).toEqual({input:v,compiled:false})})
})
const tool=(name:string,data:unknown={})=>({name,description:'fictional',inputSchema:{type:'object'},execute:vi.fn(async()=>({success:true,data}))})
const call=(name:string,i:unknown={})=>({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:name,function:{name,arguments:JSON.stringify(i)}}]}}]})
const ctx={userId:'',telegramId:0,telegramChatId:0,name:'Fictional',timezone:'UTC',tokens:{}}
async function run(seq:unknown[],page:string=text,memory?:string){let n=0;const req:any[]=[];vi.stubGlobal('fetch',vi.fn(async(_u,init)=>{req.push(JSON.parse(init.body));return new Response(JSON.stringify(seq[n++]??{choices:[{finish_reason:'stop',message:{content:'Done'}}]}))}));const file=tool('create_file'),stage=vi.fn(async()=>{}),result=await chatWithTools([{role:'user',content:ask}],{gatewayUrl:'https://gateway.test',apiKey:'fictional',model:'fictional',onStage:stage,memory},[tool('web_search',{results:[{url,title:'Harbor',content:'lead'}]}),tool('web_fetch',{url,title:'Harbor',content:page}),file],ctx);return{file,stage,result,req}}
it('first-attempt typed candidates compile, bind, sourcecompile and pass existing gate',async()=>{const {file,stage,result,req}=await run([call('web_search'),call('create_file',input)]);expect(file.execute).toHaveBeenCalledTimes(1);expect(stage).toHaveBeenCalledWith('tool','itinerary:candidates_compiled');expect(stage).toHaveBeenCalledWith('tool','itinerary:sources_compiled');expect(stage).not.toHaveBeenCalledWith('tool','repair:file_once');expect(result.deliverable?.state).toBe('completed');expect(req).toHaveLength(2)})
it('invalid typed candidate uses exactly onecreate_file repair then succeeds',async()=>{const {file,stage,result,req}=await run([call('web_search'),call('create_file',{...input,itinerary_candidates:[{kind:'unknown',name:ref(0,10)}]}),call('create_file',input)]);expect(file.execute).toHaveBeenCalledTimes(1);expect(stage).toHaveBeenCalledWith('tool','invalid:itinerary_candidates');expect(stage).toHaveBeenCalledWith('tool','repair:file_once');expect(req[2].tools.map((t:any)=>t.function.name)).toEqual(['select_itinerary_candidates']);expect(result.deliverable?.state).toBe('completed')})
it('second invalid typed call exhausts repair and publishes agenda only',async()=>{const bad={...input,itinerary_candidates:[]};const {file,stage,result}=await run([call('web_search'),call('create_file',bad),call('create_file',bad)]);expectAgendaOnly(file);expect(stage).toHaveBeenCalledWith('tool','repair:file_exhausted');expect(result.deliverable?.state).toBe('completed')})
it('primary spec explicitly omits sources and nullable bindingfields',async()=>{const {fileToolsFor}=await import('@/lib/files/tool');const f=fileToolsFor(),t=f.tools.find(t=>t.name==='create_file')!;expect(t.description).toContain(ITINERARY_CANDIDATE_NOTE);expect((t.inputSchema as any).properties.body.description).toContain('Do NOT bind null/absent');expect((t.inputSchema as any).properties.itinerary_candidates).toBeDefined();f.close()})

it('read envelope lists only nonnull availablefields to avoid wasting firstattempt',()=>{const r=registry();const added=r.capture('web_fetch',{url,content:text},'2030-01-01');const e=JSON.parse(sourceResultEnvelope(added));expect(e.source_records[0].available_fields).toEqual(['url','content']);expect(e.source_records[0].published_date).toBeNull()})
it('requires candidates in actual offered schema and rejects freehand firstattempt before binding',async()=>{const {file,stage,result,req}=await run([call('web_search'),call('create_file',{title:'Fictional',body:body+'\n:::stay\nHandwritten | unknown | unknown | unknown\n:::'}),call('create_file',input)]);for(const r of req){const f=r.tools?.find((t:any)=>t.function.name==='create_file');if(f)expect(f.function.parameters.required).not.toContain('itinerary_candidates')}expect(stage).toHaveBeenCalledWith('tool','invalid:itinerary_candidates_required');expect(stage).toHaveBeenCalledWith('tool','repair:file_once');expect(file.execute).toHaveBeenCalledTimes(1);expect(result.deliverable?.state).toBe('completed')})
it('two freehand attempts exhaust repair and publish no venue cards',async()=>{const v={title:'Fictional',body};const {file,stage,result}=await run([call('web_search'),call('create_file',v),call('create_file',v)]);expectAgendaOnly(file);expect(stage).toHaveBeenCalledWith('tool','repair:file_exhausted');expect(stage).not.toHaveBeenCalledWith('tool','invalid:itinerary_shape:stay_rows');expect(result.deliverable?.state).toBe('completed')})
it('ordinary supplied-plan itinerary keeps original schema and legacybody',async()=>{let n=0;const requests:any[]=[];const supplied='Make an itinerary from my supplied meeting notes. Friday office visit10am then working sessions.';const file=tool('create_file');vi.stubGlobal('fetch',vi.fn(async(_u,init)=>{requests.push(JSON.parse(init.body));return new Response(JSON.stringify(n++?{choices:[{finish_reason:'stop',message:{content:'Done'}}]}:call('create_file',{title:'Fictional supplied plan',body})))}));const result=await chatWithTools([{role:'user',content:supplied}],{gatewayUrl:'https://gateway.test',apiKey:'fictional',model:'fictional'},[file],ctx);expect(requests[0].tools[0].function.parameters.required??[]).not.toContain('itinerary_candidates');expect(file.execute).toHaveBeenCalledTimes(1);expect(result.deliverable?.state).toBe('completed')})

import {itineraryCandidateErrorCode} from '@/lib/files/itinerary-candidates'
it.each([
 ['File input required.','input'],['Typed itinerary candidates require a body','count_or_body'],['Do not mix typed','manual_blocks'],['Candidate facts require exact page-content source references.','reference_type'],['Unknown candidate reference field.','reference_key'],['Candidate facts require exact page-content excerpt offsets','reference_shape'],['Unknown source ID or field.','unknown_source'],['This source field is unknown.','absent_field'],['Invalid source excerpt offsets.','offset_range'],['Excerpt cuts a word','offset_cut'],['Candidate excerpt must not be empty.','empty_excerpt'],['Candidate facts require a successful page read','snippet'],['Each candidate must be explicitly typed.','candidate_type'],['Candidate kind must be hotel','kind'],['Unknown candidate field','candidate_key'],['Rating/area fields are hotel-only','hotel_only'],['Candidate reason/catch must be literal short text.','judgment_shape'],['Candidate groups exceed renderer limits','group_limit'],['untrusted private arbitrary text','other']
])('reports finite candidate rejection code %s',(error,code)=>{expect(itineraryCandidateErrorCode(error)).toBe(code);expect(itineraryCandidateErrorCode(error)).not.toContain('private')})
it('records actual rejection category on each failed call, not source/model text',async()=>{const bad={...input,itinerary_candidates:[{kind:'hotel',name:ref(1,10)}]};const {stage,file}=await run([call('web_search'),call('create_file',bad),call('create_file',bad)]);expectAgendaOnly(file);expect(stage.mock.calls.filter((c:any)=>c[1]==='invalid:itinerary_candidate:offset_cut')).toHaveLength(2);expect(JSON.stringify(stage.mock.calls)).not.toContain(text)})
it('page IDs exclude snippets and empty reads',()=>{const r=registry();r.capture('web_fetch',{url:'https://empty.test',content:''},'2030-01-01');expect(r.pageIds()).toEqual(['src2'])})
it('snippet repair names valid page IDs without source text',()=>{const bad={...input,itinerary_candidates:[{kind:'hotel',name:ref(0,6,'src1')}]};const result=compileItineraryCandidates(bad,registry());expect(result).toHaveProperty('error');if('error'in result){expect(result.error).toContain('Use page source IDs: src2');expect(result.error).not.toContain(text)}})
it('offered candidate facts use page-only enums after reads',async()=>{const {req}=await run([call('web_search'),call('create_file',input)]);const {fileToolsFor}=await import('@/lib/files/tool');const f=fileToolsFor();let n=0;const requests:any[]=[];vi.stubGlobal('fetch',vi.fn(async(_u,init)=>{requests.push(JSON.parse(init.body));return new Response(JSON.stringify(n++?call('create_file',input):call('web_search')))}));await chatWithTools([{role:'user',content:ask}],{gatewayUrl:'https://gateway.test',apiKey:'fictional',model:'fictional'},[tool('web_search',{results:[{url,title:'Harbor',content:'lead'}]}),tool('web_fetch',{url,title:'Harbor',content:text}),...f.tools],ctx);const sel=requests[1].tools.find((t:any)=>t.function.name==='select_itinerary_candidates').function.parameters.properties.candidates.items;expect(sel.required).toEqual(['kind','line']);expect(sel.properties.id).toBeUndefined();expect(requests[1].tools.map((t:any)=>t.function.name)).toEqual(['select_itinerary_candidates']);f.close()})
it('researched search exposes leads without bindable snippet IDs',async()=>{const {req}=await run([call('web_search'),call('create_file',input)]);const search=req[1].messages.find((m:any)=>m.role==='tool'&&m.tool_call_id==='web_search');const data=JSON.parse(search.content);expect(data.source_records).toBeUndefined();expect(data.search_leads).toHaveLength(1);expect(data.search_leads[0].source).toBeUndefined();expect(data.search_leads[0].id).toBeUndefined();expect(req[1].messages.some((m:any)=>m.role==='tool'&&m.content.includes('"origin":"page"'))).toBe(true)})

it('binds a unique literal excerpt without model counting',()=>{const result=compileItineraryCandidates({...input,itinerary_candidates:[{kind:'hotel',name:{source:'src2',field:'content',excerpt:text.slice(0,10)}}]},registry());expect(result).toHaveProperty('compiled',true)})
it('rejects rewritten, mixed and partial-word excerpts',()=>{for(const excerpt of ['fictional missing',text.slice(1,5)])expect(compileItineraryCandidates({...input,itinerary_candidates:[{kind:'hotel',name:{source:'src2',field:'content',excerpt}}]},registry())).toHaveProperty('error');expect(compileItineraryCandidates({...input,itinerary_candidates:[{kind:'hotel',name:{source:'src2',field:'content',excerpt:text.slice(0,10),start:0,end:6}}]},registry())).toHaveProperty('error');const r=new SourceRecords();r.capture('web_fetch',{url,content:'Harbor Harbor'},'2030-01-01');expect(r.locate('src1','Harbor')).toEqual({start:0,end:6});expect(r.resolve({source:'src1',field:'content',...r.locate('src1','Harbor')})).toHaveProperty('value','Harbor')})

function expectAgendaOnly(file:{execute:{mock:{calls:unknown[][]}}}){
 expect(file.execute).toHaveBeenCalledTimes(1)
 const input=file.execute.mock.calls[0][0] as {body:string;title:string}
 expect(input.title).toBe('Unverified itinerary');expect(input.body).toContain('No hotel, restaurant or activity is recommended')
 expect(input.body).not.toMatch(/:::stay|:::options|:::sources|Harbor Inn|Harbor Cafe|Harbor Museum/)
 expect(input.body).toContain('10am');expect(input.body).toContain('Working sessions')
}

const povText='Linden House. Rooms from $210 a night. Rated 4.6 by guests. Two minutes from Alderbrook station. Quiet courtyard rooms face the garden. Harbor Annex. Rooms from $140 a night. Rated 4.1 by guests. Next to the ferry. Marrow dinner room seats twenty. Open Friday at 8:30. Tower Boat Tour runs five hours.'
const ex=(excerpt:string)=>({source:'src2',field:'content',excerpt})
const povRegistry=()=>{const r=new SourceRecords();r.capture('web_search',{results:[{url,title:'Stay guide',content:'snippet'}]},'2030-01-01');r.capture('web_fetch',{url,title:'Stay guide',content:povText},'2030-01-01');return r}
const pov=[
 {kind:'hotel',name:ex('Linden House'),price:ex('$210'),rating:ex('4.6'),area:ex('Alderbrook station'),reason:'Quiet rooms',catch:'Rates unverified',role:'favorite',slot:'Stay in Alderbrook',fit:'You wanted a calm base for working mornings.',evidence:ex('Quiet courtyard rooms face the garden.')},
 {kind:'hotel',name:ex('Harbor Annex'),price:ex('$140'),rating:ex('4.1'),reason:'Cheaper',catch:'Further from the station',role:'runner_up',slot:'Stay in Alderbrook',fit:'Wins if you would rather save than be close.',evidence:ex('Next to the ferry.')},
 {kind:'restaurant',name:ex('Marrow'),reason:'Small dinner room',catch:'Hours unverified',role:'favorite',slot:'Friday dinner',fit:'A table for two fits a first night in.',evidence:ex('Open Friday at 8:30.')},
 {kind:'activity',name:ex('Tower Boat Tour'),role:'skip',slot:'Saturday',fit:'Too long for a short stay.',evidence:ex('Tower Boat Tour runs five hours.')}
]
const compileAll=(cands:unknown[])=>{const r=povRegistry(),c=compileItineraryCandidates({...input,itinerary_candidates:cands},r);if('error'in c)return c;const bound=bindFileSources(c.input,r,true);if('error'in bound)return bound;const sourced=compileItinerarySources(bound.input,bound.usedSources,[url]);return sourced}
describe('point of view picks',()=>{
 it('whole journey: bound facts on cards, per-slot take with page evidence, skip has no card, gate passes',()=>{
  const c=compileAll(pov);if('error'in c)throw Error(c.error)
  const b=(c.input as any).body as string
  expect(b).toContain('## My take');expect(b).toContain('**Stay in Alderbrook**');expect(b).toContain('**Friday dinner**')
  expect(b).toMatch(/Favorite: Linden House\. For you: You wanted a calm base[^\n]*Their page says: "Quiet courtyard rooms face the garden\."/)
  expect(b).toMatch(/Runner-up: Harbor Annex\. For you: Wins if/);expect(b).toMatch(/Skip: Tower Boat Tour\./)
  expect(b).toContain('Linden House | $210 | 4.6 | Alderbrook station | Rates unverified');expect(b).toContain('Harbor Annex | $140 | 4.1')
  expect(b).not.toMatch(/\|[^\n]*Tower Boat Tour/);expect(b).not.toContain('{{source')
  expect(b.indexOf('## My take')).toBeLessThan(b.indexOf('## Hotels'));expect(itineraryPageError(b,ask,[url])).toBeNull()
 })
 it('roles are optional: no filler, no take section',()=>{const c=compileItineraryCandidates(input,registry());if('error'in c)throw Error(c.error);expect((c.input as any).body).not.toContain('My take')})
 it('several stops keep their own favorite per slot',()=>{
  const two=[pov[0],{...pov[2],kind:'hotel',name:ex('Harbor Annex'),price:undefined,rating:undefined,slot:'Stay in Ferrybridge'}]
  const c=compileAll(two);if('error'in c)throw Error(c.error);expect((c.input as any).body).toContain('**Stay in Ferrybridge**')
 })
 it.each([
  ['favorite without fit',[{...pov[0],fit:undefined}]],['role without evidence',[{...pov[0],evidence:undefined}]],['evidence not on the page',[{...pov[0],evidence:ex('Beachfront with a spa')}]],['bad role',[{...pov[0],role:'best'}]],
  ['two favorites in a slot',[pov[0],{...pov[1],role:'favorite'}]],['runner-up without favorite',[pov[1]]],['only skips',[pov[3]]],['fit without role',[{...pov[0],role:undefined}]],['long fit',[{...pov[0],fit:'x'.repeat(301)}]],['long slot',[{...pov[0],slot:'x'.repeat(61)}]]
 ])('rejects %s',(_l,v)=>expect(compileAll(v as unknown[])).toHaveProperty('error'))
 it('escapes controls and never lets fit or slot create links or blocks',()=>{const c=compileAll([{...pov[0],fit:'a|b\n:::stay {{source:src9.url}} <b>x</b>',slot:'S|:::stay'}]);if('error'in c)throw Error(c.error);const b=(c.input as any).body as string;expect(b).not.toContain('{{source:src9');expect(b).not.toMatch(/\n:::stay[^\n]*x/)})
 it('stays inside create_file: roles reach the created body with bound quotes, and the file completes',async()=>{
  const {file,result,stage}=await run([call('web_search'),call('web_fetch'),call('create_file',{...input,itinerary_candidates:pov})],povText)
  expect(file.execute).toHaveBeenCalledTimes(1);expect(stage).not.toHaveBeenCalledWith('tool','repair:file_once')
  const sent=(file.execute.mock.calls[0] as any[])[0] as {body:string}
  expect(sent.body).toContain('Favorite: Linden House.');expect(sent.body).toContain('Their page says: "Quiet courtyard rooms face the garden."');expect(result.deliverable?.state).toBe('completed')
 })
 it('follow-up: saved profile and a settled choice reach the composer; open slots stay open',async()=>{
  const {renderMemoryBlock}=await import('@/lib/spectrum/memory')
  const memory=renderMemoryBlock({profile:'- Prefers quiet places',summaries:[],facts:[],plans:['Alderbrook trip (Nov 6) · Chose: Stay in Alderbrook: Linden House [source: user]'],files:[]})
  const {req}=await run([call('web_search'),call('web_fetch'),call('create_file',{...input,itinerary_candidates:pov})],povText,memory)
  const sys=JSON.stringify(req[0].messages[0]);expect(sys).toContain('Prefers quiet places');expect(sys).toContain('Chose: Stay in Alderbrook: Linden House')
  const all=JSON.stringify(req);expect(all).toContain('do not re-pitch that slot')
 })
})
