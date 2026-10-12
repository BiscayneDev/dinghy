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
  // Hard evidence rule: the entry's own sentence must support the chosen kind. No hint or another kind is a rejection, never a relabel.
  if(m.hint!==kind){dropped.push(m.hint?'kind_conflict':'no_kind_evidence');continue}
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
 const order:Record<string,number>={hotel:0,restaurant:1,activity:2}
 return out.sort((x:any,y:any)=>order[x.kind]-order[y.kind])
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

import {SourceRecords as SR} from './source-records'
const normName=(t:string)=>t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()
/** The server cards are the only venue recommendations. Freehand body lines that name another venue-like entity
 * (own-name wording such as Hotel/Inn/Cafe/Museum) not among the picks and not in the user's own request are removed. */
const GENERIC_CAPS=new Set('monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december hotel restaurant dinner lunch breakfast brunch office visit working session sessions morning afternoon evening night day weekend check checkin arrival departure airport free time agenda plans plan optional weekend sightseeing activities activity option options not found notes summary overview schedule itinerary stay stays dining things to do see eat'.split(' '))
const wordsOf=(t:string)=>(t.toLowerCase().match(/[\p{L}][\p{L}'’]*/gu)||[])
/** The server cards are the only venue recommendations. A freehand body line that contains any capitalized proper-name word
 * (not sentence-initial, not from the user's request, not a pick, not a generic agenda word) is removed. Lines claiming that
 * no hotels/restaurants/activities are recommended are removed too: the server states real gaps itself. */
const UNIT_GENERIC=new Set('am pm et est edt local time times meeting meetings call team coffee flight arrival drive transfer rest wrap wrapup evening tonight lunch dinner breakfast brunch morning afternoon'.split(' '))
/** The server cards are the only venue recommendations. A freehand body line is removed when it names an unpicked proper noun
 * (a run of 2+ unfamiliar capitalized words, or one unfamiliar capitalized word mid-sentence), claims that no hotels/restaurants/activities
 * are recommended, or refers to a "recommended restaurant/hotel/activity" for a kind the server could not verify. Plain agenda text is kept. */
export function neutralizeUnpickedVenues(body:string,pickNames:string[],request:string,unsupported:string[]=[]):{body:string;removed:number}{
 const allowed=new Set<string>([...wordsOf(request),...pickNames.flatMap(wordsOf),...GENERIC_CAPS,...UNIT_GENERIC])
 const kindRe=unsupported.map(k=>k==='activity'?'activit(?:y|ies)':k==='restaurant'?'(?:restaurants?|dining|meals?)':'(?:hotels?|stays?|lodging)')
 const refRe=kindRe.length?new RegExp('\\b(?:recommended|suggested|selected|chosen|picked|our|the|these|those|following|below|top|best|great)\\s+(?:\\w+\\s+)?(?:'+kindRe.join('|')+')\\b','i'):null
 const headKinds=unsupported.map(k=>k==='activity'?'activit(?:y|ies)|things to do|events?|nightlife|sightseeing|evening':k==='restaurant'?'restaurants?|dining|dinner|lunch|brunch|breakfast|eats|food':'hotels?|stays?|lodging|accommodations?')
 const headRe=headKinds.length?new RegExp('\\b(?:'+headKinds.join('|')+')\\b','i'):null
 const reqLc=request.toLowerCase()
 const lines=body.split('\n'),keep:string[]=[];let removed=0,skipUnder=false
 for(const line of lines){
  const heading=/^\s*#/.test(line)
  if(!heading&&skipUnder){if(!line.trim()){keep.push(line)}else removed++;continue}
  if(heading)skipUnder=false
  if(!line.trim()){keep.push(line);continue}
  if(!heading&&kindRe.length&&/:\s*$/.test(line)&&new RegExp('\\b(?:'+kindRe.join('|')+')\\b','i').test(line)){removed++;skipUnder=true;continue}
  if(heading&&headRe&&headRe.test(line)&&!headRe.test(request)){removed++;skipUnder=true;continue}
  if(!heading&&/\b(?:weekend events?|local events?|events? (?:this|happening|nearby)|festivals?|concerts?|live music|happening (?:this|in))\b/i.test(line)&&!/\b(?:events?|festivals?|concerts?|live music)\b/.test(reqLc)){removed++;continue}
  if(/\b(?:no|not|none|zero)\b[^.\n]*\b(?:hotels?|restaurants?|dining|activities|venues?)\b[^.\n]*\b(?:recommend\w*|verified|found|available)\b/i.test(line)||/\b(?:no|not)\s+(?:\w+\s+){0,2}recommend\w*\b/i.test(line)||(refRe&&refRe.test(line))){removed++;continue}
  let bad=false,atStart=true,run=0
  for(const m of line.matchAll(/[\p{L}\d][\p{L}\d'’&.\-]*|[.!?:;,]/gu)){
   const w=m[0]
   if(/^[.!?:;]$/.test(w)){atStart=true;run=0;continue}
   if(w===','){run=0;continue}
   if(!/^\p{L}/u.test(w)){continue}
   const first=atStart&&!heading;atStart=false
   const cap=/^\p{Lu}/u.test(w)&&w.length>=3&&!first
   const unknown=cap&&!allowed.has(w.toLowerCase().replace(/['’]s$/,'').replace(/[.\-]+$/,''))
   if(unknown){run++;if(run>=2||w.length>=4)bad=true}else if(!cap)run=0
  }
  if(bad){removed++;if(heading)skipUnder=true}else keep.push(line)
 }
 const fin=cleanEmptyHeadings(keep);removed+=keep.length-fin.length
 return removed?{body:fin.join('\n'),removed}:{body,removed:0}
}
/** A heading with nothing left under it, and a line that ends in a colon with nothing after it, are dropped (repeat until stable). */
export function cleanEmptyHeadings(lines:string[]):string[]{
 let cur=lines
 for(let pass=0;pass<4;pass++){
 const keep=cur
 const depth=(l:string)=>/^\s*(#+)/.exec(l)?.[1].length??0
 const fin:string[]=[]
 for(let i=0;i<keep.length;i++){
  const d=depth(keep[i]);let j=i+1;while(j<keep.length&&!keep[j].trim())j++
  if(!d){
   if(!/^\s*:::/.test(keep[i])&&/[\p{L}\d][^:]*:\s*$/u.test(keep[i])&&(j>=keep.length||depth(keep[j]))){continue}
   fin.push(keep[i]);continue
  }
  if(j>=keep.length||(depth(keep[j])&&depth(keep[j])<=d)){continue}
  fin.push(keep[i])
 }
 if(fin.length===cur.length)return fin
 cur=fin
 }
 return cur
}
export function pickNameTexts(picks:Record<string,unknown>[],records:SR):string[]{
 return picks.flatMap((c:any)=>{const t=records.pageText(c.name.source);return t?[t.slice(c.name.start,c.name.end)]:[]})
   }

/** When the model body is stripped of its day plan, the server restates a plan only from facts it holds: the user's requested days and the verified picks. */
export function ensurePlanFromPicks(body:string,request:string,picks:{kind:string;name:string}[]):{body:string;added:number}{
 const content=body.split('\n').filter(l=>l.trim()&&!/^\s*(#|:::)/.test(l)&&!/^\s*\|/.test(l))
 if(content.length>=3||!picks.length)return {body,added:0}
 const days=[...new Set((request.match(/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi)||[]).map(d=>d[0].toUpperCase()+d.slice(1).toLowerCase()))]
 const by=(k:string)=>picks.filter(p=>p.kind===k).map(p=>p.name)
 const rows:string[]=[]
 const stay=by('hotel'),eat=by('restaurant'),do_=by('activity')
 if(stay.length)rows.push(`- Stay: ${stay.slice(0,2).join(' or ')}`)
 if(eat.length)rows.push(`- Eat: ${eat.slice(0,3).join(', ')}`)
 if(do_.length)rows.push(`- Do: ${do_.slice(0,3).join(', ')}`)
 if(!rows.length)return {body,added:0}
 rows.push(`- ${days.length?days.join(' / '):'Day'} timing for these is not set; pick from the cards below.`)
 const lines=body.split('\n'),h=lines.findIndex(l=>/^\s*#{2,3}\s+(?:day\s+\d|mon|tue|wed|thu|fri|sat|sun|\d{4}-\d{2}-\d{2}|stop\s+\d)/i.test(l))
 if(h>=0)lines.splice(h+1,0,...rows)
 else{const t=lines.findIndex(l=>/^\s*#\s/.test(l));lines.splice(t>=0?t+1:0,0,`## ${days[0]??'Day 1'}`,...rows)}
 return {body:lines.join('\n'),added:rows.length}
}
const TIME_RE=/\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b/gi
const LEAD_FILL=new Set(['plus','but','or','plan','make','with','then','and','include','including','add','also','a','an','the','my','our','on','friday','saturday','sunday','monday','tuesday','wednesday','thursday','to','for','by','at'])
/** User-supplied time-anchored agenda items (e.g. "office visit 10am") are facts the user gave; when the model's body drops one, the server restates it from the request text. */
export function ensureRequestAgenda(body:string,request:string):{body:string;added:number}{
 const items:{time:string;hour:string;mins:string;what:string}[]=[]
 for(const m of request.matchAll(TIME_RE)){
  const before=request.slice(0,m.index).replace(/\s+$/,'').replace(/\b(?:at|@|by|from)$/i,'').replace(/\s+$/,'')
  const words=(before.split(/[.;:!?\n,]/).pop()||'').trim().split(/\s+/).filter(Boolean).slice(-4)
  while(words.length&&LEAD_FILL.has(words[0].toLowerCase()))words.shift()
  while(words.length&&LEAD_FILL.has(words[words.length-1].toLowerCase()))words.pop()
  const what=words.join(' ')
  if(what.length>=3)items.push({time:`${m[1]}${m[2]?':'+m[2]:''}${m[3].toLowerCase()}`,hour:m[1],mins:m[2]??'00',what})
 }
 const add:string[]=[]
 for(const it of items){
  const tre=new RegExp('\\b0?'+it.hour+'(?::'+it.mins+')?\\s?(?:am|pm)?\\b','i'),wds=it.what.toLowerCase().split(/\s+/).filter(w=>w.length>=3)
  const present=body.split('\n').some(l=>tre.test(l)&&wds.some(w=>l.toLowerCase().includes(w)))
  if(!present)add.push(`- ${it.time}: ${it.what}`)
 }
 if(!add.length)return {body,added:0}
 const lines=body.split('\n'),h=lines.findIndex(l=>/^\s*#/.test(l))
 lines.splice(h>=0?h+1:0,0,...add)
 return {body:lines.join('\n'),added:add.length}
   }
