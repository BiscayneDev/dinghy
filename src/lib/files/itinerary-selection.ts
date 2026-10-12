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
