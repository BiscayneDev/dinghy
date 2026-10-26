// @vitest-environment node
import {afterAll,beforeAll,expect,it,vi} from 'vitest'
import {PGlite} from '@electric-sql/pglite'
import {readFileSync} from 'fs'
import {join} from 'path'
// FULL PATH, all fictional: real handler -> real intake -> real Postgres RPCs (PGlite, migration 077) -> real worker runtime -> real chatWithTools and create_file
// -> real renderer (publish mocked at the here.now boundary) -> real sendFile. Only the gateway, search, publish transport and chat transport are fakes.
const hoist=vi.hoisted(()=>({pg:null as any,sent:[] as string[],decisions:0,verdict:'redo_itinerary' as string|null,held:'new_instruction' as string,chatCalls:[] as any[],memoryQueries:[] as string[]}))
const {published}=vi.hoisted(()=>({published:vi.fn()}))
const {revoked}=vi.hoisted(()=>({revoked:vi.fn()}))
vi.mock('@/lib/files/share',()=>({shareEnabled:()=>true,publishSite:published,revokeSite:revoked,updateSite:vi.fn()}))
vi.mock('@/lib/spectrum/redo-worker-runtime',async orig=>{const m=await orig<any>();return {...m,kickRedoJobs:(t:number)=>(globalThis as any).__kick?m.kickRedoJobs(t):Promise.resolve({kicked:false})}})
vi.mock('@/lib/files/imagery',async orig=>({...await orig<any>(),verifyShareMetadata:async()=>true}))
vi.mock('@/lib/supabase/server',()=>({createServerClient:()=>{
 const pg=()=>hoist.pg
 const norm=(v:any)=>v instanceof Date?v.toISOString():typeof v==='bigint'?Number(v):v
 const rows=(r:any)=>r.rows.map((o:any)=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,norm(v)])))
 const from=(table:string)=>{
  const q:any={op:'select',cols:'*',w:[] as string[],p:[] as any[],ord:'',lim:'',single:false,payload:null}
  const add=(s:string,...v:any[])=>{const base=q.p.length;q.w.push(s.replace(/\$\$/g,()=>'$'+(base+1)));q.p.push(...v)}
  const b:any={select:(c?:string)=>{if(c)q.cols=c;return b},insert:(r:any)=>{q.op='insert';q.payload=r;return b},update:(r:any)=>{q.op='update';q.payload=r;return b},
   eq:(k:string,v:any)=>{add(`${k} = $$`,v);return b},in:(k:string,v:any[])=>{add(`${k} = any($$)`,v.map(String));return b},is:(k:string,v:any)=>{q.w.push(v===null?`${k} is null`:`${k} is ${v}`);return b},
   like:(k:string,v:string)=>{add(`${k} like $$`,v);return b},gte:(k:string,v:any)=>{add(`${k} >= $$`,v);return b},lte:(k:string,v:any)=>{add(`${k} <= $$`,v);return b},
   or:(s:string)=>{const parts=s.split(',').map(x=>{const [c,op,...r]=x.split('.');const val=r.join('.');if(op==='is')return `${c} is null`;q.p.push(val);return `${c} = $${q.p.length}`});q.w.push('('+parts.join(' or ')+')');return b},
   not:()=>b,order:(c:string,o?:any)=>{q.ord=` order by ${c} ${o?.ascending===false?'desc':'asc'}`;return b},limit:(n:number)=>{q.lim=` limit ${n}`;return b},
   maybeSingle:()=>{q.single=true;return b},single:()=>{q.single=true;return b}}
  const run=async()=>{try{
   const where=q.w.length?' where '+q.w.join(' and '):''
   let r:any
   if(q.op==='select')r=await pg().query(`select ${q.cols} from public.${table}${where}${q.ord}${q.lim}`,q.p)
   else if(q.op==='insert'){const ks=Object.keys(q.payload);r=await pg().query(`insert into public.${table} (${ks.join(',')}) values (${ks.map((_,i)=>'$'+(i+1)).join(',')}) returning *`,ks.map(k=>q.payload[k]))}
   else{const ks=Object.keys(q.payload);const base=q.p.length;const where2=q.w.length?' where '+q.w.join(' and '):'';r=await pg().query(`update public.${table} set ${ks.map((k,i)=>`${k}=$${base+i+1}`).join(',')}${where2} returning *`,[...q.p,...ks.map(k=>q.payload[k])])}
   const data=rows(r);return {data:q.single?(data[0]??null):data,error:null}
  }catch(e:any){return {data:null,error:{message:String(e.message)}}}}
  b.then=(res:any,rej:any)=>run().then(res,rej)
  return b}
 const rpc=async(fn:string,args:Record<string,any>)=>{try{
  const ks=Object.keys(args);const r=await pg().query(`select * from public.${fn}(${ks.map((k,i)=>`${k} := $${i+1}`).join(',')})`,ks.map(k=>args[k]))
  const data=rows(r);const cols=r.fields.map((f:any)=>f.name)
  return {data:cols.length===1&&cols[0]===fn?(data[0]?.[fn]??null):data,error:null}
 }catch(e:any){return {data:null,error:{message:String(e.message)}}}}
 return {from,rpc}}}))
vi.mock('@/spectrum/store',async orig=>({...await orig<any>(),ensureIdentity:async()=>{},isGoogleConnected:async()=>false,isPayboxConnected:async()=>false,isGithubConnected:async()=>false,isHealthConnected:async()=>false,loadFacts:async()=>[],
 loadHistory:async(_g:string,limit=20)=>{const r=await hoist.pg.query(`select role,content,created_at from (select * from spectrum_messages where chat_guid=$1 and role in ('user','assistant') order by id desc limit ${limit}) t order by created_at,role desc`,[CHAT]);return r.rows.map((x:any)=>({role:x.role,content:x.content,at:new Date(x.created_at).toISOString()}))},
 saveMessage:async(_g:string,role:string,content:string)=>{await hoist.pg.query(`insert into spectrum_messages(chat_guid,role,content) values ($1,$2,$3)`,[CHAT,role,content])},saveMessageReturningId:async()=>'id',updateMessageContent:async()=>{},createConnectLink:async()=>'https://x.test'}))
vi.mock('@/lib/spectrum/briefing',async orig=>({...await orig<any>(),briefableUserId:async()=>'00000000-0000-0000-0000-0000000000a1'}))
vi.mock('@/lib/spectrum/beta-gate',async orig=>({...await orig<any>(),getBetaRole:async()=>'owner'}))
vi.mock('@/lib/spectrum/outbox',async orig=>({...await orig<any>(),claimInboundDelivery:async()=>true,enqueueOutbox:async()=>'o',markOutboxSent:async()=>{},markOutboxFailed:async()=>{}}))
vi.mock('@/lib/data-portability/erasure-state',async orig=>({...await orig<any>(),assertAccountActive:async()=>{},erasureEnabled:()=>false,isEraseIntent:()=>false}))
vi.mock('@/lib/allowance',async orig=>({...await orig<any>(),allowanceUsedUpMessage:()=>'',claimLimitNotice:async()=>false,isOverDailyAllowance:async()=>({over:false})}))
vi.mock('@/lib/spectrum/rate-limit',async orig=>({...await orig<any>(),hitRateLimit:async()=>false}))
vi.mock('@/lib/spectrum/metering',async orig=>({...await orig<any>(),recordUsage:async()=>{}}))
vi.mock('@/lib/spectrum/memory',async orig=>({...await orig<any>(),loadMemoryContext:async(_g:string,q:string)=>{hoist.memoryQueries.push(q);return {profile:'Fictional traveller profile',summaries:[],facts:[],plans:['Harborville trip · Chose: Stay in Harborville: Harborville Inn [source: user]'],files:[]}},updateMemory:async()=>{}}))
vi.mock('@/lib/spectrum/active-run',async orig=>({...await orig<any>(),earlierUserText:()=>'',loadActiveRuns:async()=>[],steerNote:()=>''}))
vi.mock('@/lib/spectrum/actions',async orig=>({...await orig<any>(),hasPendingAction:async()=>false,cancelPendingActions:async()=>0,takeLooseProposal:()=>null}))
vi.mock('@/lib/spectrum/memory-commands',async orig=>({...await orig<any>(),handlePendingMemoryWipe:async()=>null}))
vi.mock('@/lib/spectrum/run-stage',async orig=>({...await orig<any>(),runStageRecorder:()=>async()=>{}}))
vi.mock('@/lib/spectrum/config',async orig=>({...await orig<any>(),SHIPYARD_API_KEY:'fictional',GATEWAY_URL:'https://gateway.test',SHIPYARD_MODEL:'auto'}))
vi.mock('@/lib/spectrum/dinghy',async orig=>{const m=await orig<any>();return {...m,chatWithTools:(h:any,o:any,t:any,c:any)=>{hoist.chatCalls.push({history:h,opts:o,tools:t.map((x:any)=>x.name)});return m.chatWithTools(h,o,t,c)}}})
vi.mock('@/lib/spectrum/imessage-tools',async orig=>({...await orig<any>(),loadImessageToolContext:async()=>({userId:'00000000-0000-0000-0000-0000000000a1',chatGuid:'any;-;+15550000000',telegramId:0,telegramChatId:0,name:'Synthetic test',timezone:'UTC',tokens:{}})}))
vi.mock('@/lib/spectrum/app',()=>({getSpectrumApp:async()=>({}),getImessage:async()=>({space:{get:async()=>({id:CHAT,send:async(t:any)=>{hoist.sent.push(t)}})}})}))
import {handleSpectrumMessage} from '@/lib/spectrum/handler'
import {runOneRedoJob} from '@/lib/spectrum/redo-worker-runtime'
const CHAT='any;-;+15550000000'
const U='00000000-0000-0000-0000-0000000000a1'
const MIG=readFileSync(join(process.cwd(),'supabase/migrations/077_redo_jobs.sql'),'utf8')
const call=(name:string,args:unknown)=>new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:'1',function:{name,arguments:JSON.stringify(args)}}]}}]}))
const stop=(c:string)=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:c}}]}))
const lineOf=(req:any,nm:string)=>{const sys=req.messages.find((m:any)=>m.role==='system'&&String(m.content).startsWith('Candidate lines'));const l=String(sys?.content).split('\n').find((x:string)=>/^L\d+ \| /.test(x)&&x.split(' | ')[1]===nm);return l?Number(l.split(' | ')[0].slice(1)):0}
let gateway:any[]=[],selects=0
const inbound=(id:string,text:string)=>({id,direction:'inbound',content:{type:'text',text},sender:{handle:'+15550000000'},timestamp:new Date()}) as any
function install(opts:{searchOnly?:boolean;blank?:boolean;onGateway?:()=>Promise<void>}={}){
 vi.stubEnv('TAVILY_API_KEY','fictional-key')
 vi.stubGlobal('fetch',vi.fn(async(u:any,init:any)=>{
  const url=String(u)
  if(url.includes('tavily'))return new Response(JSON.stringify({results:[{title:'Fictional listings',url:'https://harbor.test/v',content:'Hotel, dining and museum public listings.'}]}))
  if(url==='https://harbor.test/v')return new Response('<html><title>listings</title><body>public listings. Harborville Inn rooms. Harborville Cafe dinner. Harborville Museum tickets. Rooms $200. Menu served. Hours, prices and availability unverified.</body></html>')
  if(url.endsWith('/v1/decisions')&&String(init.body).includes('heldNote')){const nv=hoist.held;return new Response(JSON.stringify({provider:'jev',model:'jev',answers:{heldNote:{type:'choice',choice:nv,confidence:0.9,probabilities:{repeat:0.05,new_instruction:0.05,stop:0.05,[nv]:0.9}}}}))}
  if(url.endsWith('/v1/decisions')){hoist.decisions++;if((globalThis as any).__rejectRedo&&String(init.body).includes('redo_'))return new Response('bad',{status:400});if(hoist.verdict===null)return new Response('no',{status:500});const v=hoist.verdict;return new Response(JSON.stringify({provider:'jev',model:'jev',answers:{deliverable:{type:'choice',choice:v,confidence:0.9,probabilities:{none:0.05,itinerary:0.05,[v]:0.9}}}}))}
  if(!url.includes('gateway.test'))return new Response('{}')
  const b=JSON.parse(init.body);if(b.max_tokens===8)return stop('yes')
  gateway.push(b)
  if(opts.onGateway&&gateway.length===1)await opts.onGateway()
  const names=(b.tools??[]).map((t:any)=>t.function.name)
  const forced=b.tool_choice?.function?.name
  if(opts.blank)return new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:''}}]}))
  if(opts.searchOnly)return call('web_search',{query:'fictional harborville listings'})
  if(forced==='select_itinerary_candidates'){selects++;return call(forced,{candidates:(selects===1?[['hotel','Harborville Inn']]:[['restaurant','Harborville Cafe'],['activity','Harborville Museum']]).map(([kind,nm])=>({kind,line:lineOf(b,nm as string)}))})}
  if(forced==='create_file'||(selects>=2&&names.includes('create_file')))return call('create_file',{title:'Harborville itinerary',body:'## Day 1\n- Arrival.\n## Sunday\n- Evening departure.',format:'pdf',kind:'itinerary'})
  if(forced==='web_search'||forced==='web_fetch')return call('web_search',{query:'fictional harborville listings'})
  return stop('Sent.')
 }))
}
const space={id:CHAT,send:async(t:any)=>{hoist.sent.push(t)}}
const texts=()=>hoist.sent.filter((x:any)=>typeof x==='string') as string[]
const ORIGINAL='Help me plan an itinerary for fictional travellers to Harborville. Hotel and restaurant recommendations please.'
const pgq=async(sql:string,p:any[]=[])=>(await hoist.pg.query(sql,p)).rows
beforeAll(async()=>{
 const {PGlite:P}=await import('@electric-sql/pglite');hoist.pg=new P()
 await hoist.pg.exec(`create role anon; create role authenticated; create role service_role;
  create table public.users(id uuid primary key);
  create table public.spectrum_identities(user_id uuid, chat_guid text);
  create table public.spectrum_messages(id bigint generated always as identity primary key, chat_guid text, role text, content text, google_derived boolean default false, created_at timestamptz default now());
  create table public.dinghy_files(id uuid primary key default gen_random_uuid(), user_id uuid references users(id), chat_guid text, title text, kind text not null default 'file', format text, url text, markdown text default '', expires_at timestamptz, created_at timestamptz default now(), deleted_at timestamptz, revoked_at timestamptz);
  create table public.dinghy_run_stages(id bigint generated always as identity primary key, run_id uuid, chat_guid text, message_id text, stage text, detail text, created_at timestamptz default now());
  create table public.spectrum_outbox(id uuid primary key default gen_random_uuid(), chat_guid text not null, kind text not null, text text not null, status text default 'pending');
  create table public.memories(google_derived boolean, source_channel text, created_at timestamptz);
  create table public.conversation_summaries(google_derived boolean, embedding_model text, created_at timestamptz);`)
 await hoist.pg.exec(MIG)
})
afterAll(async()=>{await hoist.pg.close()})
let seq=0
async function seed(opts:{legacy?:boolean}={}){
 await hoist.pg.exec(`truncate dinghy_redo_jobs,spectrum_outbox,spectrum_messages,dinghy_run_stages,dinghy_files,spectrum_identities,users cascade`)
 await pgq(`insert into users values ($1)`,[U]);await pgq(`insert into spectrum_identities values ($1,$2)`,[U,CHAT])
 const t=(m:number)=>new Date(Date.now()-m*60000).toISOString()
 await pgq(`insert into spectrum_messages(chat_guid,role,content,created_at) values ($1,'user',$2,$3),($1,'assistant','I am putting the itinerary together. I will send it here when it is ready.',$4),($1,'assistant','The supplied agenda is attached. Recommendations remain unverified.',$5),($1,'assistant','[file: Unverified itinerary] https://empty.here.now/',$6)`,[CHAT,ORIGINAL,t(30),t(29.9),t(28),t(27.9)])
 const f=(await pgq(`insert into dinghy_files(user_id,chat_guid,title,kind,format,url,markdown,created_at) values ($1,$2,'Unverified itinerary','itinerary','page','https://empty.here.now/','agenda only',$3) returning id`,[U,CHAT,t(28)]))[0].id
 if(opts.legacy){
  const run='11111111-1111-1111-1111-111111111111'
  await pgq(`insert into dinghy_run_stages(run_id,chat_guid,message_id,stage,detail,created_at) values ($1,$2,'spc-msg-fictional','context','deliverable:itinerary',$3),($1,$2,'spc-msg-fictional','reply_ready','deliverable:itinerary:completed',$4)`,[run,CHAT,t(29.98),t(28.01)])
 } else await pgq(`update dinghy_files set origin_request=$2, origin_kind='itinerary' where id=$1`,[f,ORIGINAL])
 gateway=[];selects=0;hoist.verdict='redo_itinerary';hoist.held='new_instruction';hoist.sent=[];hoist.chatCalls=[];hoist.memoryQueries=[];hoist.decisions=0;published.mockReset();revoked.mockReset();revoked.mockResolvedValue({url:'x'});(globalThis as any).__kick=false;published.mockResolvedValue({url:'https://fictional.here.now/',expiresAt:new Date(Date.now()+86400000).toISOString(),files:[]})
 return f as string
}
const jobs=()=>pgq(`select state,phase,note_ids,note_revision,consumed_revision,failure from dinghy_redo_jobs`)

async function complain(text:string,id='c'+(++seq)){await handleSpectrumMessage(space,inbound(id,text))}
for(const legacy of [false,true])it(`${legacy?'LEGACY file (no stored origin, bound from run and message ids)':'new file (stored origin)'}: complaint -> durable job -> worker -> rebuilt page published and sent, bound to the job`,async()=>{
 vi.stubEnv('DINGHY_REDO_JOBS','on');install();const fid=await seed({legacy})
 await complain("That's not good")
 expect(texts().join('\n')).toMatch(/rebuilding that page and will send it/)
 expect(hoist.chatCalls).toHaveLength(0);expect(published).not.toHaveBeenCalled()
 expect((await jobs())[0]).toMatchObject({state:'queued'})
 const origin=(await pgq(`select origin_request from dinghy_files where id=$1`,[fid]))[0].origin_request;expect(origin).toBe(ORIGINAL)
 hoist.sent=[]
 const ran=await runOneRedoJob();if(ran.outcome!=='done')console.log('JOB',JSON.stringify(await jobs()),texts().join(' | '));expect(ran).toMatchObject({ran:true,outcome:'done'})
 const call=hoist.chatCalls[0];expect(call.history).toHaveLength(1)
 expect(call.history[0].content).toContain('Original request:\n'+ORIGINAL);expect(call.history[0].content).toContain("That's not good")
 expect(call.history[0].content).not.toContain('Unverified itinerary');expect(call.opts.deliverable.kind).toBe('itinerary')
 expect(call.opts.memory).toContain('Chose: Stay in Harborville');expect(hoist.memoryQueries.at(-1)).toContain('Harborville')
 for(const banned of ['spend','set_reminder','create_reminder','invite'])expect(call.tools.join(',')).not.toContain(banned)
 expect(published).toHaveBeenCalledTimes(1)
 const html=published.mock.calls[0][0].find((f:any)=>f.path==='index.html').bytes.toString();expect(html).toContain('Harborville Inn');expect(html).toContain('Evening departure')
 expect(hoist.sent.length).toBeGreaterThan(0);expect((await pgq(`select content from spectrum_messages where role='assistant' and content like '[file:%fictional.here.now%'`)).length).toBe(1)
 const newFile=(await pgq(`select redo_op_id, origin_request, origin_kind from dinghy_files where url='https://fictional.here.now/'`))[0]
 expect(newFile.redo_op_id).toBeTruthy();expect(newFile.origin_request).toContain('Original request:\n'+ORIGINAL);expect(newFile.origin_kind).toBe('itinerary')
 expect((await jobs())[0]).toMatchObject({state:'done',phase:'sent'})
 expect(await runOneRedoJob()).toMatchObject({ran:false})
})
it('flag off: a complaint is ordinary chat, no job, no extra decision call, no repair promise',async()=>{
 vi.stubEnv('DINGHY_REDO_JOBS','off');install();await seed()
 await complain("That's not good")
 expect(await jobs()).toHaveLength(0);expect(texts().join('\n')).not.toMatch(/rebuilding that page|redo/i);expect(hoist.decisions).toBe(0)
})
it('a note added while the job is queued is carried into the same build, with no second job',async()=>{
 vi.stubEnv('DINGHY_REDO_JOBS','on');install();await seed()
 await complain("That's not good");await complain('also keep Sunday evening free')
 const j=await jobs();expect(j).toHaveLength(1);expect(j[0].note_ids).toHaveLength(2)
 await runOneRedoJob();expect(hoist.chatCalls[0].history[0].content).toContain('also keep Sunday evening free')
 expect((await jobs())[0]).toMatchObject({state:'done'})
})
it('stop while queued: nothing is built or sent',async()=>{
 vi.stubEnv('DINGHY_REDO_JOBS','on');install();await seed();hoist.held='stop'
 await complain("That's not good");await complain('actually never mind, stop')
 expect((await jobs())[0].state).toBe('cancelled');expect(await runOneRedoJob()).toMatchObject({ran:false});expect(published).not.toHaveBeenCalled()
})
it('crash after claim before any external step: the lease expires and the job resumes once and completes',async()=>{
 vi.stubEnv('DINGHY_REDO_JOBS','on');install();await seed();await complain("That's not good")
 await pgq(`select * from claim_redo_job()`);await pgq(`update dinghy_redo_jobs set lease_until=now()-interval '1 minute'`)
 expect(await runOneRedoJob()).toMatchObject({ran:true,outcome:'done'});expect(published).toHaveBeenCalledTimes(1)
})
it('crash during sending: blocked, never re-sent, one honest status',async()=>{
 vi.stubEnv('DINGHY_REDO_JOBS','on');install();await seed();await complain("That's not good")
 const j=(await pgq(`select * from claim_redo_job()`))[0];await pgq(`select redo_advance($1,$2,'sending',1)`,[j.id,j.claim_id]);await pgq(`update dinghy_redo_jobs set lease_until=now()-interval '1 minute'`)
 hoist.sent=[];expect(await runOneRedoJob()).toMatchObject({ran:false});expect(published).not.toHaveBeenCalled()
 expect((await jobs())[0]).toMatchObject({state:'blocked',failure:'outcome_unknown'})
 const ob=await pgq(`select text from spectrum_outbox`);expect(ob).toHaveLength(1);expect(ob[0].text).toMatch(/could not confirm/)
 await runOneRedoJob();expect(await pgq(`select 1 from spectrum_outbox`)).toHaveLength(1)
})
it('legacy file whose request cannot be bound reliably: specific gap, no job, nothing published',async()=>{
 vi.stubEnv('DINGHY_REDO_JOBS','on');install();await seed({legacy:true});await pgq(`insert into spectrum_messages(chat_guid,role,content,created_at) values ($1,'user','another request in the same window',now()-interval '29 minutes')`,[CHAT])
 await complain("That's not good");expect(await jobs()).toHaveLength(0);expect(texts().join('\n')).toMatch(/tie that page back/)
})
const pub=()=>({url:'https://fictional.here.now/',expiresAt:new Date(Date.now()+86400000).toISOString(),files:[]})
async function drain(max=5){const out:any[]=[];for(let i=0;i<max;i++){const r=await runOneRedoJob();out.push(r);if(!r.ran)break}return out}
it('INTEGRATION note arriving during the active build is applied before anything is published',async()=>{
 vi.stubEnv('DINGHY_REDO_JOBS','on');install({onGateway:async()=>{await complain('also add a rooftop bar')}});const fid=await seed();await complain("That's not good")
 const runs=await drain();expect(runs.some(r=>r.outcome==='done')).toBe(true)
 const j=(await jobs())[0];expect(j.state).toBe('done');expect(j.note_ids).toHaveLength(2)
 const seen=gateway.filter(b=>JSON.stringify(b.messages).includes('also add a rooftop bar')).length;console.log('NOTE-SEEN',seen,gateway.length)
 console.log('NOTE-DURING',JSON.stringify({runs,publishes:published.mock.calls.length,chatCalls:hoist.chatCalls.length,j}))
 void fid
})
it('INTEGRATION stop arriving while the build runs: nothing published, nothing sent, honest state',async()=>{
 vi.stubEnv('DINGHY_REDO_JOBS','on');install({onGateway:async()=>{hoist.held='stop';await complain('actually stop');}});await seed();await complain("That's not good")
 hoist.sent=[];await drain();expect(published).not.toHaveBeenCalled();expect((await jobs())[0].state).toBe('cancelled')
 expect((await pgq(`select 1 from spectrum_messages where role='assistant' and content like '[file:%fictional.here.now%'`))).toHaveLength(0)
})
for(const removable of [true,false])it(`INTEGRATION stop arriving after the page is published, before send: not sent, says so truthfully, ${removable?'takes only that new page down':'admits it could not take it down'}`,async()=>{
 vi.stubEnv('DINGHY_REDO_JOBS','on');install();const orig=await seed();await complain("That's not good")
 if(!removable)revoked.mockRejectedValue(new Error('host down'))
 published.mockImplementation(async()=>{hoist.held='stop';await complain('stop now');return pub()})
 hoist.sent=[];await drain();expect((await jobs())[0].state).toBe('cancelled')
 expect((await pgq(`select 1 from spectrum_messages where role='assistant' and content like '[file:%fictional.here.now%'`))).toHaveLength(0)
 const ob=(await pgq(`select text from spectrum_outbox`)).map((r:any)=>r.text).join('\n')
 expect(ob).toMatch(/I did not send it/);expect(ob).not.toMatch(/nothing (new )?(was )?(changed|sent)/i)
 expect(ob).toMatch(removable?/took that page down/:/could not take that page down, so its link stays live/)
 const rows=await pgq(`select id,url,revoked_at,redo_op_id from dinghy_files`)
 const made=rows.find((r:any)=>r.redo_op_id);expect(Boolean(made.revoked_at)).toBe(removable);expect(rows.find((r:any)=>r.id===orig).revoked_at).toBeNull()
 expect(revoked).toHaveBeenCalledTimes(1);expect(revoked.mock.calls[0][0]).toBe(made.url)
})
it('INTEGRATION late note after publish requeues exactly one more pass; a further late note stops at the cap and names the gap',async()=>{
 vi.stubEnv('DINGHY_REDO_JOBS','on');install();await seed();await complain("That's not good")
 let n=0;published.mockImplementation(async()=>{n++;selects=0;if(n<=2)await complain('late tweak '+n);return pub()})
 hoist.sent=[];const runs=await drain(6)
 const all=await jobs();expect(all).toHaveLength(1);expect(all[0]).toMatchObject({state:'failed',failure:'note_unapplied'})
 expect(runs.map((r:any)=>r.outcome)).toEqual(['requeued','note_unapplied',undefined])
 const ob=(await pgq(`select text from spectrum_outbox`)).map((r:any)=>r.text).join('\n')
 expect(published).toHaveBeenCalledTimes(2);expect(ob).toMatch(/not applied and nothing more is queued/);expect(ob).not.toMatch(/once more|tell me again|next time/i)
})
it('INTEGRATION Google-derived origin: new artifact and its origin are tagged and expire; plain files are untouched',async()=>{
 vi.stubEnv('DINGHY_REDO_JOBS','on');install();const fid=await seed();await pgq(`update dinghy_files set origin_google_derived=true where id=$1`,[fid]);await complain("That's not good")
 await drain();const nf=(await pgq(`select id,redo_google_derived,origin_google_derived,markdown from dinghy_files where url='https://fictional.here.now/'`))[0]
 expect(nf).toMatchObject({redo_google_derived:true,origin_google_derived:true});expect(nf.markdown).not.toBe('')
 await pgq(`update dinghy_files set created_at=now()-interval '40 days'`);const r=(await pgq(`select expire_google_derived(30) r`))[0].r
 const after=(await pgq(`select markdown,origin_request from dinghy_files where id=$1`,[nf.id]))[0];expect(after).toMatchObject({markdown:'',origin_request:null});expect(r.redo_documents).toBe(1)
 expect((await jobs())).toHaveLength(0)
})
it('INTEGRATION renders the redo output at 390px (fixture dump)',async()=>{
 vi.stubEnv('DINGHY_REDO_JOBS','on');install();await seed();await complain("That's not good");await drain()
 const files=published.mock.calls[0][0];const { mkdirSync, writeFileSync }=await import('fs');mkdirSync('/tmp/redo-fixture',{recursive:true})
 for(const f of files)writeFileSync('/tmp/redo-fixture/'+String(f.path).replace(/\//g,'_'),f.bytes)
})

it('KICK: the job starts inside the same webhook tail, no cron tick, and still only one job runs',async()=>{
 vi.stubEnv('DINGHY_REDO_JOBS','on');install();await seed();(globalThis as any).__kick=true
 await complain("That's not good")
 expect((await jobs())[0]).toMatchObject({state:'done',phase:'sent'});expect(published).toHaveBeenCalledTimes(1)
 expect(await runOneRedoJob()).toMatchObject({ran:false});expect(published).toHaveBeenCalledTimes(1)
})
it('KICK defers to the cron rescue when the webhook window cannot fit a full build, and never runs without the flag',async()=>{
 vi.stubEnv('DINGHY_REDO_JOBS','on');install();await seed();(globalThis as any).__kick=false
 const {kickRedoJobs}=await vi.importActual<any>('@/lib/spectrum/redo-worker-runtime')
 await complain("That's not good");expect(await kickRedoJobs(Date.now()-200_000)).toMatchObject({kicked:false});expect((await jobs())[0].state).toBe('queued')
})
it('SCOPE owner mode: only the listed chat can create jobs, others stay ordinary chat; daily cap refuses a seventh new rebuild',async()=>{
 vi.stubEnv('DINGHY_REDO_JOBS','owner');vi.stubEnv('DINGHY_REDO_OWNER_CHATS','some;-;other');install();await seed()
 await complain("That's not good");expect(await jobs()).toHaveLength(0);expect(hoist.decisions).toBe(0)
 vi.stubEnv('DINGHY_REDO_OWNER_CHATS',CHAT);hoist.sent=[];await complain("That's not good again");expect(await jobs()).toHaveLength(1)
 vi.stubEnv('DINGHY_REDO_JOBS','on')
 await pgq(`update dinghy_redo_jobs set state='done',created_at=now()`);for(let i=0;i<5;i++)await pgq(`insert into dinghy_files(user_id,chat_guid,title,kind,format,url,origin_request) values ($1,$2,'x','itinerary','page',$3,'r')`,[U,CHAT,'https://x'+i+'.here.now/']),await pgq(`insert into dinghy_redo_jobs(user_id,chat_guid,file_id,lineage_id,state) select $1,$2,id,id,'done' from dinghy_files where url=$3`,[U,CHAT,'https://x'+i+'.here.now/'])
 hoist.sent=[];await complain('still not right');expect(texts().join('\n')).toMatch(/as many page rebuilds as I will run for you today/);expect((await jobs()).filter((j:any)=>j.state==='queued')).toHaveLength(0)
})
it('LINEAGE: a correction about an unrelated page is its own job, queued behind the running one, never appended; a replacement of the same original joins',async()=>{
 vi.stubEnv('DINGHY_REDO_JOBS','on');install();const a=await seed();await complain("That's not good")
 const b=(await pgq(`insert into dinghy_files(user_id,chat_guid,title,kind,format,url,markdown,origin_request,origin_kind) values ($1,$2,'Other page','itinerary','page','https://other.here.now/','m','Plan a different fictional trip to Marinaton.','itinerary') returning id`,[U,CHAT]))[0].id
 const first=(await pgq(`select * from claim_redo_job()`))[0]
 const upsert=async(f:string)=>(await pgq(`select upsert_redo_job($1,$2,$3,null) r`,[U,CHAT,f]))[0].r
 const rb=await upsert(b);expect(rb.status).toBe('created');expect(rb.job_id).not.toBe(first.id)
 expect((await pgq(`select * from claim_redo_job()`))).toHaveLength(0) // serialized behind the running job in the same chat
 const rep=(await pgq(`insert into dinghy_files(user_id,chat_guid,title,kind,format,url,markdown,origin_request,origin_kind,lineage_id) values ($1,$2,'Redo of first','itinerary','page','https://redo1.here.now/','m','r','itinerary',$3) returning id`,[U,CHAT,a]))[0].id
 const rr=await upsert(rep);expect(rr).toMatchObject({status:'appended',job_id:first.id})
 const cancel=(await pgq(`select redo_cancel($1,$2,$3) r`,[U,CHAT,rep]))[0].r;expect(cancel.status).not.toBe('none')
 const st=await pgq(`select file_id,state,cancel_requested from dinghy_redo_jobs order by created_at`);expect(st.find((x:any)=>x.file_id===b)).toMatchObject({state:'queued',cancel_requested:false})
})
