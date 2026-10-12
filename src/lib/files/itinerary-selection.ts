import {compileItineraryCandidates,itineraryCandidateErrorCode} from './itinerary-candidates'
import type {SourceRecords} from './source-records'
/** Selection is its own forced, single-purpose tool call. The server keeps the
 * validated picks and injects them into create_file, so the file call cannot drop
 * them. Models still choose (names/kinds/reasons); the server owns the structure. */
export const SELECT_CANDIDATES_TOOL='select_itinerary_candidates'
const FACTS=['name','price','rating','area']
const GROUP_LIMITS={hotel:6,restaurant:5,activity:5}
export const SELECT_CANDIDATES_NOTE='Select the hotel, restaurant and activity recommendations for this itinerary from the page reads already returned. One call, no other arguments. Each candidate: kind (hotel|restaurant|activity), name = exact complete venue-name excerpt copied from a page-read source_records content, reason and catch in your own words. Optional price/rating/area (hotel only for rating/area) only when a page states them; otherwise omit. Never use search snippets or page titles, never invent a venue, never guess kind. Pick 1-3 per kind the pages support.'
export function selectionToolDef(pageIds:string[]){
 const ref=(d:string)=>({type:'object',required:['source','excerpt'],additionalProperties:false,properties:{source:{type:'string',enum:pageIds,description:'Successful page-read ID'},excerpt:{type:'string',minLength:1,maxLength:500,description:d}}})
 return {type:'function' as const,function:{name:SELECT_CANDIDATES_TOOL,description:SELECT_CANDIDATES_NOTE,parameters:{type:'object',required:['candidates'],additionalProperties:false,properties:{candidates:{type:'array',minItems:1,maxItems:12,items:{type:'object',required:['kind','name','reason','catch'],additionalProperties:false,properties:{kind:{type:'string',enum:['hotel','restaurant','activity']},name:ref('Exact venue name as written in the page content'),reason:{type:'string',maxLength:300},catch:{type:'string',maxLength:300},price:ref('Exact price text from the page'),rating:ref('Exact rating text from the page (hotel only)'),area:ref('Exact area text from the page (hotel only)')}}}}}}}
}
const norm=(s:string)=>s.replace(/\s+/g,' ').trim()
/** Snap an excerpt to its literal page text when only whitespace/case differ. Never fuzzy beyond that. */
function snap(records:SourceRecords,ref:any){
 if(!ref||typeof ref!=='object'||typeof ref.excerpt!=='string'||typeof ref.source!=='string')return ref
 const located=records.locate(ref.source,ref.excerpt)
 if(!('error' in located))return {source:ref.source,field:'content',excerpt:ref.excerpt}
 const text=records.pageText(ref.source);if(text===null)return ref
 const want=norm(ref.excerpt);if(!want)return ref
 const pattern=want.split(' ').map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\s+')
 const m=new RegExp(pattern,'i').exec(text)
 return m?{source:ref.source,field:'content',excerpt:m[0]}:ref
}
export type Selection={candidates:Record<string,unknown>[];dropped:string[]}
/** Per-candidate validation: valid picks are kept, invalid ones are dropped with a finite code. */
export function compileSelection(input:unknown,records:SourceRecords):Selection|{error:string;dropped:string[]}{
 const list=input&&typeof input==='object'?(input as {candidates?:unknown}).candidates:undefined
 if(!Array.isArray(list)||!list.length)return {error:'Supply candidates: at least one explicit typed candidate.',dropped:['empty']}
 const kept:Record<string,unknown>[]=[],dropped:string[]=[],counts={hotel:0,restaurant:0,activity:0}
 for(const raw of list.slice(0,12)){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)){dropped.push('candidate_type');continue}
  const c:Record<string,unknown>={...(raw as Record<string,unknown>)}
  for(const k of FACTS)if(c[k]!==undefined)c[k]=snap(records,c[k])
  const r=compileItineraryCandidates({body:'x',itinerary_candidates:[c]},records)
  if('error' in r){dropped.push(itineraryCandidateErrorCode(r.error));continue}
  const kind=c.kind as keyof typeof counts
  if(counts[kind]>=GROUP_LIMITS[kind]){dropped.push('group_limit');continue}
  counts[kind]++;kept.push(c)
 }
 if(!kept.length)return {error:'No candidate was valid: each name must be an exact venue-name excerpt from a successful page read (page IDs: '+records.pageIds().join(', ')+'). Reasons dropped: '+[...new Set(dropped)].join(', '),dropped}
 return {candidates:kept,dropped}
}
export function injectCandidates(input:unknown,candidates:unknown[]):unknown{
 if(!input||typeof input!=='object')return input
 return {...(input as Record<string,unknown>),itinerary_candidates:candidates}
}

import type {Mention} from './itinerary-mentions'
/** Id-only selection: the model picks mention ids and kinds; the server owns every excerpt and offset. */
export function mentionToolDef(menuIds:string[]){
 return {type:'function' as const,function:{name:SELECT_CANDIDATES_TOOL,description:'Select hotel, restaurant and activity recommendations for this itinerary. Pick mention ids ONLY from the server menu in the system message; never type venue names. Each candidate: kind (hotel|restaurant|activity) chosen from the mention context, id, reason and catch in your own words. Pick 1-3 per kind the pages support; skip anything the context does not support as that kind.',parameters:{type:'object',required:['candidates'],additionalProperties:false,properties:{candidates:{type:'array',minItems:1,maxItems:12,items:{type:'object',required:['kind','id','reason','catch'],additionalProperties:false,properties:{kind:{type:'string',enum:['hotel','restaurant','activity']},id:{type:'string',enum:menuIds},reason:{type:'string',maxLength:300},catch:{type:'string',maxLength:300}}}}}}}}
}
export function compileMentionSelection(input:unknown,menu:Mention[],records:SourceRecords):Selection|{error:string;dropped:string[]}{
 const list=input&&typeof input==='object'?(input as {candidates?:unknown}).candidates:undefined
 if(!Array.isArray(list)||!list.length)return {error:'Supply candidates: at least one {kind,id,reason,catch} using ids from the menu.',dropped:['empty']}
 const pickedIds=new Set(list.flatMap((x:any)=>x&&typeof x.id==='string'?[x.id]:[])),byId=new Map(menu.map(m=>[m.id,m])),seen=new Set<string>(),kept:Record<string,unknown>[]=[],dropped:string[]=[],counts={hotel:0,restaurant:0,activity:0}
 for(const raw of list.slice(0,12)){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)){dropped.push('candidate_type');continue}
  const r=raw as Record<string,unknown>,m=typeof r.id==='string'?byId.get(r.id):undefined
  if(!m){dropped.push('unknown_id');continue}
  if(seen.has(m.id)){dropped.push('duplicate');continue}
  const kind=r.kind
  if(kind!=='hotel'&&kind!=='restaurant'&&kind!=='activity'){dropped.push('kind');continue}
  // Soft kind check: a strong wording hint for another kind is a veto only while the menu still has unpicked mentions hinted as the requested kind.
  if(m.hint&&m.hint!==kind&&menu.some(x=>x.hint===kind&&!pickedIds.has(x.id))){dropped.push('kind_conflict');continue}
  const c:Record<string,unknown>={kind,name:{source:m.source,field:'content',start:m.start,end:m.end},reason:typeof r.reason==='string'?r.reason.slice(0,300):'unknown',catch:typeof r.catch==='string'?r.catch.slice(0,300):'unknown'}
  const out=compileItineraryCandidates({body:'x',itinerary_candidates:[c]},records)
  if('error' in out){dropped.push(itineraryCandidateErrorCode(out.error));continue}
  if(counts[kind]>=GROUP_LIMITS[kind]){dropped.push('group_limit');continue}
  counts[kind]++;seen.add(m.id);kept.push(c)
 }
 if(!kept.length)return {error:'No valid candidate. Use ids exactly as listed in the menu, with kind chosen from the context; when a menu hint names another kind, choose a hinted mention of the requested kind instead. Dropped: '+[...new Set(dropped)].join(', '),dropped}
 return {candidates:kept,dropped}
}

/** Kinds the user's request actually asks for; the renderer contract needs rows for each. */
export function requiredKinds(request:string):('hotel'|'restaurant'|'activity')[]{
 const k:('hotel'|'restaurant'|'activity')[]=[]
 if(/\b(?:hotels?|places? to stay)\b/i.test(request))k.push('hotel')
 if(/\brestaurants?\b/i.test(request))k.push('restaurant')
 if(/\b(?:activities|things to do|fun things)\b/i.test(request))k.push('activity')
 return k
}
export const missingKinds=(cands:Record<string,unknown>[],need:string[])=>need.filter(k=>!cands.some(c=>c.kind===k))
/** Accumulate picks across select calls; same mention is never added twice; group limits hold. */
export function mergePicks(prior:Record<string,unknown>[],next:Record<string,unknown>[]):Record<string,unknown>[]{
 const out=[...prior],key=(c:any)=>`${c.name.source}:${c.name.start}`,seen=new Set(out.map(key)),counts:Record<string,number>={hotel:0,restaurant:0,activity:0}
 for(const c of out)counts[c.kind as string]++
 for(const c of next){if(seen.has(key(c))||counts[c.kind as string]>=GROUP_LIMITS[c.kind as keyof typeof GROUP_LIMITS])continue;seen.add(key(c));counts[c.kind as string]++;out.push(c)}
 return out
}
/** When the sources genuinely lack a requested kind, the contract must not demand rows for it (the page says so honestly instead). */
export function relaxedContract<T extends {request:string}|null>(c:T,unsupported:string[]):T{
 if(!c||!unsupported.length)return c
 let r=c.request
 if(unsupported.includes('hotel'))r=r.replace(/\b(?:hotels?|places? to stay)\b/gi,'lodging')
 if(unsupported.includes('restaurant'))r=r.replace(/\brestaurants?\b/gi,'meals')
 if(unsupported.includes('activity'))r=r.replace(/\b(?:activities|things to do|fun things)\b/gi,'plans')
 return {...c,request:r+' recommendations'}
   }

import {extractMentions,placeWordsFrom} from './itinerary-mentions'
import {SourceRecords as SR} from './source-records'
const normName=(t:string)=>t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()
/** The server cards are the only venue recommendations. Freehand body lines that name another venue-like entity
 * (own-name wording such as Hotel/Inn/Cafe/Museum) not among the picks and not in the user's own request are removed. */
export function neutralizeUnpickedVenues(body:string,pickNames:string[],request:string):{body:string;removed:number}{
 const tmp=new SR();tmp.capture('web_fetch',{url:'https://body.invalid/agenda',title:null,content:body},'1970-01-01T00:00:00Z')
 const picks=pickNames.map(normName).filter(Boolean),req=normName(request)
 const bad=new Set<number>()
 const lines=body.split('\n'),starts:number[]=[];let pos=0;for(const l of lines){starts.push(pos);pos+=l.length+1}
 for(const m of extractMentions(tmp,300,[],{evidence:false,placeWords:placeWordsFrom(request)})){
  const n=normName(m.text)
  if(!n||req.includes(n)||picks.some(p=>p.includes(n)||n.includes(p)))continue
  let li=0;while(li+1<lines.length&&starts[li+1]<=m.start)li++
  if(!m.text.includes(' ')&&!lines[li].slice(0,m.start-starts[li]).replace(/[\s#>*•\-\d:.)]|\b[ap]m\b/gi,''))continue
  if(!/^\s*#/.test(lines[li]))bad.add(li)
 }
 if(!bad.size)return {body,removed:0}
 return {body:lines.filter((_,i)=>!bad.has(i)).join('\n'),removed:bad.size}
}
export function pickNameTexts(picks:Record<string,unknown>[],records:SR):string[]{
 return picks.flatMap((c:any)=>{const t=records.pageText(c.name.source);return t?[t.slice(c.name.start,c.name.end)]:[]})
   }
