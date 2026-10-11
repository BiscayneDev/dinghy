import {afterEach,describe,it,expect,vi} from 'vitest'
import {researchFollowup,inputSchemaError,stripPermissionOffer} from '@/lib/spectrum/recovery'
import {chatWithTools} from '@/lib/spectrum/dinghy'
import {gateTools} from '@/lib/spectrum/tool-gating'
vi.mock('@/lib/data-portability/erasure-state',()=>({assertAccountActive:async()=>{}}))
afterEach(()=>vi.unstubAllGlobals())
const history=[{role:'user' as const,content:'Where can I buy a charger at Harbor Airport?'},{role:'assistant' as const,content:'The shop directory lists Harbor Electronics. Access and stock unverified. https://airport.test/shops'},{role:'user' as const,content:"I'm at gate 112. Where should I go?"}]
const ctx={userId:'fictional',telegramId:0,telegramChatId:0,name:'Alex',timezone:'UTC',tokens:{}}
const tool=(name:string,data:unknown={})=>({name,description:'fictional',inputSchema:{type:'object'},execute:vi.fn(async()=>({success:true,data}))})
const call=(name:string,args:unknown={})=>({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:name,function:{name,arguments:JSON.stringify(args)}}]}}]})
const stop=(content:string)=>({choices:[{finish_reason:'stop',message:{content}}]})
const harness=(replies:unknown[])=>{const requests:any[]=[];vi.stubGlobal('fetch',vi.fn(async(_u,init)=>{requests.push(JSON.parse(init.body));return new Response(JSON.stringify(replies[requests.length-1]??stop('Unverified.')))}));return requests}
const opts={gatewayUrl:'https://gateway.test',apiKey:'test',model:'test'}
describe('contextual direct research',()=>{
 it('keeps gate follow-up context but does not borrow unrelated old requests',()=>{expect(researchFollowup(history)).toBe(true);expect(researchFollowup([{role:'user',content:'Hi'},{role:'user',content:'Where should I go?'}])).toBe(false);expect(researchFollowup([...history,{role:'user',content:"don't search"}])).toBe(false);expect(researchFollowup([{role:'user',content:'Where can I get coffee?'}])).toBe(false)})
 it('removes food discovery in the actual gate toolset',()=>{expect(gateTools([tool('find_places'),tool('web_search')],[history[2].content,history[0].content,history[1].content]).active.map(t=>t.name)).toEqual(['web_search'])})
 it('forces source search then source read, preserving official and uncertainty notes',async()=>{const requests=harness([call('web_search'),call('web_fetch'),stop('The directory lists Harbor Electronics in Terminal 4. Stock and walking access are unverified.')]);const search=tool('web_search',{results:[{title:'Harbor directory',url:'https://airport.test/shops'}]}),read=tool('web_fetch',{url:'https://airport.test/shops',content:'Terminal 4 listing. Stock not reported.'}),food=tool('find_places');const result=await chatWithTools(history,opts,[search,read,food],ctx);expect(requests[0].tool_choice.function.name).toBe('web_search');expect(requests[1].tool_choice.function.name).toBe('web_fetch');expect(JSON.stringify(requests[0].messages)).toContain('newly named destination');expect(JSON.stringify(requests[0].messages)).toContain('official directory');expect(food.execute).not.toHaveBeenCalled();expect(result.reply).toContain('unverified')})
 it('repairs a permission offer once, not a fresh request to the user',async()=>{const requests=harness([stop('I can search. Let me know how you want to proceed!'),call('web_search'),call('web_fetch'),stop('Harbor Electronics is listed in Terminal 4; walking access remains unknown.')]);const stage=vi.fn(async()=>{});const result=await chatWithTools(history,{...opts,onStage:stage},[tool('web_search',{results:[{title:'Harbor directory',url:'https://airport.test/shops'}]}),tool('web_fetch',{content:'Terminal 4'})],ctx);expect(stage).toHaveBeenCalledWith('tool','repair:research_once');expect(requests).toHaveLength(4);expect(result.reply).not.toContain('Let me know')})
 it('does not loop on repeated permission offers and never guesses a route',async()=>{const requests=harness([stop('I can search.'),stop('Let me know how you want to proceed!')]);const result=await chatWithTools(history,opts,[tool('web_search')],ctx);expect(requests).toHaveLength(2);expect(result.reply).toBe('The location was not verified. I have no supported route to give.')})
 it('keeps useful researched location while dropping a trailing permission offer',async()=>{harness([call('web_search'),call('web_fetch'),stop('Harbor Electronics is listed in Terminal 4. Stock and route are unverified. Let me know if you want me to search more.')]);const result=await chatWithTools(history,opts,[tool('web_search',{results:[{url:'https://airport.test/shops'}]}),tool('web_fetch')],ctx);expect(result.reply).toContain('Terminal 4');expect(result.reply).toContain('route are unverified');expect(result.reply).not.toContain('Let me know')})
 it('does not repair below the reserved deadline headroom',async()=>{const requests=harness([stop('I can search.')]);const result=await chatWithTools(history,{...opts,deadlineAt:Date.now()+5000},[tool('web_search')],ctx);expect(requests).toHaveLength(1);expect(result.reply).toContain('not verified')})
 it('new named destination wins over the old venue lead in the model instructions',async()=>{const requests=harness([call('web_search'),call('web_fetch'),stop('No supported location found.')]);await chatWithTools([...history,{role:'user',content:'At Park Airport gate 14. Where should I go?'}],opts,[tool('web_search',{results:[{url:'https://park.test/shops'}]}),tool('web_fetch')],ctx);expect(JSON.stringify(requests[0].messages)).toContain('Park Airport gate 14');expect(JSON.stringify(requests[0].messages)).toContain('newly named destination overrides older context')})
 it('final loop synthesis cannot return a new permission offer',async()=>{const requests=harness([...Array.from({length:8},()=>call('web_search')),stop('Let me know how to proceed!')]);const result=await chatWithTools(history,opts,[tool('web_search')],ctx);expect(requests).toHaveLength(9);expect(result.reply).toBe('The location was not verified. I have no supported route to give.')})
 it('does not remove ordinary social wording outside this narrow task',async()=>{harness([stop('Let me know when you arrive.')]);expect((await chatWithTools([{role:'user',content:'Thanks for chatting'}],opts,[],ctx)).reply).toBe('Let me know when you arrive.')})
})
describe('schema and bounded recovery diagnostics',()=>{
 it('checks required fields, field types and enum without inventing inputs',()=>{const schema={type:'object',required:['title'],properties:{title:{type:'string'},format:{type:'string',enum:['html']}}};expect(inputSchemaError({},schema)).toBe('required_field');expect(inputSchemaError({title:1},schema)).toBe('field_type');expect(inputSchemaError({title:'Harbor',format:'bad'},schema)).toBe('field_enum');expect(inputSchemaError({title:'Harbor'},schema)).toBeNull()})
 it('allows a corrected schema call, logs codes and never executes malformed input',async()=>{const search={...tool('web_search'),inputSchema:{type:'object',required:['query'],properties:{query:{type:'string'}}}};harness([call('web_search',{}),call('web_search',{query:'Harbor directory'}),stop('No verified location found.')]);const stage=vi.fn(async()=>{});await chatWithTools(history,{...opts,onStage:stage},[search],ctx);expect(search.execute).toHaveBeenCalledTimes(1);expect(stage).toHaveBeenCalledWith('tool','invalid:required_field');expect(stage).toHaveBeenCalledWith('tool','repair:tool_once')})
 it('stops repeated bad schemas after the single correction, no tool effects',async()=>{const search={...tool('web_search'),inputSchema:{type:'object',required:['query']}};harness([call('web_search'),call('web_search'),call('web_search',{query:'late'}),stop('Unverified location.')]);await chatWithTools(history,opts,[search],ctx);expect(search.execute).not.toHaveBeenCalled()})
 it('malformed JSON is logged without executing the bad call',async()=>{const malformed={choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:'bad',function:{name:'web_search',arguments:'{broken'}}]}}]};harness([malformed,stop('The location was not verified.')]);const stage=vi.fn(async()=>{}),search=tool('web_search');await chatWithTools(history,{...opts,onStage:stage},[search],ctx);expect(search.execute).not.toHaveBeenCalled();expect(stage).toHaveBeenCalledWith('tool','invalid:arguments_json')})
 it('strips only the invitation sentence, not the source limitation',()=>{expect(stripPermissionOffer('The shop is listed. Route unknown. Let me know how to proceed!')).toBe('The shop is listed. Route unknown.')})
})

describe('requested file validation correction',()=>{
 const ask=[{role:'user' as const,content:'Make a list of recent research leads.'}]
 const hits={results:[{title:'Harbor Agent',url:'https://harbor.test/launch',content:'Harbor Agent launched on a reported date.'}]}
 const good={title:'Launch leads',body:'- {{source:src1.title}}: {{source:src1.url}}. Publication date unknown; launch window unverified.'}
 it('forces one correction, tells the model available fields, and executes only valid input',async()=>{
  const req=harness([call('web_search'),call('create_file',{title:'Leads',body:'- Retyped name'}),call('create_file',good),stop('Done.')]),file=tool('create_file'),stage=vi.fn(async()=>{})
  const result=await chatWithTools(ask,{...opts,onStage:stage},[tool('web_search',hits),file],ctx)
  expect(req[2].tool_choice.function.name).toBe('create_file')
  expect(req[2].tools.map((t:any)=>t.function.name)).toEqual(['create_file'])
  expect(JSON.stringify(req[2].messages)).toContain('available_sources')
  expect(file.execute).toHaveBeenCalledTimes(1)
  expect(stage).toHaveBeenCalledWith('tool','invalid:source_binding:missing_binding')
  expect(stage).toHaveBeenCalledWith('tool','repair:file_once')
  expect(result.deliverable?.state).toBe('completed')
 })
 it('exhausts after two rejected bindings, not eight gateway calls or a user permission ask',async()=>{
  const req=harness([call('web_search'),call('create_file',{body:'- {{source:src99.title}}'}),call('create_file',{body:'- {{source:src1.published_date}}'}),stop('Dates are unknown. Let me know if you want me to keep trying.')]),file=tool('create_file'),stage=vi.fn(async()=>{})
  const result=await chatWithTools(ask,{...opts,onStage:stage},[tool('web_search',hits),file],ctx)
  expect(req).toHaveLength(4);expect(file.execute).not.toHaveBeenCalled()
  expect(stage).toHaveBeenCalledWith('tool','invalid:source_binding:unknown_reference');expect(stage).toHaveBeenCalledWith('tool','invalid:source_binding:unknown_field')
  expect(result.reply).toContain('Dates are unknown.');expect(result.reply).not.toContain('Let me know');expect(result.deliverable?.state).toBe('unfulfilled')
 })
 it('does not replay multiple corrected file calls in one batch',async()=>{
  const batch={choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[1,2].map(id=>({id:String(id),function:{name:'create_file',arguments:JSON.stringify(good)}}))}}]}
  harness([call('web_search'),call('create_file',{body:'- Unbound'}),batch,stop('Complete.')]);const file=tool('create_file')
  await chatWithTools(ask,opts,[tool('web_search',hits),file],ctx);expect(file.execute).toHaveBeenCalledTimes(1)
 })
 it('does not retry a publication that may already have executed',async()=>{
  harness([call('web_search'),call('create_file',good),stop('The publish result is unknown. Let me know if you want to keep trying.')]);const file={...tool('create_file'),execute:vi.fn(async()=>{throw new Error('Publication result unknown')})}
  const result=await chatWithTools(ask,opts,[tool('web_search',hits),file],ctx)
  expect(file.execute).toHaveBeenCalledTimes(1);expect(result.reply).not.toContain('Let me know')
 })
 it('will not spend correction headroom when fewer than twenty seconds remain',async()=>{
  const req=harness([call('web_search'),call('create_file',{body:'- Unbound'}),stop('No verified launch window.')]),file=tool('create_file')
  await chatWithTools(ask,{...opts,deadlineAt:Date.now()+19000},[tool('web_search',hits),file],ctx)
  expect(req).toHaveLength(3);expect(req[2].tool_choice).toBe('none');expect(file.execute).not.toHaveBeenCalled()
 })
})
