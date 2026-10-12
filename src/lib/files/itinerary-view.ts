import type {SourceRecords} from './source-records'
import {compileItineraryCandidates,itineraryCandidateErrorCode} from './itinerary-candidates'
import {isHubUrl,isNonVenueName,isCategoryPhrase,placeWordsFrom,GEO_NAMES} from './itinerary-mentions'
import {SELECT_CANDIDATES_TOOL} from './itinerary-selection'
type Kind='hotel'|'restaurant'|'activity'
const GROUP_LIMITS={hotel:6,restaurant:5,activity:5}
const NAV=/^(?:home|about(?: us)?|contact(?: us)?|menu|sign ?in|log ?in|search|cart|book now|privacy policy|terms(?: of use)?|cookies?|skip to content|subscribe|follow us|share|read more|next|previous)$/i

export type ViewLine={n:number;source:string;start:number;end:number;text:string;name:string}
const VENUE_LIKE=/\p{Lu}[\p{L}'’]+(?:\s+(?:&\s+)?\p{Lu}[\p{L}'’]+)+/u
const NAME_CONNECT=new Set(['of','the','de','la','le','les','el','del','du','von','van','and','y','&','da','di','der'])
const SKIP_RUN=new Set('sunday monday tuesday wednesday thursday friday saturday weekend brunch dinner lunch breakfast happy hour menu menus reservations reservation tickets admission book check booking open daily'.split(' '))
const UI_STRIP=/\b(?:save to (?:wish ?list|favorites|trip)|add to (?:wish ?list|trip|favorites)|create your own\b[^.\n]*|book now|view deal|see (?:all|more)\b|read more|sign in|log in|show more|\d[\d,.]*\s+reviews?|\(\d[\d,]*\)|\d(?:\.\d)?\s*(?:\/\s*5|stars?)|photos?\s*\(?\d*\)?|share|wish ?list)\b/gi
const UI_WORDS=new Set('save share book view see visit explore add create read sign log get compare show open find check'.split(' '))
const UI_NAMES=new Set('save share wishlist photos reviews review sign login book view deal compare filter sort map menu'.split(' '))
export const LODGING_NAME=/\b(?:hotel|hostel|inn|suites?|resort|lodge|motel|novotel|hilton|marriott|hyatt|sheraton|b&b|guesthouse|villa|residences?)\b/i
export const FOOD_NAME=/\b(?:caf[eé]|restaurant|bistro|bar|grill|kitchen|trattoria|pizzeria|taqueria|diner|brasserie|steakhouse|eatery|cantina|bakery|tavern|pub)\b/i
export function kindNameMismatch(name:string,kind:Kind):boolean{
 const l=LODGING_NAME.test(name),f=FOOD_NAME.test(name)
 if(l&&f)return false
 if(l)return kind!=='hotel'
 if(f)return kind!=='restaurant'
 return false
}
export const stripUi=(t:string)=>t.replace(UI_STRIP,' ').replace(/\s{2,}/g,' ').replace(/^[\s|·•\-–—]+|[\s|·•\-–—]+$/g,'').trim()
const NEWS_LINE=/\b(?:breaks?\s+ground|announces?|announced|unveils?|set to open|will open|to open in|plans? to|proposed|redevelop\w*|demolish\w*|closes?\s+its|has closed|permanently closed|under construction)\b/i
/** The venue name is taken from the line by the server: the leading proper-name run before the first dash, colon, comma, parenthesis or sentence end. */
export function extractLineName(text:string):string|null{
 if(NEWS_LINE.test(text))return null
 const head=text.split(/\s[-–—]\s|[–—:,(|·.!?]/)[0].trim()
 const words=head.split(/\s+/).filter(Boolean)
 while(words.length>1&&UI_WORDS.has(words[0].toLowerCase()))words.shift()
 if(words.length<1)return null
 const isCapW=(w:string)=>/^[\p{Lu}\d]/u.test(w)&&!/^\d+$/.test(w)
 const runs:{from:number;ws:string[]}[]=[]
 for(let i=0;i<words.length;){
  if(!isCapW(words[i])){i++;continue}
  const ws=[words[i]];let j=i+1
  while(j<words.length&&ws.length<8){
   if(isCapW(words[j])){ws.push(words[j]);j++;continue}
   let k=j;while(k<words.length&&NAME_CONNECT.has(words[k].toLowerCase()))k++
   if(k>j&&k<words.length&&isCapW(words[k])){ws.push(...words.slice(j,k+1));j=k+1;continue}
   break
  }
  runs.push({from:i,ws});i=j
 }
 const usable=runs.filter(r=>!r.ws.every(w=>SKIP_RUN.has(w.toLowerCase().replace(/[^\p{L}]/gu,''))))
 const longLine=text.length>120
 const pool=longLine?usable.filter(r=>r.from===0):usable
 const pick=pool.find(r=>r.ws.length>=2)??pool.find(r=>r.from>0&&r.ws[0].length>=5)??(usable.length===1&&words.length<=3&&usable[0].from===0&&usable[0].ws[0].length>=4?usable[0]:undefined)
 if(!pick)return null
 const name=pick.ws.join(' ').replace(/[.\-]+$/,'')
 const nl=name.toLowerCase().replace(/['’]s$/,'')
 if(UI_NAMES.has(nl)||name.split(/\s+/).every(w=>UI_NAMES.has(w.toLowerCase())))return null
 if(!/\s/.test(name)&&/s$/i.test(name)&&GEO_NAMES.includes(nl.replace(/s$/,'')))return null
 if(name.length<4||name.length>80||!nameShapeOk(name)||isNonVenueName(name)||isCategoryPhrase(name.split(/\s+/)))return null
 return name
}
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
    const lit=m[0].slice(0,260),flatS=stripUi(lit.replace(/\s+/g,' ').trim())
    if(flatS.length<8||flatS.split(' ').length<2)continue
    if(size+flatS.length>perPage||used+size+flatS.length>total){full=true;break}
    const name=extractLineName(flatS);if(!name)continue
    const start=lineStart+lead+m.index!
    entries.push({n:entries.length+1,source:id,start,end:start+lit.length,text:flatS,name});size+=flatS.length+name.length+12;added++
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
 return {text:kept.map(e=>`L${e.n} | ${e.name} | ${e.text}`).join('\n'),lines:kept.length,pages,venueLines,entries:kept}
}
export function viewNote(v:{text:string}):string{
 return 'Candidate lines from the pages read. Each line is: L<number> | venue name found by the server | the text of that line. Choose lines whose venue is a real hotel, restaurant or attraction a traveler can use now. For each, give kind (hotel, restaurant or activity) and the line number only; never type a name. Skip cities, neighborhoods, websites, news items and categories.\n\n'+v.text
}
export function quoteToolDef(maxLine:number){
 return {type:'function' as const,function:{name:SELECT_CANDIDATES_TOOL,description:'Select hotel, restaurant and activity recommendations for this itinerary by line number from the candidate lines shown. Each candidate: kind (hotel|restaurant|activity) and line (the number after L). The server takes the venue name and quote from that line and verifies them. Never type a venue name.',parameters:{type:'object',additionalProperties:false,properties:{candidates:{type:'array',minItems:1,maxItems:12,items:{type:'object',additionalProperties:false,properties:{kind:{type:'string',enum:['hotel','restaurant','activity']},line:{type:'integer',minimum:1,maximum:Math.max(1,maxLine)}},required:['kind','line']}}},required:['candidates']}}}
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
export type SelectionResult={candidates:Record<string,unknown>[];dropped:string[];previews:string[]}|{error:string;dropped:string[];previews:string[]}
const preview=(t:string)=>t.replace(/[^A-Za-z0-9]/g,'').slice(0,20)
export async function compileQuoteSelection(input:unknown,records:SourceRecords,request:string,verify:Verify,entries:ViewLine[],already:string[]=[]):Promise<SelectionResult>{
 const list=input&&typeof input==='object'?(input as {candidates?:unknown}).candidates:undefined
 if(!Array.isArray(list)||!list.length)return {error:'Supply candidates: at least one {kind,line}, with line numbers from the candidate lines.',dropped:['empty'],previews:[]}
 const place=placeWordsFrom(request),dropped:string[]=[],previews:string[]=[],pending:{kind:Kind;c:Record<string,unknown>;name:string;quote:string}[]=[],seen=new Set<string>(already.map(normKey)),dest=destinationTokens(request)
 const reject=(code:string,name:string)=>{dropped.push(code);if(name)previews.push(preview(name))}
 for(const raw of list.slice(0,12)){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)){dropped.push('candidate_type');continue}
  const r=raw as Record<string,unknown>,kind=r.kind
  if(kind!=='hotel'&&kind!=='restaurant'&&kind!=='activity'){dropped.push('kind');continue}
  const ln=typeof r.line==='number'?r.line:Number(String(r.line??'').replace(/^L/i,''))
  const line=entries.find(e=>e.n===ln)
  if(!line){dropped.push('line_unknown');continue}
  // The name is the server's: extracted from the line, so the model cannot invent or mis-copy one.
  const name=line.name,text=records.pageText(line.source)!,slice=text.slice(line.start,line.end),off=slice.indexOf(name)
  if(off<0){reject('name_not_on_line',name);continue}
  const nxt=entries.find(e=>e.n===line.n+1&&e.source===line.source)
  const heading=line.end-line.start<40||!/[.!?]$/.test(line.text)
  const quote=stripUi(norm(text.slice(line.start,(nxt&&heading&&nxt.end-line.start<=300?nxt.end:line.end))))
  if(kindNameMismatch(name,kind)){reject('kind_mismatch',name);continue}
  if(!nameShapeOk(name)){reject('name_shape',name);continue}
  if(dest.length){
   const head=(records.pageTitle(line.source)||'').toLowerCase(),lc=line.text.toLowerCase(),pl=text.toLowerCase()
   const near=dest.some(d=>lc.includes(d)||head.includes(d))||dest.some(d=>pl.split(d).length-1>=3)
   if(!near){reject('off_destination',name);continue}
  }
  const ws=name.toLowerCase().split(/[^\p{L}'’]+/u).filter(Boolean)
  if(isNonVenueName(name)||isCategoryPhrase(name.split(/\s+/))||(ws.length&&ws.every(w=>place.has(w)))){reject('not_a_venue_name',name);continue}
  const key=normKey(name);if(seen.has(key)){reject('duplicate',name);continue}
  seen.add(key)
  const start=line.start+off
  const c:Record<string,unknown>={kind,name:{source:line.source,field:'content',start,end:start+name.length},reason:quote.slice(0,300),catch:'Hours, prices and availability unverified'}
  const out=compileItineraryCandidates({body:'x',itinerary_candidates:[c]},records)
  if('error' in out){reject(itineraryCandidateErrorCode(out.error),name);continue}
  pending.push({kind,c,name,quote})
 }
 const verdicts=await Promise.all(pending.map(p=>verify(p.name,p.kind,p.quote).catch(()=>false)))
 const kept:Record<string,unknown>[]=[],counts={hotel:0,restaurant:0,activity:0}
 pending.forEach((p,i)=>{if(!verdicts[i]){reject('not_verified',p.name);return};if(counts[p.kind]>=GROUP_LIMITS[p.kind]){reject('group_limit',p.name);return};counts[p.kind]++;kept.push(p.c)})
 if(!kept.length)return {error:'No valid candidate. Give kind and a line number from the candidate lines (never a name). Pick lines whose venue is a real hotel, restaurant or attraction open now, not a city, site, news item or category. Dropped: '+[...new Set(dropped)].join(', '),dropped,previews}
 return {candidates:kept,dropped,previews}
}
export function verifyPrompt(name:string,kind:Kind,quote:string,destination=''):string{
 const what=kind==='hotel'?'hotel or lodging property to stay at':kind==='restaurant'?'restaurant, cafe or bar to eat or drink at':'attraction, venue or activity provider to visit'
 return `Name: "${name}"\nLine from the page: "${quote}"\n\nIs "${name}" a specific, currently open and operating ${what}${destination?' in or near '+destination:''}, described by this line as a place a traveler can use now? ${kind==='hotel'?'Answer no if the line or name shows it is a restaurant, bar, attraction or anything other than a place to sleep.':'Answer no if the name or line shows it is a hotel or lodging property, or is mainly something other than a '+(kind==='restaurant'?'place to eat or drink':'visitor attraction or activity')+'.'} Answer no for news headlines, announcements, future openings, closures, demolitions, construction news, other cities, and for cities, countries, neighborhoods, websites, meals, events or categories. Answer with exactly one word: yes, no or unsure.`
}
