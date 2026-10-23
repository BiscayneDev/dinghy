import { decodeUiDecision, uiChoiceQuestion, type UiDecision } from './catalogue'
import type { GatewayUsage } from '@/lib/spectrum/metering'
/** One typed Jev judgment. Never replaces an unavailable decision with heuristics. */
export async function decideUi(opts: {gatewayUrl:string;apiKey:string;request:string;context:string;signal?:AbortSignal;onUsage?:(u:GatewayUsage)=>void;fetch?:typeof fetch}):Promise<UiDecision> {
    const start=Date.now()
    const res=await (opts.fetch??fetch)(`${opts.gatewayUrl}/v1/decisions`,{method:'POST',signal:opts.signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${opts.apiKey}`},body:JSON.stringify({model:'jev-latest',state:{request:opts.request,context:opts.context},questions:{ui:uiChoiceQuestion()}})})
    if(!res.ok)throw new Error('Jev UI decision service unavailable')
    const data=await res.json()
    if(data.usage)opts.onUsage?.({model:data.model??'jev',inputTokens:data.usage.inputTokens??0,outputTokens:data.usage.outputTokens??0,costUsd:null,latencyMs:Date.now()-start})
    return decodeUiDecision(data)
}
