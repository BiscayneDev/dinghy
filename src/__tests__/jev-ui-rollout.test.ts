import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/data-portability/erasure-state', () => ({ assertAccountActive: vi.fn(async () => {}) }))
import { jevUiEnabled, UI_DECISION_FLAG } from '@/lib/pages/catalogue'
import { chatWithTools } from '@/lib/spectrum/dinghy'
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
const ctx = {userId:'fictional',telegramId:0,telegramChatId:0,name:'Alex',timezone:'UTC',tokens:{}}
const fileTool = {name:'create_file',description:'test',inputSchema:{},execute:vi.fn(async()=>({success:true,data:{status:'queued_for_delivery'}}))}
const stop = (content: string) => ({choices:[{finish_reason:'stop',message:{content}}]})
describe('Jev UI owner-scoped rollout gates',()=>{
 it('flag semantics: off by default, on globally, or a sender allowlist',()=>{
  vi.stubEnv(UI_DECISION_FLAG,'');expect(jevUiEnabled('+1222')).toBe(false)
  vi.stubEnv(UI_DECISION_FLAG,'on');expect(jevUiEnabled()).toBe(true)
  vi.stubEnv(UI_DECISION_FLAG,'+1111, +1222');expect(jevUiEnabled('+1222')).toBe(true);expect(jevUiEnabled('+1333')).toBe(false);expect(jevUiEnabled()).toBe(false)
 })
 it('degrades to the un-gated path when the UI decision is unavailable, never killing the reply',async()=>{
  vi.stubEnv(UI_DECISION_FLAG,'on')
  const calls:string[]=[]
  vi.stubGlobal('fetch',vi.fn(async(u:unknown)=>{const url=String(u);calls.push(url);if(url.includes('/v1/decisions'))return new Response('down',{status:500});return new Response(JSON.stringify(stop('A plain answer.')))}))
  const stages:string[]=[]
  const r=await chatWithTools([{role:'user',content:'hello'}],{gatewayUrl:'https://gateway.test',apiKey:'test',model:'test',sender:'+1222',onStage:async(_s:unknown,d:unknown)=>{stages.push(String(d))}},[fileTool as never],ctx)
  expect(r.reply).toBe('A plain answer.')
  expect(r.reply).not.toContain('UI decision service')
  expect(calls.some(u=>u.includes('/v1/decisions'))).toBe(true)
  expect(stages).toContain('ui:jev:unavailable')
 })
 it('skips the decision entirely for a sender outside the allowlist',async()=>{
  vi.stubEnv(UI_DECISION_FLAG,'+1111')
  const calls:string[]=[]
  vi.stubGlobal('fetch',vi.fn(async(u:unknown)=>{const url=String(u);calls.push(url);return new Response(JSON.stringify(stop('A plain answer.')))}))
  const r=await chatWithTools([{role:'user',content:'hello'}],{gatewayUrl:'https://gateway.test',apiKey:'test',model:'test',sender:'+1222'},[fileTool as never],ctx)
  expect(r.reply).toBe('A plain answer.')
  expect(calls.some(u=>u.includes('/v1/decisions'))).toBe(false)
 })
})
