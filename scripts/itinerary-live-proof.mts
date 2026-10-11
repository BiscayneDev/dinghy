/** Isolated live run. Requires securely injected env. No real identities/account
 * tokens/history, no iMessage transport. Never loads connected user context. */
import * as React from 'react'
;(globalThis as unknown as {React:unknown}).React=React
import {GATEWAY_URL,SHIPYARD_API_KEY,SHIPYARD_MODEL} from '../src/lib/spectrum/config'
import {writeFile,mkdir} from 'node:fs/promises'
import {chatWithTools} from '../src/lib/spectrum/dinghy'
import {gateTools} from '../src/lib/spectrum/tool-gating'
import {webSearch,webFetch} from '../src/lib/tools/web'
import {weather} from '../src/lib/tools/weather'
import {fileToolsFor} from '../src/lib/files/tool'
async function main(){
const required=['SHIPYARD_API_KEY','TAVILY_API_KEY','HERENOW_API_KEY']
if(required.some(k=>!process.env[k]))throw new Error('Secure environment injection required: '+required.filter(k=>!process.env[k]).join(', '))
if(process.env.DINGHY_DATA_ERASURE_ENABLED==='1')throw new Error('Isolated runner must not load account erasure context')
const slug='synthetic-itinerary-proof-'+Date.now()
const ctx={userId:'',telegramId:0,telegramChatId:0,name:'Synthetic test',timezone:'America/New_York',tokens:{}}
const request='SYNTHETIC PUBLIC-ONLY TEST. Make an itinerary for fictional founders visiting Miami on Friday: supplied Wynwood office visit at10am then working sessions. Include hotel, restaurant and weekend activity recommendations. No bookings, invites or messages. Leave dates/prices/ratings unknown unless sourced.'
const files=fileToolsFor()
const tools=gateTools([weather,webSearch,webFetch,...files.tools],[request]).active
const stages:{stage:string,detail?:string}[]=[]
const result=await chatWithTools([{role:'user',content:request}],{gatewayUrl:GATEWAY_URL,apiKey:SHIPYARD_API_KEY!,model:SHIPYARD_MODEL,deadlineAt:Date.now()+105000,onStage:async(stage,detail)=>{stages.push({stage,detail})}},tools,ctx)
await mkdir('/tmp/itinerary-proof',{recursive:true})
for(const file of files.files()){await writeFile('/tmp/itinerary-proof/'+file.filename,file.bytes);if(file.card)await writeFile('/tmp/itinerary-proof/card.png',file.card)}
const report={synthetic:true,noSend:true,identity:slug,stages,deliverable:result.deliverable,files:files.files().map(f=>({title:f.title,hosted:f.hosted,imagery:f.imagery})),blindSpots:['deployed webhook ingress/auth','real owner history/account context','handset delivery and rich-link visibility']}
await writeFile('/tmp/itinerary-proof/report.json',JSON.stringify(report,null,2))
console.log(JSON.stringify(report,null,2))
if(result.deliverable?.state!=='completed'||files.files().length!==1)process.exitCode=1

}
main().catch(err=>{console.error(err instanceof Error?err.message:String(err));process.exitCode=1})
