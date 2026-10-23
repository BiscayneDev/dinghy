import {afterEach,it,expect,vi} from 'vitest'
import {generationTool,generationBudgetMs} from '@/lib/pages/generate-tool'
import {modelFields} from '@/lib/spectrum/routing'
import {chatWithTools} from '@/lib/spectrum/dinghy'
const ctx={userId:'fictional',telegramId:0,telegramChatId:0,name:'Example',timezone:'UTC',tokens:{}}
const gen={version:1,title:'Fictional',fallback:'Example only.',controls:[{id:'amount',label:'Value',type:'number',value:'5'}],code:'return "<p>"+Number(values.amount)+"</p>"'}
const response=()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(gen)}}]}))
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs()})
it('budget reserves finish time, caps generation, never alters ordinary modelFields',()=>{
 vi.useFakeTimers();vi.setSystemTime(0)
 expect(generationBudgetMs()).toBe(45000);expect(generationBudgetMs(30000)).toBe(20000);expect(generationBudgetMs(9000)).toBe(0)
 vi.setSystemTime(15000);expect(generationBudgetMs(30000)).toBe(5000)
 expect(modelFields('unused',{providers:['hopscotch']})).toMatchObject({model:'auto',shipyard:{attempt_timeout_ms:15000}})
})
it('generation gets bounded remaining time, preserving routing and no retry, and aborts at its deadline',async()=>{
 vi.useFakeTimers();vi.setSystemTime(0)
 let signal:AbortSignal|undefined,body:Record<string,unknown>|undefined
 const fetch=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{signal=init?.signal??undefined;body=JSON.parse(init?.body as string);return await new Promise<Response>(()=>{})});vi.stubGlobal('fetch',fetch)
 const onGenerated=vi.fn(),onDiagnostic=vi.fn()
 const tool=generationTool({gatewayUrl:'https://fictional.invalid',apiKey:'fake',request:'fictional',deadlineAt:30000,modelFields:()=>modelFields('unused',{providers:['hopscotch']}),onGenerated,onDiagnostic})
 const pending=tool.execute({brief:'example',facts:''},ctx)
 await vi.advanceTimersByTimeAsync(20000)
 expect((await pending).success).toBe(false);expect(signal?.aborted).toBe(true);expect(onGenerated).not.toHaveBeenCalled()
 expect(body).toMatchObject({model:'auto',max_tokens:6000,stream:false,shipyard:{providers:['hopscotch'],attempt_timeout_ms:20000,no_fallback:true}})
 expect(onDiagnostic).toHaveBeenCalledWith({reason:'timeout',elapsedMs:20000})
 await tool.execute({brief:'example',facts:''},ctx);expect(fetch).toHaveBeenCalledOnce()
})
it('late response after cancellation never invokes generated callback',async()=>{
 vi.useFakeTimers();vi.setSystemTime(0)
 let resolve!:(r:Response)=>void;vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(r=>{resolve=r})))
 const onGenerated=vi.fn();const tool=generationTool({gatewayUrl:'https://fictional.invalid',apiKey:'fake',request:'fictional',deadlineAt:11000,modelFields:()=>({model:'auto'}),onGenerated})
 const pending=tool.execute({brief:'example',facts:''},ctx);await vi.advanceTimersByTimeAsync(1000);await pending;resolve(response());await vi.advanceTimersByTimeAsync(1)
 expect(onGenerated).not.toHaveBeenCalled()
})
it('exhausted budget makes no request, parent cancellation aborts immediately',async()=>{
 vi.useFakeTimers();vi.setSystemTime(0)
 const fetch=vi.fn(()=>new Promise<Response>(()=>{}));vi.stubGlobal('fetch',fetch)
 const base={gatewayUrl:'https://fictional.invalid',apiKey:'fake',request:'fictional',modelFields:()=>({model:'auto'}),onGenerated:vi.fn()}
 expect((await generationTool({...base,deadlineAt:9000}).execute({brief:'example',facts:''},ctx)).success).toBe(false);expect(fetch).not.toHaveBeenCalled()
 const ac=new AbortController(),tool=generationTool(base),p=tool.execute({brief:'example',facts:''},{...ctx,signal:ac.signal});ac.abort();expect((await p).success).toBe(false)
})
it('real tool loop accepts 20s coding completion formerly discarded at15s and publishes exact generated block once',async()=>{
 vi.useFakeTimers();vi.setSystemTime(0);vi.stubEnv('DINGHY_JEV_UI','on')
 let chats=0,generatedBody='',codingCalls=0
 vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{
  const b=JSON.parse(init.body as string)
  if(url.endsWith('/decisions'))return new Response(JSON.stringify({model:'jev',provider:'typesafe',answers:{ui:{type:'choice',choice:'generate',confidence:1,probabilities:{generate:1}}}}))
  if(b.response_format){codingCalls++;expect(b.shipyard).toMatchObject({attempt_timeout_ms:45000,no_fallback:true});await new Promise(r=>setTimeout(r,20000));return response()}
  for(const m of b.messages??[])if(m.role==='tool'){const r=JSON.parse(m.content);if(r.body)generatedBody=r.body}
  const name=chats++===0?'generate_ui':'create_file'
  if(chats>2)return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'Done'}}]}))
  return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:'call'+chats,function:{name,arguments:JSON.stringify(name==='generate_ui'?{brief:'example',facts:''}:{title:'Fictional',body:generatedBody})}}]}}]}))
 }))
 const execute=vi.fn(async()=>({success:true,data:{}}))
 const pending=chatWithTools([{role:'user',content:'build a fictional interactive calculator'}],{gatewayUrl:'https://fictional.invalid',apiKey:'fake',model:'unused',routing:{providers:['hopscotch']},deadlineAt:85000},[{name:'create_file',description:'File',inputSchema:{type:'object'},execute}],ctx)
 await vi.advanceTimersByTimeAsync(20001);await pending
 expect(codingCalls).toBe(1);expect(execute).toHaveBeenCalledOnce();expect(generatedBody).toContain(':::pages');expect(generatedBody).toContain('Example only.')
})
it('normal tools still stop at15s, generation-specific exception does not change them',async()=>{
 vi.useFakeTimers();vi.setSystemTime(0)
 let calls=0;vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason:calls++?'stop':'tool_calls',message:calls===1?{content:null,tool_calls:[{id:'wait',function:{name:'fictional_wait',arguments:'{}'}}]}:{content:'Stopped'}}]}))))
 const execute=vi.fn(()=>new Promise<never>(()=>{}))
 const pending=chatWithTools([{role:'user',content:'fictional wait'}],{gatewayUrl:'https://fictional.invalid',apiKey:'fake',model:'unused',deadlineAt:85000},[{name:'fictional_wait',description:'wait',inputSchema:{type:'object'},execute}],ctx)
 await vi.advanceTimersByTimeAsync(15001);expect((await pending).reply).toBe('Stopped');expect(execute).toHaveBeenCalledOnce()
})

it('deadline covers stalled response-body read and prevents late result publication',async()=>{
 vi.useFakeTimers();vi.setSystemTime(0)
 let resolve!:(d:unknown)=>void,signal:AbortSignal|undefined
 vi.stubGlobal('fetch',vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{signal=init?.signal??undefined;return {ok:true,status:200,json:()=>new Promise(r=>{resolve=r})} as Response}))
 const onGenerated=vi.fn(),tool=generationTool({gatewayUrl:'https://fictional.invalid',apiKey:'fake',request:'fictional',deadlineAt:12000,modelFields:()=>({model:'auto'}),onGenerated})
 const pending=tool.execute({brief:'example',facts:''},ctx);await vi.advanceTimersByTimeAsync(2000)
 expect((await pending).success).toBe(false);expect(signal?.aborted).toBe(true)
 resolve({choices:[{message:{content:JSON.stringify(gen)}}]});await vi.advanceTimersByTimeAsync(1);expect(onGenerated).not.toHaveBeenCalled()
})
