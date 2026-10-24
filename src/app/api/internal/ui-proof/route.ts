import {NextResponse} from 'next/server'
import {createHash,randomUUID,timingSafeEqual} from 'crypto'
import {createServerClient} from '@/lib/supabase/server'
import {runUiProof} from '@/lib/spectrum/ui-proof'
import {safeProofStage} from '@/lib/spectrum/itinerary-proof'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=120
const GUID='selftest;-;fixed-ui'
const headers={'Cache-Control':'private, no-store'}
/** Auth reuses the existing scoped internal-proof bearer (DINGHY_ITINERARY_PROOF_TOKEN)
 * instead of adding a fresh persistent secret. The one-use claim below is namespaced per
 * proof type, so one secret still yields at most one UI-proof attempt. */
function auth(req:Request):string|null {
 const secret=process.env.DINGHY_ITINERARY_PROOF_TOKEN
 if(!secret||! /^[a-f0-9]{64}$/.test(secret))return null
 const given=req.headers.get('authorization')??''
 const expected='Bearer '+secret
 const a=Buffer.from(given),b=Buffer.from(expected)
 if(a.length!==b.length||!timingSafeEqual(a,b))return null
 return createHash('sha256').update(secret).digest('hex')
}
function runId(hash:string){return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`}
/** No caller-controlled input. At most one paid attempt per secret, including across
 * instances/replays/timeouts: the durable claim lands BEFORE any paid call. */
export async function POST(req:Request){
 const hash=auth(req);if(!hash)return NextResponse.json({error:'Unauthorized'},{status:401,headers})
 if(req.headers.get('content-length')&&req.headers.get('content-length')!=='0')return NextResponse.json({error:'This self-test accepts no input'},{status:400,headers})
 if((await req.text()).trim())return NextResponse.json({error:'This self-test accepts no input'},{status:400,headers})
 const db=createServerClient(),id=runId(hash)
 const {data,error}=await db.rpc('claim_inbound_delivery',{p_message_id:'internal-ui-proof:'+hash,p_chat_guid:GUID,p_claim_id:randomUUID()})
 if(error)return NextResponse.json({error:'Claim unavailable'},{status:503,headers})
 if(data!==true)return NextResponse.json({synthetic:true,runId:id,verdict:'already_attempted',statusRoute:'GET same endpoint'},{status:409,headers})
 const record=async(stage:Parameters<typeof safeProofStage>[0],detail?:string)=>{
  const s=safeProofStage(stage,detail)
  const {error}=await db.from('dinghy_run_stages').insert({run_id:id,chat_guid:GUID,message_id:null,stage:s.stage,detail:s.detail??null})
  if(error)throw new Error('Synthetic verdict storage unavailable')
 }
 try {
  await record('context','selftest:started')
  const report=await runUiProof(record)
  if(report.verdict==='unavailable')await record('failed','selftest:missing_configuration')
  return NextResponse.json({runId:id,...report},{headers})
 }catch{return NextResponse.json({synthetic:true,runId:id,verdict:'failed',code:'verdict_storage_unavailable'},{status:503,headers})}
}
export async function GET(req:Request){
 const hash=auth(req);if(!hash)return NextResponse.json({error:'Unauthorized'},{status:401,headers})
 const {data,error}=await createServerClient().from('dinghy_run_stages').select('stage,detail,created_at').eq('run_id',runId(hash)).eq('chat_guid',GUID).order('created_at').limit(120)
 if(error)return NextResponse.json({error:'Verdict unavailable'},{status:503,headers})
 const rows=data??[]
 const terminal=[...rows].reverse().find((r:{detail:string|null})=>r.detail==='selftest:passed'||r.detail==='selftest:failed'||r.detail?.startsWith('selftest:execution_failed')||r.detail==='selftest:missing_configuration')
 const verdict=terminal?.detail==='selftest:passed'?'passed':terminal?'failed':rows.length?'pending_or_interrupted':'not_started'
 return NextResponse.json({synthetic:true,runId:runId(hash),verdict,stages:rows},{headers})
}
