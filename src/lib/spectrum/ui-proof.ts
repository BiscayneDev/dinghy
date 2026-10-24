import {chatWithTools} from './dinghy'
import {GATEWAY_URL,SHIPYARD_API_KEY,SHIPYARD_MODEL} from './config'
import {routingFor} from './routing'
import {classifyUserTurn} from './turn-class'
import {gateTools} from './tool-gating'
import {fileToolsFor} from '@/lib/files/tool'
import {enqueueOutbox} from './outbox'
import {chatGuidForPhone} from './waitlist-invites'
import {safeProofStage,type ProofStage} from './itinerary-proof'
import type {RunStage} from './run-stage'

/** Fixed public-only case. No user lookup, history, accounts or transport. The request is
 * fictional and self-contained, and matches no legacy deliverable kind (verified by test),
 * so the Jev UI gate is what routes it - naturally to catalogue, generate or text. */
export const UI_PROOF_REQUEST='INTERNAL SYNTHETIC SELF-TEST. Build an interactive fictional boat fuel cost splitter: one numeric input for fictional party size; fictional 200-mile trip at 25 mpg and $4.00 per gallon; illustrative only. Do not research, message, book or buy anything. Mark the title Synthetic UI self-test.'
/** Dedicated self-test sender. With DINGHY_JEV_UI set to this handle, ONLY this proof gates:
 * organic owner messages never match it, and this handle never matches an owner allowlist.
 * This proves the gate + decision + composition + render + host path under A sender-scoped
 * entry; the owner-number match itself is string equality covered by unit tests. */
export const UI_PROOF_SENDER='selftest-ui-proof'
export const UI_PROOF_BLIND_SPOTS=['owner-number allowlist match is unit-tested only, not live-proven','webhook ingress/authentication','real owner history and connected account context','handset rich-link rendering (delivery is the plain-link sweep variant)','failed upstream attempts may still be billed: an outage means no generation attempted, not zero spend']
export type UiProofReport={
 synthetic:true
 verdict:'passed'|'failed'|'unavailable'
 code?:string
 route?:'catalogue'|'generate'|'text'|'unavailable'|'none'
 checks?:Record<string,boolean>
 stages?:ProofStage[]
 delivery?:{outboxId:string}|{skipped:'no_recipient'|'no_artifact'|'enqueue_failed'}
 file?:{title:string;url:string;expiresAt:string}
 blindSpots:string[]
}
export async function runUiProof(onStage:(stage:RunStage,detail?:string)=>Promise<void>):Promise<UiProofReport> {
 if(!SHIPYARD_API_KEY||!process.env.HERENOW_API_KEY)return {synthetic:true,verdict:'unavailable',code:'missing_configuration',blindSpots:UI_PROOF_BLIND_SPOTS}
 const files=fileToolsFor(),stages:ProofStage[]=[]
 const ctx={userId:'',telegramId:0,telegramChatId:0,name:'Synthetic test',timezone:'America/New_York',tokens:{}}
 const record=async(stage:RunStage,detail?:string)=>{const s=safeProofStage(stage,detail);stages.push(s);await onStage(s.stage,s.detail)}
 try {
  const tools=gateTools([...files.tools.filter(t=>t.name==='create_file')],[UI_PROOF_REQUEST]).active
  await chatWithTools([{role:'user',content:UI_PROOF_REQUEST}],{gatewayUrl:GATEWAY_URL,apiKey:SHIPYARD_API_KEY,model:SHIPYARD_MODEL,routing:routingFor(),taskClass:classifyUserTurn(UI_PROOF_REQUEST),facts:[],includeOpener:false,capabilities:{google:false,wallet:false,files:true,live:true,search:false},deadlineAt:Date.now()+105000,onStage:record,sender:UI_PROOF_SENDER},tools,ctx)
  const made=files.files(),f=made[0]
  const routeDetail=stages.map(s=>s.detail).find(d=>d?.startsWith('ui:jev:'))
  const route=routeDetail?.startsWith('ui:jev:catalogue:')?'catalogue':routeDetail==='ui:jev:generate'?'generate':routeDetail==='ui:jev:text'?'text':routeDetail==='ui:jev:unavailable'?'unavailable':'none'
  // Delivery leg: one fixed-marker plain link to the env-fixed recipient via the real outbox;
  // the sweep sends it. Never model-chosen text; no caller-controlled recipient.
  let delivery:{outboxId:string}|{skipped:'no_recipient'|'no_artifact'|'enqueue_failed'}
  const recipient=process.env.DINGHY_UI_PROOF_RECIPIENT??''
  if(!f?.hosted)delivery={skipped:'no_artifact'}
  else if(!recipient)delivery={skipped:'no_recipient'}
  else {
   const outboxId=await enqueueOutbox(chatGuidForPhone(recipient),'reply',`Dinghy synthetic UI self-test (fictional): ${f.hosted.url}`)
   delivery=outboxId?{outboxId}:{skipped:'enqueue_failed'}
   await record('reply_ready',outboxId?'selftest:delivery_enqueued':'selftest:delivery_enqueue_failed')
  }
  const checks={gated:route==='catalogue'||route==='generate',artifact:Boolean(f?.bytes?.length),publish:Boolean(f?.hosted),oneFile:made.length===1,delivery:Boolean('outboxId'in delivery)}
  const verdict=Object.values(checks).every(Boolean)?'passed':'failed'
  await record('reply_ready','selftest:'+verdict)
  return {synthetic:true,verdict,route,checks,stages,delivery,...(f?.hosted?{file:{title:'Synthetic UI self-test',url:f.hosted.url,expiresAt:f.hosted.expiresAt}}:{}),blindSpots:UI_PROOF_BLIND_SPOTS}
 } catch {
  // Never return exception strings: provider responses may contain secrets/data.
  await record('failed','selftest:execution_failed')
  return {synthetic:true,verdict:'failed',code:'execution_failed',stages,blindSpots:UI_PROOF_BLIND_SPOTS}
 } finally {files.close()}
}
