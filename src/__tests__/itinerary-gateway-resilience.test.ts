import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatWithTools } from '@/lib/spectrum/dinghy'
vi.mock('@/lib/data-portability/erasure-state', () => ({ assertAccountActive: vi.fn(async () => {}) }))
afterEach(() => vi.unstubAllGlobals())
const ctx = {userId:'fictional',telegramId:0,telegramChatId:0,name:'Alex',timezone:'UTC',tokens:{}}
const file = (impl?:()=>Promise<{success:boolean;error?:string}>) => ({name:'create_file',description:'test',inputSchema:{},execute:vi.fn(impl??(async()=>({success:true,data:{status:'queued_for_delivery'}})))})
const toolCall=(name:string,args:unknown)=>({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:'f',type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]})
const stop=(content:string)=>({choices:[{finish_reason:'stop',message:{content}}]})
const err500=()=>new Response('upstream failed',{status:500})
const itineraryFile={title:'Harbor itinerary',body:'## Day 1\nHarbor museum. Hours unknown.',format:'pdf',kind:'itinerary'}
function gateway(sequence:unknown[]) {const bodies:any[]=[];vi.stubGlobal('fetch',vi.fn(async(_u,init)=>{const i=bodies.length;bodies.push(init?.body?JSON.parse(init.body):null);const r=sequence[Math.min(i,sequence.length-1)];return r instanceof Response?r:new Response(JSON.stringify(r))}));return bodies}
const ask='Make me an itinerary for Harbor tomorrow. Breakfast at 9am then the harbor tour at 11am.'
const emptyAsk='Make me an itinerary for Harbor tomorrow.'
const opts=(stages:string[])=>({gatewayUrl:'https://gateway.test',apiKey:'test',model:'test',deadlineAt:Date.now()+240_000,onStage:async(_s:string,d?:string)=>{if(d)stages.push(d)}})
describe('itinerary contract gateway resilience',()=>{
 it('one gateway 500 retries once and completes the itinerary file',async()=>{
  const stages:string[]=[];const f=file()
  gateway([err500(),toolCall('create_file',itineraryFile),stop('Here you go.')])
  const r=await chatWithTools([{role:'user',content:ask}],opts(stages),[f],ctx)
  expect(f.execute).toHaveBeenCalledTimes(1)
  expect(r.deliverable).toEqual({kind:'itinerary',state:'completed'})
  expect(stages).toContain('itinerary:gateway_retry')
  expect(r.reply).not.toContain('Something went wrong')
 })
 it('two gateway 500s fall back to the agenda-only file with honestly unverified recommendations',async()=>{
  const stages:string[]=[];const f=file()
  gateway([err500(),err500()])
  const r=await chatWithTools([{role:'user',content:ask}],opts(stages),[f],ctx)
  expect(stages).toContain('itinerary:gateway_retry')
  expect(stages).toContain('itinerary:agenda_only_fallback')
  expect(f.execute).toHaveBeenCalledTimes(1)
  const input=(f.execute.mock.calls[0] as unknown[])[0] as {body:string,kind:string}
  expect(input.kind).toBe('itinerary')
  expect(input.body).toContain('Recommendations not verified')
  expect(input.body).not.toMatch(/Venue names, categories and addresses/)
  expect(r.reply).toContain('Recommendations remain unverified')
  expect(r.reply).not.toContain('Something went wrong')
 })
 it('a throw from the agenda-only file degrades to honest text, never the generic error',async()=>{
  const stages:string[]=[];const f=file(async()=>{throw new Error('hosting down')})
  gateway([err500(),err500()])
  const r=await chatWithTools([{role:'user',content:ask}],opts(stages),[f],ctx)
  expect(stages).toContain('itinerary:agenda_only_failed')
  expect(r.reply).toContain('research and publication did not complete')
  expect(r.reply).toContain('Recommendations remain unverified')
  expect(r.deliverable?.state).toBe('unfulfilled')
 })
 it('two gateway 500s with nothing the user supplied to preserve send honest text, not an empty page presented as done',async()=>{
  const stages:string[]=[];const f=file()
  gateway([err500(),err500()])
  const r=await chatWithTools([{role:'user',content:emptyAsk}],opts(stages),[f],ctx)
  expect(stages).toContain('itinerary:no_agenda_content')
  expect(f.execute).not.toHaveBeenCalled()
  expect(r.deliverable?.state).toBe('unfulfilled')
  expect(r.reply).toContain("I couldn't finish researching this trip")
  expect(r.reply).toContain(emptyAsk)
 })
 it('no third attempt: after one retry the fallback owns the outcome',async()=>{
  const stages:string[]=[];const f=file()
  const bodies=gateway([err500(),err500(),toolCall('create_file',itineraryFile),stop('unused')])
  const r=await chatWithTools([{role:'user',content:ask}],opts(stages),[f],ctx)
  expect(bodies.filter(b=>b&&b.messages)).toHaveLength(2)
  expect(r.reply).toContain('Recommendations remain unverified')
 })
 it('non-itinerary turns still throw gateway errors to the handler',async()=>{
  gateway([err500()])
  await expect(chatWithTools([{role:'user',content:'What time is it?'}],opts([]),[file()],ctx)).rejects.toThrow('Gateway 500')
 })
})
