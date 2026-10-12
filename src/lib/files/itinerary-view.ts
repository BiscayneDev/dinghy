import type {SourceRecords} from './source-records'
import {compileItineraryCandidates,itineraryCandidateErrorCode} from './itinerary-candidates'
import {isHubUrl,isNonVenueName,isCategoryPhrase,placeWordsFrom,GEO_NAMES} from './itinerary-mentions'
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
 // Prefer list-like pages: when some page has real venue density, drop single-story pages with few venue-like lines.
 const perSource=new Map<string,number>();for(const e of entries)if(VENUE_LIKE.test(e.text))perSource.set(e.source,(perSource.get(e.source)??0)+1)
 let kept=entries
 if([...perSource.values()].some(v=>v>=5)){kept=entries.filter(e=>(perSource.get(e.source)??0)>=5);kept.forEach((e,i)=>{e.n=i+1});venueLines=kept.filter(e=>VENUE_LIKE.test(e.text)).length;pages=new Set(kept.map(e=>e.source)).size}
 return {text:kept.map(e=>`L${e.n} ${e.text}`).join('\n'),lines:kept.length,pages,venueLines,entries:kept}
}
export function viewNote(v:{text:string}):string{
 return 'Numbered lines from the pages read (headings, list items and sentences). Name specific hotels, restaurants and attractions that appear in them. For each give kind, the exact name as written on a line, and that line number (for example 12 for L12). The server takes the supporting quote from that line itself. Do not name cities, countries, neighborhoods, websites, meals or categories. Do not use names from memory.\n\n'+v.text
}
export function quoteToolDef(maxLine:number){
 return {type:'function' as const,function:{name:SELECT_CANDIDATES_TOOL,description:'Select hotel, restaurant and activity recommendations for this itinerary from the numbered page lines shown. Each candidate: kind (hotel|restaurant|activity), name (exactly as written on a line), line (optional: the line number, e.g. 12 for L12, where the name appears; the server finds the line from the name). The server checks the name against that line and takes the quote from the page itself.',parameters:{type:'object',additionalProperties:false,properties:{candidates:{type:'array',minItems:1,maxItems:12,items:{type:'object',additionalProperties:false,properties:{kind:{type:'string',enum:['hotel','restaurant','activity']},name:{type:'string',maxLength:80},line:{type:'integer',minimum:1,maximum:Math.max(1,maxLine)}},required:['kind','name']}}},required:['candidates']}}}
}
const norm=(t:string)=>t.replace(/\s+/g,' ').trim()
const CONNECT_LC=new Set(['of','the','at','de','la','le','les','el','del','du','von','van','by','on','in','and','y','&','a','as','der','da','di','do','dos'])
const NEWS_VERBS=/\b(?:breaks?|opens?|opening|announces?|announced|ground|unveils?|launch(?:es)?|plans?|planned|reveals?|debuts?|completes?|files?|sells?|sold|buys?|approved|approves|demolish\w*|closes?|closed|closing|set to|coming|proposed|redevelop\w*|construction|rooms)\b/i
/** A name is a short proper-name run, not a headline or clause. */
export function nameShapeOk(name:string):boolean{
 if(/[:;|–—!?]/.test(name)||/\d+\s*(?:rooms?|units?|keys|stories|floors)/i.test(name)||NEWS_VERBS.test(name))return false
 const words=name.split(/\s+/);if(words.length>6)return false
 return words.filter(w=>/^\p{Ll}/u.test(w)&&!CONNECT_LC.has(w.toLowerCase())).length<=1
}
const GENERIC_REQ=new Set('monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december plan make build create need want please itinerary hotel hotels restaurant restaurants activities activity office working sessions session visit weekend recommendations recommendation synthetic self test tests pdf html file format trip travel schedule title agenda internal fictional founders city county downtown the and with then for'.split(' '))
/** Destination tokens come from the place phrase after in/to/at/near/around/for/visiting, or a known city/state/country named in the request.
 * Meta words (synthetic, self, test, pdf, itinerary, trip, plan and similar) and dates never count. */
export function destinationTokens(request:string):string[]{
 const out=new Set<string>()
 const add=(phrase:string)=>{for(const w of phrase.split(/[^\p{L}'’]+/u).filter(Boolean)){const l=w.toLowerCase();if(/^\p{Lu}/u.test(w)&&l.length>=3&&!GENERIC_REQ.has(l))out.add(l)}}
 for(const m of request.matchAll(/\b(?:in|to|at|near|around|for|visiting|across|within)\s+((?:\p{Lu}[\p{L}'’-]+)(?:\s+(?:\p{Lu}[\p{L}'’-]+|de|la|of))*)/gu))add(m[1])
 const low=' '+request.toLowerCase().replace(/[^\p{L}\s]+/gu,' ').replace(/\s+/g,' ')+' '
 for(const g of GEO_NAMES)if(low.includes(' '+g+' '))add(g.replace(/\b\p{L}/gu,c=>c.toUpperCase()))
 return [...out]
}
const normKey=(t:string)=>t.toLowerCase().replace(/^the\s+/,'').replace(/[^\p{L}\p{N}]+/gu,'')
export type Verify=(name:string,kind:Kind,quote:string)=>Promise<boolean>
/** Mechanical checks (literal quote, name inside the quote, not a brand/place/category) then one bounded yes/no verification per pick. */
export async function compileQuoteSelection(input:unknown,records:SourceRecords,request:string,verify:Verify,entries:ViewLine[],already:string[]=[]):Promise<{candidates:Record<string,unknown>[];dropped:string[]}|{error:string;dropped:string[]}>{
 const list=input&&typeof input==='object'?(input as {candidates?:unknown}).candidates:undefined
 if(!Array.isArray(list)||!list.length)return {error:'Supply candidates: at least one {kind,name,line}, with line numbers from the numbered page lines.',dropped:['empty']}
 const place=placeWordsFrom(request),dropped:string[]=[],hints:string[]=[],pending:{kind:Kind;c:Record<string,unknown>;name:string;quote:string}[]=[],seen=new Set<string>(already.map(normKey)),dest=destinationTokens(request)
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
  if(!nameShapeOk(name)){dropped.push('name_shape');hints.push(`"${name}" reads like a headline or clause; give only the venue's own name`);continue}
  if(dest.length){
   const pageText=records.pageText(line.source)||'',head=(records.pageTitle(line.source)||'').toLowerCase(),lc=line.text.toLowerCase(),pl=pageText.toLowerCase()
   const near=dest.some(d=>lc.includes(d)||head.includes(d))||dest.some(d=>pl.split(d).length-1>=3)
   if(!near){dropped.push('off_destination');hints.push(`"${name}" is not tied to ${dest.join('/')} on its line or page`);continue}
  }
  const ws=name.toLowerCase().split(/[^\p{L}'’]+/u).filter(Boolean)
  if(isNonVenueName(name)||isCategoryPhrase(name.split(/\s+/))||(ws.length&&ws.every(w=>place.has(w)))){dropped.push('not_a_venue_name');continue}
  const key=normKey(name);if(seen.has(key)){dropped.push('duplicate');continue}
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
export function verifyPrompt(name:string,kind:Kind,quote:string,destination=''):string{
 const what=kind==='hotel'?'hotel or lodging property to stay at':kind==='restaurant'?'restaurant, cafe or bar to eat or drink at':'attraction, venue or activity provider to visit'
 return `Name: "${name}"\nLine from the page: "${quote}"\n\nIs "${name}" a specific, currently open and operating ${what}${destination?' in or near '+destination:''}, described by this line as a place a traveler can use now? Answer no for news headlines, announcements, future openings, closures, demolitions, construction news, other cities, and for cities, countries, neighborhoods, websites, meals, events or categories. Answer with exactly one word: yes, no or unsure.`
}
