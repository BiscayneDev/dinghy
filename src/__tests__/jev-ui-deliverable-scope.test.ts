import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/data-portability/erasure-state', () => ({ assertAccountActive: vi.fn(async () => {}) }))
import { UI_DECISION_FLAG } from '@/lib/pages/catalogue'
import { chatWithTools } from '@/lib/spectrum/dinghy'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
const OWNER = '+12035168398'
const ctx = {userId:'fictional',telegramId:0,telegramChatId:0,name:'Alex',timezone:'UTC',tokens:{}}
const base = {gatewayUrl:'https://gateway.test',apiKey:'test',model:'test',sender:OWNER}
const stop = (content:string) => new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content}}]}))
const toolCall = (name:string,args:object,id='c1') => new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id,function:{name,arguments:JSON.stringify(args)}}]}}]}))
const answer = (choice:string) => ({model:'jev-latest',provider:'typesafe',answers:{ui:{type:'choice',choice,confidence:0.96,probabilities:{[choice]:0.96}}}})
const stages = (arr:string[]) => async (_s:unknown,d:unknown) => { arr.push(String(d)) }

describe('Jev UI deliverable scoping', () => {
 it('skips the UI decision on itinerary turns: no second judgment, the deliverable pipeline publishes', async () => {
  vi.stubEnv(UI_DECISION_FLAG, OWNER)
  const calls:string[] = []; const stageLog:string[] = []
  const execute = vi.fn(async () => ({success:true,data:{status:'queued_for_delivery'}}))
  let chat = 0
  vi.stubGlobal('fetch', vi.fn(async (u:unknown) => {
   const url = String(u); calls.push(url)
   if (url.includes('/v1/decisions')) return new Response(JSON.stringify(answer('text')))
   if (chat++ === 0) return toolCall('create_file', {title:'Fictional Harbor Morning', kind:'itinerary', body:'## Saturday\n09:00 Fictional pier coffee\n10:30 Fictional lighthouse walk'})
   return stop('Your fictional morning plan is ready.')
  }))
  const r = await chatWithTools([{role:'user',content:'plan the fictional harbor morning with the stops I gave you'}],{...base,deliverable:{kind:'itinerary',request:'plan the fictional harbor morning with the stops I gave you'},onStage:stages(stageLog)},[{name:'create_file',description:'t',inputSchema:{},execute} as never],ctx)
  expect(calls.some(u => u.includes('/v1/decisions'))).toBe(false)
  expect(stageLog).toContain('ui:jev:skipped:deliverable:itinerary')
  expect(execute).toHaveBeenCalledOnce()
  expect(r.reply).toContain('ready')
 })

 it('skips the UI decision on map turns', async () => {
  vi.stubEnv(UI_DECISION_FLAG, OWNER)
  const calls:string[] = []; const stageLog:string[] = []
  const execute = vi.fn(async () => ({success:true,data:{status:'queued_for_delivery'}}))
  let chat = 0
  vi.stubGlobal('fetch', vi.fn(async (u:unknown) => {
   const url = String(u); calls.push(url)
   if (url.includes('/v1/decisions')) return new Response(JSON.stringify(answer('text')))
   if (chat++ === 0) return toolCall('create_file', {title:'Fictional Coffee Map', body:'Locator, not a floor map. Indoor positions and walking routes are unverified.\n:::places\nFictional Cafe | unknown | Open | Made-up corner spot | 1 Fictional Lane | 9-5 | | | |\n:::\n:::sources\nFictional cafe list | https://example.com/fictional-cafes | checked today\n:::'})
   return stop('Your fictional map page is ready.')
  }))
  const r = await chatWithTools([{role:'assistant',content:'The fictional cafes you listed are at https://example.com/fictional-cafes'},{role:'user',content:'map the fictional cafes I listed'}],{...base,deliverable:{kind:'map',request:'map the fictional cafes I listed'},onStage:stages(stageLog)},[{name:'create_file',description:'t',inputSchema:{},execute} as never],ctx)
  expect(calls.some(u => u.includes('/v1/decisions'))).toBe(false)
  expect(stageLog).toContain('ui:jev:skipped:deliverable:map')
  expect(execute).toHaveBeenCalledOnce()
  expect(typeof r.reply).toBe('string')
 })

 it('a text judgment cannot withdraw a selected deliverable: artifact publishes, override logged', async () => {
  vi.stubEnv(UI_DECISION_FLAG, OWNER)
  const stageLog:string[] = []
  const execute = vi.fn(async () => ({success:true,data:{status:'queued_for_delivery'}}))
  let chat = 0; let decisionCalls = 0
  vi.stubGlobal('fetch', vi.fn(async (u:unknown) => {
   const url = String(u)
   if (url.includes('/v1/decisions')) { decisionCalls++; return new Response(JSON.stringify(answer('text'))) }
   if (chat++ === 0) return toolCall('create_file', {title:'Fictional Notes', body:'## Fictional notes\n- one\n- two'})
   return stop('Your fictional notes page is ready.')
  }))
  const r = await chatWithTools([{role:'user',content:'make a fictional notes page'}],{...base,deliverable:{kind:'note',request:'make a fictional notes page'},onStage:stages(stageLog)},[{name:'create_file',description:'t',inputSchema:{},execute} as never],ctx)
  expect(decisionCalls).toBe(1)
  expect(stageLog).toContain('ui:jev:text:overridden:deliverable:note')
  expect(execute).toHaveBeenCalledOnce()
  expect(r.reply).toContain('ready')
 })

 it('without a deliverable, a text judgment still blocks create_file', async () => {
  vi.stubEnv(UI_DECISION_FLAG, OWNER)
  const execute = vi.fn(async () => ({success:true,data:{}}))
  let chat = 0
  vi.stubGlobal('fetch', vi.fn(async (u:unknown) => {
   const url = String(u)
   if (url.includes('/v1/decisions')) return new Response(JSON.stringify(answer('text')))
   if (chat++ === 0) return toolCall('create_file', {title:'Fictional Page', body:'hello'})
   return stop('A plain fictional answer.')
  }))
  const r = await chatWithTools([{role:'user',content:'hello'}],{...base,deliverable:null},[{name:'create_file',description:'t',inputSchema:{},execute} as never],ctx)
  expect(execute).not.toHaveBeenCalled()
  expect(r.reply).toBe('A plain fictional answer.')
 })

 it('a text judgment on a deliverable turn still rejects sneaked generated UI', async () => {
  vi.stubEnv(UI_DECISION_FLAG, OWNER)
  const execute = vi.fn(async () => ({success:true,data:{}}))
  let chat = 0
  vi.stubGlobal('fetch', vi.fn(async (u:unknown) => {
   const url = String(u)
   if (url.includes('/v1/decisions')) return new Response(JSON.stringify(answer('text')))
   if (chat++ === 0) return toolCall('create_file', {title:'Fictional Page', body:':::pages\n'+JSON.stringify({version:1,generated:{title:'x',fallback:'f',controls:[],code:'return "x"'}})+'\n:::'})
   return stop('Recovered with a plain fictional page.')
  }))
  await chatWithTools([{role:'user',content:'make a fictional notes page'}],{...base,deliverable:{kind:'note',request:'make a fictional notes page'}},[{name:'create_file',description:'t',inputSchema:{},execute} as never],ctx)
  expect(execute).not.toHaveBeenCalled()
 })

 it('flag absent on an itinerary turn: no skip stage, no decision call, artifact still publishes', async () => {
  vi.stubEnv(UI_DECISION_FLAG, '')
  const calls:string[] = []; const stageLog:string[] = []
  const execute = vi.fn(async () => ({success:true,data:{status:'queued_for_delivery'}}))
  let chat = 0
  vi.stubGlobal('fetch', vi.fn(async (u:unknown) => {
   const url = String(u); calls.push(url)
   if (chat++ === 0) return toolCall('create_file', {title:'Fictional Harbor Morning', kind:'itinerary', body:'## Saturday\n09:00 Fictional pier coffee'})
   return stop('Your fictional morning plan is ready.')
  }))
  const r = await chatWithTools([{role:'user',content:'plan the fictional harbor morning with the stops I gave you'}],{...base,deliverable:{kind:'itinerary',request:'plan the fictional harbor morning with the stops I gave you'},onStage:stages(stageLog)},[{name:'create_file',description:'t',inputSchema:{},execute} as never],ctx)
  expect(calls.some(u => u.includes('/v1/decisions'))).toBe(false)
  expect(stageLog.some(s => s.startsWith('ui:jev'))).toBe(false)
  expect(execute).toHaveBeenCalledOnce()
  expect(r.reply).toContain('ready')
 })
})
