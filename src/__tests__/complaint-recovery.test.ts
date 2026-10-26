import {expect,it,describe,vi,afterEach} from 'vitest'
import {chatWithTools} from '@/lib/spectrum/dinghy'
vi.mock('@/lib/data-portability/erasure-state',()=>({assertAccountActive:async()=>{}}))
afterEach(()=>vi.unstubAllGlobals())
const tool=(name:string,data:unknown={})=>({name,description:'fictional',inputSchema:{type:'object'},execute:vi.fn(async()=>({success:true,data}))})
const call=(name:string,i:unknown={})=>({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:name,function:{name,arguments:JSON.stringify(i)}}]}}]})
const empty={choices:[{finish_reason:'length',message:{content:''}}]}
const text=(t:string)=>({choices:[{finish_reason:'stop',message:{content:t}}]})
const ctx={userId:'',telegramId:0,telegramChatId:0,name:'Fictional',timezone:'UTC',tokens:{}}
const history=[
 {role:'user' as const,content:'Plan a short stay in Alderbrook with hotel and dinner picks.'},
 {role:'assistant' as const,content:'Here is your itinerary. https://fictional.here.now/'},
 {role:'user' as const,content:"That's not good"},
]
async function run(seq:unknown[],deadlineMs=55000){
 let n=0;const req:any[]=[];const stage=vi.fn(async()=>{})
 vi.stubGlobal('fetch',vi.fn(async(_u:unknown,init:any)=>{req.push(JSON.parse(init.body));return new Response(JSON.stringify(seq[n++]??text('Done')))}))
 const tools=[tool('recall_file',{title:'Itinerary',markdown:'## Sunday\nRecommendations not verified'}),tool('web_search',{results:[{url:'https://harbor.test/stay',title:'Stay guide',content:'Quiet rooms near the station.'}]}),tool('web_fetch',{url:'https://harbor.test/stay',title:'Stay guide',content:'Quiet rooms near the station.'}),tool('create_file')]
 const result=await chatWithTools(history,{gatewayUrl:'https://gateway.test',apiKey:'fictional',model:'fictional',onStage:stage,deadlineAt:Date.now()+deadlineMs},tools,ctx)
 return {result,req,stage}
}
describe('complaint after a delivered page, short on time',()=>{
 it('a blank completion is retried once with room and the real answer is delivered',async()=>{
  const {result,req,stage}=await run([call('web_search',{query:'alderbrook hotels'}),empty,text("You're right: that page had no real recommendations. The pages I found say the quiet rooms near the station are the best fit, but rates and dates are unchecked.")])
  expect(result.reply).toContain("You're right");expect(result.reply).not.toMatch(/couldn.t make that file/i)
  expect(req[1].max_tokens).toBe(1200);expect(req[2].max_tokens).toBe(2500)
  expect(stage).toHaveBeenCalledWith('tool','repair:empty_reply')
 })
 it('two blank completions end in an honest line with the pages found, never the file message',async()=>{
  const {result,stage}=await run([call('web_search',{query:'alderbrook hotels'}),empty,empty])
  expect(result.reply).not.toMatch(/file/i);expect(result.reply).toContain('ran out of time');expect(result.reply).toContain('https://harbor.test/stay')
  expect(stage).toHaveBeenCalledWith('reply_ready','empty:honest_fallback')
 })
 it('too little time left skips the retry and still answers honestly',async()=>{
  const {result,req}=await run([call('web_search',{query:'x'}),empty],12000)
  expect(result.reply).toContain('ran out of time');expect(req).toHaveLength(2)
 })
 it('a normal text reply is untouched',async()=>{
  const {result}=await run([text('Sorry, that page was empty. Redoing it now with real picks.')])
  expect(result.reply).toContain('Sorry')
 })
})
