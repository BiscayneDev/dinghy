import type {SourceRecords} from './source-records'
import {compileItineraryCandidates,itineraryCandidateErrorCode} from './itinerary-candidates'
import {isHubUrl,isNonVenueName,isCategoryPhrase,placeWordsFrom} from './itinerary-mentions'
import {SELECT_CANDIDATES_TOOL} from './itinerary-selection'
type Kind='hotel'|'restaurant'|'activity'
const GROUP_LIMITS={hotel:6,restaurant:5,activity:5}
const NAV=/^(?:home|about(?: us)?|contact(?: us)?|menu|sign ?in|log ?in|search|cart|book now|privacy policy|terms(?: of use)?|cookies?|skip to content|subscribe|follow us|share|read more|next|previous)$/i

/** A clean, bounded view of each usable page: headings, list items and the opening of each paragraph, so the model sees the venue text itself. */
export function buildPageView(records:SourceRecords,perPage=4500,total=13000):{text:string;lines:number;pages:number}{
 const out:string[]=[];let used=0,lines=0,pages=0
 for(const id of records.pageIds()){
  if(isHubUrl(records.pageUrl(id)))continue
  const text=records.pageText(id)||'',kept:string[]=[];let size=0
  for(const raw of text.split('\n')){
   const line=raw.replace(/^[\s#>*•\-\d.)]+/,'').replace(/\s+/g,' ').trim()
   if(line.length<8||line.split(' ').length<2||NAV.test(line))continue
   for(const sent of line.split(/(?<=[.!?])\s+/)){
    const l=sent.slice(0,260)
    if(l.length<8||l.split(' ').length<2)continue
    if(size+l.length>perPage||used+size+l.length>total)break
    kept.push(l);size+=l.length+1
   }
  }
  if(kept.length>=1){pages++;lines+=kept.length;used+=size;out.push(`--- page ${pages} ---\n`+kept.join('\n'))}
  if(used>=total)break
 }
 return {text:out.join('\n'),lines,pages}
}
export function viewNote(v:{text:string}):string{
 return 'Pages read from the web (headings, list items and opening lines). Name specific hotels, restaurants and attractions that appear in them. For each, give kind, the exact name as written, and a short exact quote (about 20 to 200 characters) copied from the page that contains the name and shows what it is. Do not name cities, countries, neighborhoods, websites, meals or categories. Do not use names from memory.\n\n'+v.text
}
export function quoteToolDef(){
 return {type:'function' as const,function:{name:SELECT_CANDIDATES_TOOL,description:'Select hotel, restaurant and activity recommendations for this itinerary from the page text shown. Each candidate: kind (hotel|restaurant|activity), name (exactly as written on the page), quote (exact short passage from the page that contains the name and shows it is that kind of venue). The server checks every name and quote against the stored pages.',parameters:{type:'object',additionalProperties:false,properties:{candidates:{type:'array',minItems:1,maxItems:12,items:{type:'object',additionalProperties:false,properties:{kind:{type:'string',enum:['hotel','restaurant','activity']},name:{type:'string',maxLength:80},quote:{type:'string',maxLength:320}},required:['kind','name','quote']}}},required:['candidates']}}}
}
const norm=(t:string)=>t.replace(/\s+/g,' ').trim()
function locate(records:SourceRecords,quote:string):{source:string;start:number;end:number}|null{
 const q=norm(quote);if(q.length<20)return null
 const re=new RegExp(q.split(' ').map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\s+'))
 for(const id of records.pageIds()){
  if(isHubUrl(records.pageUrl(id)))continue
  const t=records.pageText(id)||'',m=re.exec(t)
  if(m)return {source:id,start:m.index,end:m.index+m[0].length}
 }
 return null
}
export type Verify=(name:string,kind:Kind,quote:string)=>Promise<boolean>
/** Mechanical checks (literal quote, name inside the quote, not a brand/place/category) then one bounded yes/no verification per pick. */
export async function compileQuoteSelection(input:unknown,records:SourceRecords,request:string,verify:Verify):Promise<{candidates:Record<string,unknown>[];dropped:string[]}|{error:string;dropped:string[]}>{
 const list=input&&typeof input==='object'?(input as {candidates?:unknown}).candidates:undefined
 if(!Array.isArray(list)||!list.length)return {error:'Supply candidates: at least one {kind,name,quote} copied from the page text.',dropped:['empty']}
 const place=placeWordsFrom(request),dropped:string[]=[],pending:{kind:Kind;c:Record<string,unknown>;name:string;quote:string}[]=[],seen=new Set<string>()
 for(const raw of list.slice(0,12)){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)){dropped.push('candidate_type');continue}
  const r=raw as Record<string,unknown>,kind=r.kind
  if(kind!=='hotel'&&kind!=='restaurant'&&kind!=='activity'){dropped.push('kind');continue}
  const name=typeof r.name==='string'?norm(r.name):'',quote=typeof r.quote==='string'?norm(r.quote):''
  if(name.length<3||name.length>80){dropped.push('name');continue}
  const loc=locate(records,quote);if(!loc){dropped.push('quote_not_on_page');continue}
  const text=records.pageText(loc.source)!,slice=text.slice(loc.start,loc.end),at=slice.indexOf(name)
  if(at<0){dropped.push('name_not_in_quote');continue}
  const ws=name.toLowerCase().split(/[^\p{L}'’]+/u).filter(Boolean)
  if(isNonVenueName(name)||isCategoryPhrase(name.split(/\s+/))||(ws.length&&ws.every(w=>place.has(w)))){dropped.push('not_a_venue_name');continue}
  const key=name.toLowerCase()+'|'+kind;if(seen.has(key)){dropped.push('duplicate');continue}
  seen.add(key)
  const start=loc.start+at
  const c:Record<string,unknown>={kind,name:{source:loc.source,field:'content',start,end:start+name.length},reason:quote.slice(0,300),catch:'Hours, prices and availability unverified'}
  const out=compileItineraryCandidates({body:'x',itinerary_candidates:[c]},records)
  if('error' in out){dropped.push(itineraryCandidateErrorCode(out.error));continue}
  pending.push({kind,c,name,quote})
 }
 const verdicts=await Promise.all(pending.map(p=>verify(p.name,p.kind,p.quote).catch(()=>false)))
 const kept:Record<string,unknown>[]=[],counts={hotel:0,restaurant:0,activity:0}
 pending.forEach((p,i)=>{if(!verdicts[i]){dropped.push('not_verified');return};if(counts[p.kind]>=GROUP_LIMITS[p.kind]){dropped.push('group_limit');return};counts[p.kind]++;kept.push(p.c)})
 if(!kept.length)return {error:'No valid candidate. Copy the name and a short exact quote from the page text; the quote must contain the name and show it is that kind of venue (not a city, site, meal or category). Dropped: '+[...new Set(dropped)].join(', '),dropped}
 return {candidates:kept,dropped}
}
export function verifyPrompt(name:string,kind:Kind,quote:string):string{
 return `Page text: "${quote}"\n\nIs "${name}" a specific named ${kind==='hotel'?'hotel or lodging property':kind==='restaurant'?'restaurant, cafe or bar':'attraction, venue or activity provider'} that this text describes (not a city, country, neighborhood, website, meal, event or category)? Answer with exactly one word: yes, no or unsure.`
}
