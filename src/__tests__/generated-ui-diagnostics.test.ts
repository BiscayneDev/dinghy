import {it,expect,vi,afterEach} from 'vitest'
import {generationFailure,generationTool} from '@/lib/pages/generate-tool'
afterEach(()=>vi.unstubAllGlobals())
it.each([[500,'provider attempt timeout after 15000ms','timeout'],[500,'secret customer payload','gateway'],[401,'bad key','authentication'],[402,'limit','budget'],[429,'slow','rate_limit']])('reduces HTTP %s to safe finite diagnostics',async(status,message,reason)=>{
 const d=await generationFailure(new Response(JSON.stringify({error:{message}}),{status:Number(status),headers:{'x-shipyard-chat-attempt-limit':'3'}}),15001)
 expect(d).toEqual({status,elapsedMs:15001,reason,attemptLimit:3})
 expect(JSON.stringify(d)).not.toContain(message)
})
it('no retry, publication or raw error leak after gateway failure',async()=>{
 const fetch=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>new Response(JSON.stringify({error:{message:'provider timeout secret'}}),{status:500}))
 vi.stubGlobal('fetch',fetch)
 const onDiagnostic=vi.fn(),onGenerated=vi.fn()
 const tool=generationTool({gatewayUrl:'https://fictional.invalid',apiKey:'fictional',request:'fictional',modelFields:()=>({model:'auto'}),onDiagnostic,onGenerated})
 const r=await tool.execute({brief:'fictional',facts:''},{userId:'fictional',telegramId:0,telegramChatId:0,name:'Example',timezone:'UTC',tokens:{}})
 expect(fetch).toHaveBeenCalledOnce();expect(onGenerated).not.toHaveBeenCalled()
 expect(onDiagnostic.mock.calls[0][0]).toMatchObject({status:500,reason:'timeout'})
 expect(r).toEqual({success:false,error:'Coding model did not complete the generated UI'})
 const body=JSON.parse(fetch.mock.calls[0][1]?.body as string)
 expect(body.model).toBe('auto');expect(body.max_tokens).toBe(6000)
})
