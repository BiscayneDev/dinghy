import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/data-portability/erasure-state', () => ({ assertAccountActive: vi.fn(async () => {}) }))
import { UI_DECISION_FLAG } from '@/lib/pages/catalogue'
import { UI_PROOF_FLAG, uiProofSender } from '@/lib/pages/ui-proof-once'
import { chatWithTools } from '@/lib/spectrum/dinghy'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
const OWNER = '+12035168398'
const ctx = {userId:'fictional',telegramId:0,telegramChatId:0,name:'Alex',timezone:'UTC',tokens:{}}
const base = {gatewayUrl:'https://gateway.test',apiKey:'test',model:'test',sender:OWNER}
const stop = (content:string) => new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content}}]}))
const answer = (choice:string) => ({model:'jev-latest',provider:'typesafe',answers:{ui:{type:'choice',choice,confidence:0.96,probabilities:{[choice]:0.96}}}})
const stages = (arr:string[]) => async (_s:unknown,d:unknown) => { arr.push(String(d)) }
const fileTool = {name:'create_file',description:'t',inputSchema:{},execute:vi.fn(async()=>({success:true,data:{status:'queued_for_delivery'}}))}

describe('UI proof flag semantics', () => {
 it('off when unset, never global on "on", exact sender allowlist', () => {
  vi.stubEnv(UI_PROOF_FLAG, ''); expect(uiProofSender(OWNER)).toBe(false)
  vi.stubEnv(UI_PROOF_FLAG, 'on'); expect(uiProofSender(OWNER)).toBe(false)
  vi.stubEnv(UI_PROOF_FLAG, `${OWNER}, +1111`); expect(uiProofSender(OWNER)).toBe(true); expect(uiProofSender('+1222')).toBe(false)
  expect(uiProofSender()).toBe(false)
 })
})

describe('one-use catalogue proof turn', () => {
 it('forbids generate at the mechanism level: no note, no tool, no generation call, route recorded', async () => {
  vi.stubEnv(UI_PROOF_FLAG, OWNER)
  const stageLog:string[] = []; const bodies:string[] = []
  vi.stubGlobal('fetch', vi.fn(async (u:unknown, init?:RequestInit) => {
   const url = String(u)
   if (init?.body) bodies.push(String(init.body))
   if (url.includes('/v1/decisions')) return new Response(JSON.stringify(answer('generate')))
   return stop('A plain fictional answer.')
  }))
  const r = await chatWithTools([{role:'user',content:'make me a fictional quiz game'}],{...base,deliverable:null,onStage:stages(stageLog),uiProofClaim:async()=>true},[fileTool as never],ctx)
  expect(r.reply).toBe('A plain fictional answer.')
  expect(stageLog).toContain('ui:proof:claimed')
  expect(stageLog).toContain('ui:jev:generate')
  expect(stageLog).toContain('ui:jev:generate:forbidden:proof')
  expect(stageLog).toContain('ui:proof:consumed:generate')
  expect(bodies.some((b) => b.includes('coding worker'))).toBe(false)
 })
 it('runs the real catalogue selection once and records the consumed route', async () => {
  vi.stubEnv(UI_PROOF_FLAG, OWNER)
  const stageLog:string[] = []; const calls:string[] = []
  vi.stubGlobal('fetch', vi.fn(async (u:unknown) => {
   const url = String(u); calls.push(url)
   if (url.includes('/v1/decisions')) return new Response(JSON.stringify(answer('calc')))
   return stop('Splitting the fictional bill.')
  }))
  const r = await chatWithTools([{role:'user',content:'split this fictional $90 dinner three ways'}],{...base,deliverable:null,onStage:stages(stageLog),uiProofClaim:async()=>true},[fileTool as never],ctx)
  expect(r.reply).toBe('Splitting the fictional bill.')
  expect(calls.some((u) => u.includes('/v1/decisions'))).toBe(true)
  expect(stageLog).toContain('ui:proof:claimed')
  expect(stageLog).toContain('ui:jev:catalogue:calc')
  expect(stageLog).toContain('ui:proof:consumed:catalogue:calc')
 })
 it('a spent claim closes the gate: no decision call, plain path', async () => {
  vi.stubEnv(UI_PROOF_FLAG, OWNER)
  const calls:string[] = []
  vi.stubGlobal('fetch', vi.fn(async (u:unknown) => {
   const url = String(u); calls.push(url)
   return stop('A plain fictional answer.')
  }))
  const r = await chatWithTools([{role:'user',content:'hello'}],{...base,deliverable:null,uiProofClaim:async()=>false},[fileTool as never],ctx)
  expect(r.reply).toBe('A plain fictional answer.')
  expect(calls.some((u) => u.includes('/v1/decisions'))).toBe(false)
 })
 it('a failing claim fails closed: no decision call, reply unharmed', async () => {
  vi.stubEnv(UI_PROOF_FLAG, OWNER)
  const calls:string[] = []
  vi.stubGlobal('fetch', vi.fn(async (u:unknown) => {
   const url = String(u); calls.push(url)
   return stop('A plain fictional answer.')
  }))
  const r = await chatWithTools([{role:'user',content:'hello'}],{...base,deliverable:null,uiProofClaim:async()=>{throw new Error('rpc down')}},[fileTool as never],ctx)
  expect(r.reply).toBe('A plain fictional answer.')
  expect(calls.some((u) => u.includes('/v1/decisions'))).toBe(false)
 })
 it('never consumes the proof on itinerary turns (chooser skipped by kind)', async () => {
  vi.stubEnv(UI_PROOF_FLAG, OWNER)
  const claim = vi.fn(async () => true)
  const stageLog:string[] = []
  let chat = 0
  vi.stubGlobal('fetch', vi.fn(async (u:unknown) => {
   const url = String(u)
   if (url.includes('/v1/decisions')) return new Response(JSON.stringify(answer('text')))
   if (chat++ === 0) return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:'c1',function:{name:'create_file',arguments:JSON.stringify({title:'Fictional Harbor Morning',kind:'itinerary',body:'## Saturday\n09:00 Fictional pier coffee'})}}]}}]}))
   return stop('Your fictional morning plan is ready.')
  }))
  const execute = vi.fn(async () => ({success:true,data:{status:'queued_for_delivery'}}))
  const r = await chatWithTools([{role:'user',content:'plan the fictional harbor morning'}],{...base,deliverable:{kind:'itinerary',request:'plan the fictional harbor morning'},onStage:stages(stageLog),uiProofClaim:claim},[{name:'create_file',description:'t',inputSchema:{},execute} as never],ctx)
  expect(r.reply).toContain('fictional morning plan')
  expect(claim).not.toHaveBeenCalled()
  expect(stageLog.some((s) => s.startsWith('ui:proof'))).toBe(false)
 })
 it('the rollout flag wins over the proof env: no claim consulted when DINGHY_JEV_UI matches', async () => {
  vi.stubEnv(UI_PROOF_FLAG, OWNER)
  vi.stubEnv(UI_DECISION_FLAG, OWNER)
  const claim = vi.fn(async () => true)
  vi.stubGlobal('fetch', vi.fn(async (u:unknown) => {
   const url = String(u)
   if (url.includes('/v1/decisions')) return new Response(JSON.stringify(answer('text')))
   return stop('A plain fictional answer.')
  }))
  const r = await chatWithTools([{role:'user',content:'hello'}],{...base,deliverable:null,uiProofClaim:claim},[fileTool as never],ctx)
  expect(r.reply).toBe('A plain fictional answer.')
  expect(claim).not.toHaveBeenCalled()
 })
 it('an unavailable decision consumes the proof and degrades to the plain path', async () => {
  vi.stubEnv(UI_PROOF_FLAG, OWNER)
  const stageLog:string[] = []
  vi.stubGlobal('fetch', vi.fn(async (u:unknown) => {
   const url = String(u)
   if (url.includes('/v1/decisions')) return new Response('down', {status:500})
   return stop('A plain fictional answer.')
  }))
  const r = await chatWithTools([{role:'user',content:'hello'}],{...base,deliverable:null,onStage:stages(stageLog),uiProofClaim:async()=>true},[fileTool as never],ctx)
  expect(r.reply).toBe('A plain fictional answer.')
  expect(stageLog).toContain('ui:jev:unavailable')
  expect(stageLog).toContain('ui:proof:consumed:unavailable')
 })
})
