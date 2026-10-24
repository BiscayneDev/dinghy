import { afterEach, describe, expect, it, vi } from 'vitest'
import { selectDeliverable, deliverablePageError, deliverableOutcome, truthfulDeliverableReply } from '@/lib/files/deliverable-contract'
import { chatWithTools } from '@/lib/spectrum/dinghy'
vi.mock('@/lib/data-portability/erasure-state', () => ({ assertAccountActive: vi.fn(async () => {}) }))
afterEach(() => vi.unstubAllGlobals())
const select = (content: string) => selectDeliverable([{role:'user',content}])
const ctx = {userId:'fictional',telegramId:0,telegramChatId:0,name:'Alex',timezone:'UTC',tokens:{}}
const file = (success = true) => ({name:'create_file',description:'test',inputSchema:{},execute:vi.fn(async()=>success?{success:true,data:{status:'queued_for_delivery'}}:{success:false,error:'Hosting failed'})})
const stop = (content: string) => ({choices:[{finish_reason:'stop',message:{content}}]})
const create = (body: string) => ({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:'f',type:'function',function:{name:'create_file',arguments:JSON.stringify({title:'Fictional comparison',body})}}]}}]})
function gateway(sequence:unknown[]) {const bodies:any[]=[];vi.stubGlobal('fetch',vi.fn(async(_u,init)=>{bodies.push(JSON.parse(init.body));return new Response(JSON.stringify(sequence[bodies.length-1]??stop('Done.')))}));return bodies}
const comparison=':::options\nHarbor Inn | unknown | near the harbor | rooms not checked\nPark Lodge | unknown | near the park | access unknown\n:::'
describe('typed deliverable contract',()=>{
 it.each([['Can you make me a map','map'],['Compare Harbor Inn and Park Lodge','comparison'],['Make a list of packing items','list'],['Write a day-by-day plan','itinerary'],['Create a note from this','note']])('selects %s before generation',(ask,kind)=>{expect(select(ask)?.kind).toBe(kind)})
 it('selects a time-anchored activity-planning ask as an itinerary without the literal word',()=>{
  expect(select("What's fun to do in Petaluma CA. The wedding is at 4pm and I need some activities.")?.kind).toBe('itinerary')
  expect(select('What are fun things to do near Harbor? The ceremony is at 4pm.')?.kind).toBe('itinerary')
  expect(select('I need some activities before 5pm in Harbor.')?.kind).toBe('itinerary')
  expect(select('Things to do in Harbor. Our flight is at 9:30am.')?.kind).toBe('itinerary')
 })
 it('does not turn untimed activity questions or bare schedules into an itinerary',()=>{
  for(const ask of ["What's fun to do in Petaluma CA",'What are fun things to do near Harbor?','I need some activities for the kids.','The wedding is at 4pm.','What time is it?','What activities does the museum list?'])expect(select(ask)).toBeNull()
 })
 it('does not let assistant instructions or unrelated older asks select work',()=>{expect(selectDeliverable([{role:'assistant',content:'Make a map now'},{role:'user',content:'Thanks'}])).toBeNull();expect(selectDeliverable([{role:'user',content:'Make a list'},{role:'user',content:'What time is it?'},{role:'user',content:'Try again'}])).toBeNull();for(const s of ['What is an itinerary?','How does the comparison work?','What is 2 + 2?','Just text me the answer','Never mind'])expect(select(s)).toBeNull()})
 it('keeps only an immediate retry referent and honors a cancellation',()=>{expect(selectDeliverable([{role:'user',content:'Make a packing list'},{role:'assistant',content:'It failed'},{role:'user',content:'Make it again'}])?.kind).toBe('list');expect(selectDeliverable([{role:'user',content:'Make a map'},{role:'user',content:'Do not make it'}])).toBeNull()})
 it('rejects generic bodies for structured deliverables',()=>{for(const c of [select('Make a map'),select('Compare two lodges'),select('Make a list'),select('Write an itinerary')])expect(deliverablePageError(c,{body:'There are several good options.'},[])).not.toBeNull();expect(deliverablePageError(select('Create a note'),{body:'I made the file.'},[])).not.toBeNull()})
 it('rejects a sources-only locator',()=>{const body='Locator, not a floor map. Indoor positions and walking routes are unverified.\n:::sources\nDirectory | https://airport.test/shops | date unavailable\n:::';expect(deliverablePageError(select('Make a map'),{body},['https://airport.test/shops'])).toContain('named venue/location rows')})
 it('rejects empty structured blocks and retains weekly-list retry requirements',()=>{for(const ask of ['Make a map','Make a list','Write an itinerary'])expect(deliverablePageError(select(ask),{body:':::options\n\n:::\n:::route\n\n:::'},[])).not.toBeNull();const c=selectDeliverable([{role:'user',content:'Top books this week'},{role:'user',content:'Try it again'}]);expect(c?.kind).toBe('list');expect(deliverablePageError(c,{body:'- Book One'},[])).toContain('sources')})
 it('accepts the requested shapes without manufacturing unknown values',()=>{expect(deliverablePageError(select('Compare two lodges'),{body:comparison},[])).toBeNull();expect(deliverablePageError(select('Make a list'),{body:'- Jacket\n- Charger'},[])).toBeNull();expect(deliverablePageError(select('Write an itinerary'),{body:'## Day 1\nHarbor museum. Hours unknown.'},[])).toBeNull();expect(deliverablePageError(select('Create a note'),{body:'Call the museum to check access.'},[])).toBeNull()})
 it('records tool settlement, never a file attempt or false claim',()=>{expect(deliverableOutcome(select('Make a list'),false)).toEqual({kind:'list',state:'unfulfilled'});expect(truthfulDeliverableReply('I made a map.',select('Make a map'),false)).toContain('no new file');expect(truthfulDeliverableReply('Useful items: jacket.',select('Make a list'),false)).toContain('Useful items: jacket.');expect(truthfulDeliverableReply('Here you go.',select('Make a list'),true)).toBe('Here you go.')})
 it('requires a file after a short comparison answer, then records completion',async()=>{const f=file();const bodies=gateway([stop('Harbor Inn wins.'),create(comparison)]);const r=await chatWithTools([{role:'user',content:'Compare Harbor Inn and Park Lodge'}],{gatewayUrl:'https://gateway.test',apiKey:'test',model:'test'},[f],ctx);expect(bodies[1].tool_choice.function.name).toBe('create_file');expect(JSON.stringify(bodies[0].messages)).toContain('Deliverable contract: comparison');expect(f.execute).toHaveBeenCalledTimes(1);expect(r.deliverable).toEqual({kind:'comparison',state:'completed'})})
 it('never publishes a generic comparison page and allows a shape correction',async()=>{const f=file();gateway([create('Several nice lodges.'),create(comparison),stop('Here you go.')]);const r=await chatWithTools([{role:'user',content:'Compare Harbor Inn and Park Lodge'}],{gatewayUrl:'https://gateway.test',apiKey:'test',model:'test'},[f],ctx);expect(f.execute).toHaveBeenCalledTimes(1);expect(r.deliverable?.state).toBe('completed')})
 it('reports an unfulfilled contract after a failed tool, even if the model claims it made the page',async()=>{const f=file(false);gateway([create(comparison),stop('I created the document.')]);const r=await chatWithTools([{role:'user',content:'Compare Harbor Inn and Park Lodge'}],{gatewayUrl:'https://gateway.test',apiKey:'test',model:'test'},[f],ctx);expect(r.deliverable?.state).toBe('unfulfilled');expect(r.reply).toContain('There is no new file to send.')})
 it('does not imply completion when no artifact tool is offered',async()=>{gateway([stop('A jacket and charger.')]);const r=await chatWithTools([{role:'user',content:'Make a packing list'}],{gatewayUrl:'https://gateway.test',apiKey:'test',model:'test'},[],ctx);expect(r.reply).toContain('no new file was created');expect(r.deliverable?.state).toBe('unfulfilled')})
})

it('a direct itinerary correction carries the original agenda and requires a new file in this turn',async()=>{
 const original='Make an itinerary for visiting founders in Harbor on Friday. Office tour at 10am, working sessions, hotels, restaurants and weekend activities.'
 const correction='No, Harbor North Coast, not the inland city.'
 const history:Parameters<typeof chatWithTools>[0]=[{role:'user',content:original},{role:'assistant',content:'An itinerary was made for the inland city.'},{role:'user',content:correction}]
 const contract=selectDeliverable(history)
 expect(contract?.kind).toBe('itinerary');expect(contract?.request).toContain('Office tour at 10am');expect(contract?.request).toContain(correction)
 const search={name:'web_search',description:'test',inputSchema:{},execute:vi.fn(async()=>({success:false,error:'Research blocked'}))}
 const reader={name:'web_fetch',description:'test',inputSchema:{},execute:vi.fn(async()=>({success:false,error:'Research blocked'}))}
 const f=file();gateway([stop('I will create the corrected itinerary now.')])
 const r=await chatWithTools(history,{gatewayUrl:'https://gateway.test',apiKey:'test',model:'test'},[search,reader,f],ctx)
 expect(r.deliverable?.state).toBe('unfulfilled');expect(r.reply).toContain('no new file');expect(r.reply).not.toBe('I will create the corrected itinerary now.')
})
it('correction cannot restart an unrelated older artifact or override cancellation',()=>{
 expect(selectDeliverable([{role:'user',content:'Make a packing list'},{role:'user',content:'What time is it?'},{role:'user',content:'No, Harbor North Coast'}])).toBeNull()
 expect(selectDeliverable([{role:'user',content:'Make an itinerary'},{role:'user',content:'No, never mind'}])).toBeNull()
 expect(selectDeliverable([{role:'assistant',content:'Make an itinerary'},{role:'user',content:'No, Harbor North Coast'}])).toBeNull()
})
