import {chatWithTools} from './dinghy'
import {GATEWAY_URL,SHIPYARD_API_KEY,SHIPYARD_MODEL} from './config'
import {routingFor} from './routing'
import {classifyUserTurn} from './turn-class'
import {gateTools} from './tool-gating'
import {webSearch,webFetch} from '@/lib/tools/web'
import {fileToolsFor} from '@/lib/files/tool'
import type {RunStage} from './run-stage'

/** Fixed public-only case. No user lookup, history, accounts or transport. */
export const PROOF_REQUEST='INTERNAL SYNTHETIC SELF-TEST. Make an itinerary for fictional founders visiting Miami on an unspecified Friday: user-supplied Wynwood office visit at 10am followed by working sessions. Include hotel and restaurant recommendations and weekend activities. Do not book, invite or message anyone. Do not invent a calendar date. Leave prices, ratings, hours and availability unknown unless supported by current sources. Create a hosted PDF itinerary with a downloadable PDF. Mark the title Synthetic itinerary self-test.'
export const PROOF_BLIND_SPOTS=['webhook ingress/authentication','real owner history and connected account context','handset delivery and rich-link visibility','independent truth of source-reported claims']
export type ProofStage={stage:RunStage;detail?:string}
export function safeProofStage(stage:RunStage,detail?:string):ProofStage {
 // Only code-shaped runtime metadata. Never persist model text or raw errors.
 return {stage,...(detail&&/^[a-zA-Z0-9_:,.-]{1,80}$/.test(detail)?{detail}:{})}
}
export async function runItineraryProof(onStage:(stage:RunStage,detail?:string)=>Promise<void>) {
 if(!SHIPYARD_API_KEY||!process.env.TAVILY_API_KEY||!process.env.HERENOW_API_KEY)return {synthetic:true,noSend:true,verdict:'unavailable',code:'missing_configuration',blindSpots:PROOF_BLIND_SPOTS}
 const files=fileToolsFor(),stages:ProofStage[]=[]
 const ctx={userId:'',telegramId:0,telegramChatId:0,name:'Synthetic test',timezone:'America/New_York',tokens:{}}
 const record=async(stage:RunStage,detail?:string)=>{const s=safeProofStage(stage,detail);stages.push(s);await onStage(s.stage,s.detail)}
 try {
  const tools=gateTools([webSearch,webFetch,...files.tools.filter(t=>t.name==='create_file')],[PROOF_REQUEST]).active
  const result=await chatWithTools([{role:'user',content:PROOF_REQUEST}],{gatewayUrl:GATEWAY_URL,apiKey:SHIPYARD_API_KEY,model:SHIPYARD_MODEL,routing:routingFor(),taskClass:classifyUserTurn(PROOF_REQUEST),facts:[],includeOpener:false,capabilities:{google:false,wallet:false,files:true,live:true,search:true},deadlineAt:Date.now()+105000,onStage:record},tools,ctx)
  const made=files.files(),f=made[0]
  const checks={research:stages.some(s=>s.detail==='research:read_ok'),validation:result.deliverable?.state==='completed',binding:Boolean(f?.markdown?.includes('## Source provenance')),render:Boolean(f?.bytes.length),pdf:f?.mimeType==='application/pdf',card:Boolean(f?.card),publish:Boolean(f?.hosted),oneFile:made.length===1}
  const verdict=Object.values(checks).every(Boolean)?'passed':'failed'
  await record('reply_ready','selftest:'+verdict)
  return {synthetic:true,noSend:true,verdict,checks,stages,...(f?.hosted?{file:{title:f.title,url:f.hosted.url,expiresAt:f.hosted.expiresAt}}:{}),blindSpots:PROOF_BLIND_SPOTS}
 } catch {
  // Never return exception strings: provider responses may contain secrets/data.
  await record('failed','selftest:execution_failed')
  return {synthetic:true,noSend:true,verdict:'failed',code:'execution_failed',stages,blindSpots:PROOF_BLIND_SPOTS}
 } finally {files.close()}
}
