/* eslint-disable @typescript-eslint/no-explicit-any */
import {afterEach,describe,expect,it,vi} from 'vitest'
import {generationTool} from '@/lib/pages/generate-tool'
import {chatWithTools} from '@/lib/spectrum/dinghy'

const gen={version:1,title:'Fictional calculator',fallback:'Illustrative calculation only. Enter a value to double it.',controls:[{id:'amount',label:'Value',type:'number',value:'5'}],code:'return "<p>Result: "+(Number(values.amount)*2)+"</p>"'}
const answer=(choice:string)=>({model:'jev-latest',provider:'typesafe',answers:{ui:{type:'choice',choice,confidence:0.96,probabilities:{[choice]:0.96}}}})
const ctx={userId:'fictional-u',telegramId:0,telegramChatId:0,name:'Example',timezone:'UTC',tokens:{}}
const options={gatewayUrl:'https://gateway.test',apiKey:'fictional',model:'test',deliverable:null}
const valid={brief:'double a fictional number',facts:'fictional example figures only'}
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()})

const mkTool=(over:Record<string,unknown>={})=>generationTool({gatewayUrl:'https://gateway.test',apiKey:'k',modelFields:()=>({model:'m'}),request:'fictional',onGenerated:()=>{},...over} as any)
const okRes=()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(gen)}}]}))

describe('one paid coding attempt per turn, enforced at the execution boundary',()=>{
 it('success then recall: exactly one upstream fetch; recall redirects to create_file',async()=>{
  let fetches=0;vi.stubGlobal('fetch',vi.fn(async()=>{fetches++;return okRes()}))
  const t=mkTool()
  const first=await t.execute(valid as any,{} as any)
  expect(first.success).toBe(true)
  const second=await t.execute(valid as any,{} as any)
  expect(second.success).toBe(false)
  expect((second as any).error).toContain('create_file')
  expect(fetches).toBe(1)
 })
 it('upstream HTTP failure consumes the one attempt: recall never reaches a second fetch',async()=>{
  let fetches=0;vi.stubGlobal('fetch',vi.fn(async()=>{fetches++;return new Response('{}',{status:500})}))
  const t=mkTool()
  const first=await t.execute(valid as any,{} as any)
  expect(first.success).toBe(false)
  const second=await t.execute(valid as any,{} as any)
  expect(second.success).toBe(false)
  expect((second as any).error).toContain('already used')
  expect(fetches).toBe(1)
 })
 it('a budget-blocked first call consumes the attempt: no sequence reaches any fetch later',async()=>{
  let fetches=0;vi.stubGlobal('fetch',vi.fn(async()=>{fetches++;return okRes()}))
  const t=mkTool({deadlineAt:Date.now()-1000})
  const first=await t.execute(valid as any,{} as any)
  expect(first.success).toBe(false)
  const second=await t.execute(valid as any,{} as any)
  expect((second as any).error).toContain('already used')
  expect(fetches).toBe(0)
 })
 it('concurrent duplicate invocations: exactly one fetch',async()=>{
  let fetches=0;vi.stubGlobal('fetch',vi.fn(async()=>{fetches++;await new Promise(r=>setTimeout(r,10));return okRes()}))
  const t=mkTool()
  const [a,b]=await Promise.all([t.execute(valid as any,{} as any),t.execute(valid as any,{} as any)])
  expect([a.success,b.success].sort()).toEqual([false,true])
  expect(fetches).toBe(1)
 })
 it('malformed input does not consume the attempt',async()=>{
  let fetches=0;vi.stubGlobal('fetch',vi.fn(async()=>{fetches++;return okRes()}))
  const t=mkTool()
  const bad=await t.execute({brief:'',facts:''} as any,{} as any)
  expect(bad.success).toBe(false)
  const good=await t.execute(valid as any,{} as any)
  expect(good.success).toBe(true)
  expect(fetches).toBe(1)
 })
})

describe('deterministic publication of a successful generation',()=>{
 it('pathological model re-calls generate_ui and never create_file: one coding fetch, block still published once',async()=>{
  vi.stubEnv('DINGHY_JEV_UI','on')
  let codingFetches=0,chat=0
  const stages:string[]=[]
  vi.stubGlobal('fetch',vi.fn(async(url:string,opts:RequestInit)=>{
   const b=JSON.parse(opts.body as string)
   if(url.endsWith('/v1/decisions'))return new Response(JSON.stringify(answer('generate')))
   if(b.response_format){codingFetches++;return okRes()}
   chat++
   if(chat>3)return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'Done with the fictional UI.'}}]}))
   return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:'gen-'+chat,function:{name:'generate_ui',arguments:JSON.stringify(valid)}}]}}]}))
  }))
  const execute=vi.fn(async(_input:unknown,_ctx:unknown)=>({success:true,data:{}}))
  const r=await chatWithTools([{role:'user',content:'build an interactive fictional calculator'}],{...options,onStage:async(_s:unknown,d:unknown)=>{stages.push(String(d))}},[{name:'create_file',description:'File',inputSchema:{type:'object'},execute}],ctx)
  expect(codingFetches).toBe(1)
  expect(execute).toHaveBeenCalledOnce()
  expect(String((execute.mock.calls[0][0] as any).body)).toContain(':::pages')
  expect(String((execute.mock.calls[0][0] as any).body)).toContain('"generated"')
  expect(execute.mock.calls[0][1]).toMatchObject({generatedUiAuthorized:true})
  expect(stages).toContain('generate_ui:auto_publish')
  expect(r.reply).toContain('Done')
 })
 it('well-behaved model publishes after generating: still exactly one publish, no duplicate',async()=>{
  vi.stubEnv('DINGHY_JEV_UI','on')
  let chat=0,generatedBody=''
  vi.stubGlobal('fetch',vi.fn(async(url:string,opts:RequestInit)=>{
   const b=JSON.parse(opts.body as string)
   if(url.endsWith('/v1/decisions'))return new Response(JSON.stringify(answer('generate')))
   for(const m of b.messages??[]){if(m.role==='tool'){try{const v=JSON.parse(m.content);if(v.body)generatedBody=v.body}catch{}}}
   if(b.response_format)return okRes()
   const name=chat++===0?'generate_ui':'create_file'
   if(chat>2)return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'Finished fictional UI.'}}]}))
   return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:'call-'+chat,function:{name,arguments:JSON.stringify(name==='generate_ui'?valid:{title:'Fictional calculator',body:generatedBody})}}]}}]}))
  }))
  const execute=vi.fn(async(_input:unknown,_ctx:unknown)=>({success:true,data:{}}))
  await chatWithTools([{role:'user',content:'build an interactive fictional calculator'}],options,[{name:'create_file',description:'File',inputSchema:{type:'object'},execute}],ctx)
  expect(execute).toHaveBeenCalledOnce()
 })
})
