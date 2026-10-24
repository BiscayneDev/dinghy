import { afterEach, describe, expect, it, vi } from 'vitest'
import { decideDeliverable, deliverableIntentEnabled, DELIVERABLE_INTENT_FLAG } from '@/lib/files/deliverable-intent'
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
const decision=(choice:string,confidence=0.9,prob=0.9)=>({provider:'hopscotch',model:'jev-1',answers:{deliverable:{type:'choice',choice,confidence,probabilities:{[choice]:prob}}}})
const call=(raw:unknown,ok=true)=>decideDeliverable({gatewayUrl:'https://gateway.test',apiKey:'test',request:'What is fun to do in Harbor. The wedding is at 4pm.',context:'[]',fetch:vi.fn(async()=>new Response(JSON.stringify(raw),{status:ok?200:500}))})
describe('model-owned deliverable intent',()=>{
 it('is flag-gated, default legacy',()=>{
  expect(deliverableIntentEnabled()).toBe(false)
  vi.stubEnv(DELIVERABLE_INTENT_FLAG,'on');expect(deliverableIntentEnabled()).toBe(true)
 })
 it('selects the itinerary the keyword contract misses',async()=>{
  const c=await call(decision('itinerary'))
  expect(c?.kind).toBe('itinerary');expect(c?.request).toContain('wedding is at 4pm')
 })
 it.each(['map','comparison','list','note'])('selects %s',async(kind)=>{
  expect((await call(decision(kind)))?.kind).toBe(kind)
 })
 it('returns null for none',async()=>{expect(await call(decision('none'))).toBeNull()})
 it('rejects uncertain, stub, unknown and unavailable decisions',async()=>{
  await expect(call(decision('itinerary',0.5))).rejects.toThrow('unavailable or uncertain')
  await expect(call(decision('itinerary',0.9,0.4))).rejects.toThrow('unavailable or uncertain')
  await expect(call({...decision('itinerary'),provider:'stub-local'})).rejects.toThrow('unavailable or uncertain')
  await expect(call(decision('brochure'))).rejects.toThrow('unknown deliverable')
  await expect(call({},false)).rejects.toThrow('unavailable')
 })
 it('makes exactly one bounded decision call',async()=>{
  const f=vi.fn(async()=>new Response(JSON.stringify(decision('itinerary'))))
  await decideDeliverable({gatewayUrl:'https://gateway.test',apiKey:'test',request:'r',context:'[]',fetch:f})
  expect(f).toHaveBeenCalledTimes(1)
  const body=JSON.parse(f.mock.calls[0][1]?.body as string)
  expect(Object.keys(body.questions)).toEqual(['deliverable'])
 })
})
