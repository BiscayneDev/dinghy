import type {SourceRecords} from './source-records'
import {compileItineraryCandidates,itineraryCandidateErrorCode} from './itinerary-candidates'
import {isHubUrl,isNonVenueName,isCategoryPhrase,placeWordsFrom} from './itinerary-mentions'
import {SELECT_CANDIDATES_TOOL} from './itinerary-selection'
type Kind='hotel'|'restaurant'|'activity'
const GROUP_LIMITS={hotel:6,restaurant:5,activity:5}
const NAV=/^(?:home|about(?: us)?|contact(?: us)?|menu|sign ?in|log ?in|search|cart|book now|privacy policy|terms(?: of use)?|cookies?|skip to content|subscribe|follow us|share|read more|next|previous)$/i

export type ViewLine={n:number;source:string;start:number;end:number;text:string}
const VENUE_LIKE=/\p{Lu}[\p{L}'’]+(?:\s+(?:&\s+)?\p{Lu}[\p{L}'’]+)+/u
/** A clean, bounded, numbered view of each usable page: headings, list items and sentences. The server keeps the literal span of every line. */
export function buildPageView(records:SourceRecords,perPage=4500,total=13000):{text:string;lines:number;pages:number;venueLines:number;entries:ViewLine[]}{
 const entries:ViewLine[]=[];let used=0,pages=0,venueLines=0
 for(const id of records.pageIds()){
  if(isHubUrl(records.pageUrl(id)))continue
  const text=records.pageText(id)||'';let size=0,pos=0,added=0,full=false
  for(const raw of text.split('\n')){
   const lineStart=pos;pos+=raw.length+1
   if(full)continue
   const lead=raw.match(/^[\s#>*•\-\d.)]*/)![0].length,content=raw.slice(lead).replace(/\s+$/,'')
   const flat=content.replace(/\s+/g,' ').trim()
   if(flat.length<8||flat.split(' ').length<2||NAV.test(flat))continue
   for(const m of content.matchAll(/\S[^.!?]*(?:[.!?]+(?=\s|$)|$)/g)){
    const lit=m[0].slice(0,260),flatS=lit.replace(/\s+/g,' ').trim()
    if(flatS.length<8||flatS.split(' ').length<2)continue
    if(size+flatS.length>perPage||used+size+flatS.length>total){full=true;break}
    const start=lineStart+lead+m.index!
    entries.push({n:entries.length+1,source:id,start,end:start+lit.length,text:flatS});size+=flatS.length+8;added++
    if(VENUE_LIKE.test(flatS))venueLines++
   }
  }
  if(added){pages++;used+=size}
  if(used>=total)break
 }
 return {text:entries.map(e=>`L${e.n} ${e.text}`).join('\n'),lines:entries.length,pages,venueLines,entries}
}
export function viewNote(v:{text:string}):string{
 return 'Numbered lines from the pages read (headings, list items and sentences). Name specific hotels, restaurants and attractions that appear in them. For each give kind, the exact name as written on a line, and that line number (for example 12 for L12). The server takes the supporting quote from that line itself. Do not name cities, countries, neighborhoods, websites, meals or categories. Do not use names from memory.\n\n'+v.text
}
export function quoteToolDef(maxLine:number){
 return {type:'function' as const,function:{name:SELECT_CANDIDATES_TOOL,description:'Select hotel, restaurant and activity recommendations for this itinerary from the numbered page lines shown. Each candidate: kind (hotel|restaurant|activity), name (exactly as written on a line), line (optional: the line number, e.g. 12 for L12, where the name appears; the server finds the line from the name). The server checks the name against that line and takes the quote from the page itself.',parameters:{type:'object',additionalProperties:false,properties:{candidates:{type:'array',minItems:1,maxItems:12,items:{type:'object',additionalProperties:false,properties:{kind:{type:'string',enum:['hotel','restaurant','activity']},name:{type:'string',maxLength:80},line:{type:'integer',minimum:1,maximum:Math.max(1,maxLine)}},required:['kind','name']}}},required:['candidates']}}}
}
const norm=(t:string)=>t.replace(/\s+/g,' ').trim()
export type Verify=(name:string,kind:Kind,quote:string)=>Promise<boolean>
/** Mechanical checks (literal quote, name inside the quote, not a brand/place/category) then one bounded yes/no verification per pick. */
export async function compileQuoteSelection(input:unknown,records:SourceRecords,request:string,verify:Verify,entries:ViewLine[]):Promise<{candidates:Record<string,unknown>[];dropped:string[]}|{error:string;dropped:string[]}>{
 const list=input&&typeof input==='object'?(input as {candidates?:unknown}).candidates:undefined
 if(!Array.isArray(list)||!list.length)return {error:'Supply candidates: at least one {kind,name,line}, with line numbers from the numbered page lines.',dropped:['empty']}
 const place=placeWordsFrom(request),dropped:string[]=[],hints:string[]=[],pending:{kind:Kind;c:Record<string,unknown>;name:string;quote:string}[]=[],seen=new Set<string>()
 for(const raw of list.slice(0,12)){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)){dropped.push('candidate_type');continue}
  const r=raw as Record<string,unknown>,kind=r.kind
  if(kind!=='hotel'&&kind!=='restaurant'&&kind!=='activity'){dropped.push('kind');continue}
  const name=typeof r.name==='string'?norm(r.name):'',ln=typeof r.line==='number'?r.line:Number(String(r.line??'').replace(/^L/i,''))
  if(name.length<3||name.length>80){dropped.push('name');continue}
  // The server resolves the line: the model's number is a hint. Any view line holding the literal name is valid evidence; the nearest one to the hint wins.
  const holding=entries.filter(e=>e.text.includes(name))
  const hint=Number.isFinite(ln)?ln:0
  const line=holding.length?holding.slice().sort((a,b)=>Math.abs(a.n-hint)-Math.abs(b.n-hint)||a.n-b.n)[0]:undefined
  if(!line){dropped.push(hint&&!entries.some(e=>e.n===hint)?'line_unknown':'name_not_on_line');hints.push(`"${name}" does not appear on any numbered line; copy the name exactly as written on a line`);continue}
  if(hint&&line.n!==hint&&holding.length>1)hints.push(`"${name}" resolved to L${line.n}`)
  const text=records.pageText(line.source)!,slice=text.slice(line.start,line.end),off=slice.indexOf(name)
  if(off<0){dropped.push('name_not_on_line');continue}
  // Quote is server-taken: the line itself (a bare heading also takes the next line, so a reason never borrows another venue's sentence).
  const nxt=entries.find(e=>e.n===line!.n+1&&e.source===line!.source)
  const quote=norm(text.slice(line.start,(nxt&&line.end-line.start<40&&nxt.end-line.start<=300?nxt.end:line.end)))
  const loc={source:line.source,start:line.start}
  const ws=name.toLowerCase().split(/[^\p{L}'’]+/u).filter(Boolean)
  if(isNonVenueName(name)||isCategoryPhrase(name.split(/\s+/))||(ws.length&&ws.every(w=>place.has(w)))){dropped.push('not_a_venue_name');continue}
  const key=name.toLowerCase()+'|'+kind;if(seen.has(key)){dropped.push('duplicate');continue}
  seen.add(key)
  const start=loc.start+off
  const c:Record<string,unknown>={kind,name:{source:loc.source,field:'content',start,end:start+name.length},reason:quote.slice(0,300),catch:'Hours, prices and availability unverified'}
  const out=compileItineraryCandidates({body:'x',itinerary_candidates:[c]},records)
  if('error' in out){dropped.push(itineraryCandidateErrorCode(out.error));continue}
  pending.push({kind,c,name,quote})
 }
 const verdicts=await Promise.all(pending.map(p=>verify(p.name,p.kind,p.quote).catch(()=>false)))
 const kept:Record<string,unknown>[]=[],counts={hotel:0,restaurant:0,activity:0}
 pending.forEach((p,i)=>{if(!verdicts[i]){dropped.push('not_verified');return};if(counts[p.kind]>=GROUP_LIMITS[p.kind]){dropped.push('group_limit');return};counts[p.kind]++;kept.push(p.c)})
 if(!kept.length)return {error:'No valid candidate. Give kind, the name exactly as written on the line, and that line number. Names must be specific venues (not a city, site, meal or category). Dropped: '+[...new Set(dropped)].join(', ')+(hints.length?'. '+hints.slice(0,4).join('; '):''),dropped}
 return {candidates:kept,dropped}
}
export function verifyPrompt(name:string,kind:Kind,quote:string):string{
 return `Page text: "${quote}"\n\nIs "${name}" a specific named ${kind==='hotel'?'hotel or lodging property':kind==='restaurant'?'restaurant, cafe or bar':'attraction, venue or activity provider'} that this text describes (not a city, country, neighborhood, website, meal, event or category)? Answer with exactly one word: yes, no or unsure.`
}
