import * as React from 'react'
;(globalThis as unknown as {React:unknown}).React=React
import {afterEach,expect,it,vi} from 'vitest'
const {published}=vi.hoisted(()=>({published:vi.fn()}))
vi.mock('@/lib/files/share',()=>({shareEnabled:()=>true,publishSite:published,revokeSite:vi.fn(),updateSite:vi.fn()}))
vi.mock('@/lib/files/imagery',async orig=>({...await orig<typeof import('@/lib/files/imagery')>(),verifyShareMetadata:async()=>true}))
vi.mock('@/lib/supabase/server',()=>({createServerClient:()=>({})}))
vi.mock('@/lib/data-portability/erasure-state',()=>({assertAccountActive:async()=>{}}))
import {toolsFor} from '@/lib/spectrum/imessage-tools'
import {gateTools} from '@/lib/spectrum/tool-gating'
import {chatWithTools} from '@/lib/spectrum/dinghy'
import {fileToolsFor} from '@/lib/files/tool'
import {writeFile,mkdir} from 'node:fs/promises'
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.clearAllMocks()})
it('full production composition binds omitted tokens, validates shape, renders HTML/PDF/localcard and queues one file without sends',async()=>{
 vi.stubEnv('TAVILY_API_KEY','fictional-key')
 const url='https://harbor.test/visitors'
 const ask='Make an itinerary for fictional founders visiting Harbor on Friday. Office visit10am then working sessions, hotel and restaurant recommendations and weekend activities.'
 const body='## Friday\n- 10:00 User supplied office visit.\n- Working sessions: venue and duration to confirm.\n## Weekend\n:::stay\nHarbor Inn | unknown | unknown | Harbor | availability unverified | | '+url+'\n:::\n:::options\nHarbor Cafe | unknown | source listed dining | hours unknown '+url+'\nHarbor Museum | unknown | source listed activity | tickets unknown '+url+'\n:::\n:::sources\nHarbor guide | '+url+' | date unknown\n:::'
 const ctx={userId:'',telegramId:0,telegramChatId:0,name:'Synthetic test',timezone:'UTC',tokens:{}}
 const files=fileToolsFor(),stages:string[]=[],requests:any[]=[]
 published.mockResolvedValue({url:'https://fictional-pipeline.here.now/',slug:'fictional-pipeline',expiresAt:'2030-06-11T00:00:00Z'})
 vi.stubGlobal('fetch',vi.fn(async(u,init)=>{
  if(String(u)==='https://api.tavily.com/search')return new Response(JSON.stringify({results:[{title:'Harbor public visitors',url,content:'Hotel, dining and museum public listings.'}]}))
  if(String(u)===url)return new Response('<html><title>Harbor public visitors</title><body>Harbor Inn. Harbor Cafe. Harbor Museum. Hours, prices and availability unverified.</body></html>')
  requests.push(JSON.parse(init.body))
  const name=requests.length===1?'web_search':'create_file',args=name==='web_search'?{query:'Harbor official visitor listings'}:{title:'Synthetic Harbor founders itinerary',body,format:'pdf',kind:'itinerary'}
  return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:String(requests.length),function:{name,arguments:JSON.stringify(args)}}]}}]}))
 }))
 const tools=gateTools([...toolsFor(ctx),...files.tools],[ask]).active
 const result=await chatWithTools([{role:'user',content:ask}],{gatewayUrl:'https://gateway.test',apiKey:'fictional',model:'auto',deadlineAt:Date.now()+60000,onStage:async(_s,d)=>{if(d)stages.push(d)}},tools,ctx)
 expect(result.deliverable?.state).toBe('completed');expect(published).toHaveBeenCalledTimes(1);expect(files.files()).toHaveLength(1);expect(requests).toHaveLength(2)
 expect(stages).toContain('research:read_ok');expect(stages).toContain('binding:observed_links');expect(stages.some(s=>s.startsWith('invalid:'))).toBe(false)
 const made=files.files()[0];expect(made.bytes.subarray(0,4).toString()).toBe('%PDF');expect(made.card?.subarray(1,4).toString()).toBe('PNG');expect(made.markdown).toContain('Source provenance');expect(made.markdown).not.toContain('{{source:')
 const html=published.mock.calls[0][0].find((f:any)=>f.path==='index.html').bytes.toString();expect(html).toContain('hero-title');expect(html).toContain('Harbor Inn')
 await mkdir('/tmp/itinerary-pipeline-proof',{recursive:true});await writeFile('/tmp/itinerary-pipeline-proof/page.html',html);await writeFile('/tmp/itinerary-pipeline-proof/file.pdf',made.bytes);await writeFile('/tmp/itinerary-pipeline-proof/card.png',made.card!);await writeFile('/tmp/itinerary-pipeline-proof/report.json',JSON.stringify({synthetic:true,noSend:true,stages,completed:true,httpMocked:true,publishMocked:true,files:1},null,2))
})
