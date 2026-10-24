/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Offline full-path proof for owner-scoped Jev UI rollout (#330 readiness).
 * Drives the real chatWithTools loop with a mocked gateway/decisions endpoint,
 * captures the create_file document the loop settles on, then runs the SAME
 * validation + renderHtml the production host() path uses (files/tool.ts) and
 * writes the exact index.html bytes to PROOF_DIR for pixel inspection.
 * Fictional fixtures only. No network, no paid calls, no flag changes.
 */
import {afterEach,describe,it,expect,vi} from 'vitest'
import {mkdtempSync,writeFileSync,mkdirSync} from 'fs'
import {parseFileInput} from '@/lib/files/tool'
import {renderHtml} from '@/lib/files/render'
import {chatWithTools} from '@/lib/spectrum/dinghy'

const OWNER='+12035168398'
const OUT=process.env.PROOF_DIR??'/tmp/jev-proof'
mkdirSync(OUT,{recursive:true})
const ctx={userId:'fictional-u',telegramId:0,telegramChatId:0,name:'Example',timezone:'UTC',tokens:{}}
const options={gatewayUrl:'https://gateway.test',apiKey:'fictional',model:'test',deliverable:null}
const answer=(choice:string)=>({model:'jev-latest',provider:'typesafe',answers:{ui:{type:'choice',choice,confidence:0.96,probabilities:{[choice]:0.96}}}})

interface Capture{stages:string[];decisionCalls:number;chatBodies:any[];generatedUiAuthorized?:boolean;doc?:{title:string;body:string};htmlPath?:string}
function captureTool(cap:Capture){
 return {name:'create_file',description:'capturing create_file running real validation+render',inputSchema:{type:'object'},execute:async(input:unknown,ectx:unknown)=>{
  const i=input as {title?:string;body?:string}
  const parsed=parseFileInput({title:i.title,body:i.body})
  if('error'in parsed)return {success:false,error:parsed.error}
  cap.generatedUiAuthorized=Boolean((ectx as any)?.generatedUiAuthorized)
  cap.doc=parsed.doc
  const html=renderHtml(parsed.doc)
  const name=cap.doc!.title.toLowerCase().replace(/[^a-z0-9]+/g,'-')
  cap.htmlPath=`${OUT}/${name}.html`
  writeFileSync(cap.htmlPath,html)
  return {success:true,data:{status:'rendered_offline',path:cap.htmlPath}}
 }}
}
const stop=(content:string)=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content}}]}))
const toolCall=(name:string,args:object,id='c1')=>new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id,function:{name,arguments:JSON.stringify(args)}}]}}]}))
function recorder(cap:Capture){return async(stage:unknown,detail:unknown)=>{cap.stages.push(String(stage)+':'+String(detail??''))}}

afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()})

describe('full-path proof: owner-scoped Jev UI',()=>{
 it('catalogue decision renders the selected interactive component end to end',async()=>{
  vi.stubEnv('DINGHY_JEV_UI',OWNER)
  const cap:Capture={stages:[],decisionCalls:0,chatBodies:[]}
  let chat=0
  const checklist={version:1,components:[{id:'pack',type:'checklist',title:'Fictional harbor weekend packing',rows:[{id:'a',label:'Fictional rain shell',detail:'Harbor drizzle is common in this made-up example'},{id:'b',label:'Fictional deck shoes',detail:'Boat decks are slippery'},{id:'c',label:'Fictional charger',detail:'Long days out'}]}]}
  vi.stubGlobal('fetch',vi.fn(async(url:string,opts?:RequestInit)=>{
   const u=String(url);const b=opts?.body?JSON.parse(opts.body as string):{}
   if(u.endsWith('/v1/decisions')){cap.decisionCalls++;return new Response(JSON.stringify(answer('checklist')))}
   cap.chatBodies.push(b)
   if(chat++===0)return toolCall('create_file',{title:'Fictional Harbor Weekend Packing',body:':::pages\n'+JSON.stringify(checklist)+'\n:::'})
   return stop('Your fictional packing page is ready.')
  }))
  const r=await chatWithTools([{role:'user',content:'make me a fictional packing page'}],{...options,sender:OWNER,onStage:recorder(cap)},[captureTool(cap) as never],ctx)
  expect(r.reply).toContain('packing')
  expect(cap.decisionCalls).toBe(1)
  expect(cap.stages).toContain('context:ui:jev:catalogue:checklist')
  expect(JSON.stringify(cap.chatBodies[0]?.tools??[])).not.toContain('generate_ui')
  expect(cap.generatedUiAuthorized).toBe(false)
  expect(cap.htmlPath).toBeTruthy()
  writeFileSync(`${OUT}/s1-catalogue-trail.json`,JSON.stringify(cap.stages,null,2))
 })
 it('generate decision offers generate_ui, then publishes the exact generated block rendered by the real renderer',async()=>{
  vi.stubEnv('DINGHY_JEV_UI',OWNER)
  const cap:Capture={stages:[],decisionCalls:0,chatBodies:[]}
  const gen={version:1,title:'Fictional fuel splitter',fallback:'Illustrative example only: a fictional 200-mile trip at 25 mpg and $4.00/gal costs $32.00 total; split across the fictional party size entered.',controls:[{id:'people',label:'Fictional travelers',type:'number',value:'4'}],code:'var total=200/25*4.0;var n=Math.max(1,Number(values.people)||1);var each=total/n;var pct=Math.min(100,Math.round(each/32*100));return "<h3>Fictional split</h3><p>Total $"+total.toFixed(2)+"; each pays $"+each.toFixed(2)+" across "+n+" fictional travelers.</p><div style=\'background:#eee;width:200px\'><div style=\'background:#e76f51;height:12px;width:"+pct+"%\'></div></div>"'}
  let chat=0;let generatedBody=''
  vi.stubGlobal('fetch',vi.fn(async(url:string,opts?:RequestInit)=>{
   const u=String(url);const b=opts?.body?JSON.parse(opts.body as string):{}
   if(u.endsWith('/v1/decisions')){cap.decisionCalls++;return new Response(JSON.stringify(answer('generate')))}
   for(const m of b.messages??[]){if(m.role==='tool'){try{const v=JSON.parse(m.content);if(v.body)generatedBody=v.body}catch{}}}
   if(b.response_format)return new Response(JSON.stringify({model:'coding-fictional',choices:[{message:{content:JSON.stringify(gen)}}]}))
   cap.chatBodies.push(b)
   if(chat===0){chat++;return toolCall('generate_ui',{brief:'fictional fuel cost splitter with party size',facts:'Fictional example data: 200 miles, 25 mpg, $4.00/gal.'},'g1')}
   if(chat===1){chat++;return toolCall('create_file',{title:'Fictional Fuel Splitter',body:generatedBody},'c2')}
   return stop('Your fictional splitter page is ready.')
  }))
  const r=await chatWithTools([{role:'user',content:'build a fictional fuel cost splitter'}],{...options,sender:OWNER,onStage:recorder(cap)},[captureTool(cap) as never],ctx)
  expect(r.reply).toContain('splitter')
  expect(cap.decisionCalls).toBe(1)
  expect(cap.stages).toContain('context:ui:jev:generate')
  expect(JSON.stringify(cap.chatBodies[0]?.tools??[])).toContain('generate_ui')
  expect(cap.generatedUiAuthorized).toBe(true)
  expect(cap.doc?.body).toContain(':::pages')
  expect(cap.doc?.body).toContain('generated')
  writeFileSync(`${OUT}/s2-generate-trail.json`,JSON.stringify(cap.stages,null,2))
 })
 it('decision outage degrades to the legacy path and never claims a Jev selection',async()=>{
  vi.stubEnv('DINGHY_JEV_UI',OWNER)
  const cap:Capture={stages:[],decisionCalls:0,chatBodies:[]}
  vi.stubGlobal('fetch',vi.fn(async(url:string,opts?:RequestInit)=>{
   const u=String(url)
   if(u.endsWith('/v1/decisions')){cap.decisionCalls++;return new Response('down',{status:500})}
   if(opts?.body)cap.chatBodies.push(JSON.parse(opts.body as string))
   return stop('A plain fictional answer.')
  }))
  const execute=vi.fn(async()=>({success:true,data:{}}))
  const r=await chatWithTools([{role:'user',content:'hello'}],{...options,sender:OWNER,onStage:recorder(cap)},[{name:'create_file',description:'t',inputSchema:{},execute} as never],ctx)
  expect(r.reply).toBe('A plain fictional answer.')
  expect(cap.decisionCalls).toBe(1)
  expect(cap.stages).toContain('context:ui:jev:unavailable')
  expect(r.reply).not.toMatch(/jev|selected|catalogue|generated/i)
  for(const b of cap.chatBodies)expect(JSON.stringify(b.tools??[])).not.toContain('generate_ui')
  writeFileSync(`${OUT}/s3-outage-trail.json`,JSON.stringify({stages:cap.stages,decisionCalls:cap.decisionCalls},null,2))
 })
 it('sender outside the allowlist never reaches the decision endpoint',async()=>{
  vi.stubEnv('DINGHY_JEV_UI','+19995550000')
  const cap:Capture={stages:[],decisionCalls:0,chatBodies:[]}
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
   if(String(url).endsWith('/v1/decisions'))cap.decisionCalls++
   return stop('A plain fictional answer.')
  }))
  const r=await chatWithTools([{role:'user',content:'hello'}],{...options,sender:OWNER,onStage:recorder(cap)},[{name:'create_file',description:'t',inputSchema:{},execute:vi.fn()} as never],ctx)
  expect(r.reply).toBe('A plain fictional answer.')
  expect(cap.decisionCalls).toBe(0)
  expect(cap.stages.join('|')).not.toContain('ui:jev')
  writeFileSync(`${OUT}/s4-nonallowlisted-trail.json`,JSON.stringify({stages:cap.stages,decisionCalls:cap.decisionCalls},null,2))
 })
 it('flag absent (current production state) never reaches the decision endpoint',async()=>{
  const cap:Capture={stages:[],decisionCalls:0,chatBodies:[]}
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
   if(String(url).endsWith('/v1/decisions'))cap.decisionCalls++
   return stop('A plain fictional answer.')
  }))
  const r=await chatWithTools([{role:'user',content:'hello'}],{...options,sender:OWNER,onStage:recorder(cap)},[{name:'create_file',description:'t',inputSchema:{},execute:vi.fn()} as never],ctx)
  expect(r.reply).toBe('A plain fictional answer.')
  expect(cap.decisionCalls).toBe(0)
  writeFileSync(`${OUT}/s5-flag-absent-trail.json`,JSON.stringify({stages:cap.stages,decisionCalls:cap.decisionCalls},null,2))
 })
})

