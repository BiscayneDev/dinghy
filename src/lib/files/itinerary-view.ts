import type {SourceRecords} from './source-records'
import {compileItineraryCandidates,itineraryCandidateErrorCode} from './itinerary-candidates'
import {isHubUrl,isNonVenueName,isCategoryPhrase,placeWordsFrom,GEO_NAMES,extractMentions} from './itinerary-mentions'
import {SELECT_CANDIDATES_TOOL} from './itinerary-selection'
type Kind='hotel'|'restaurant'|'activity'
const GROUP_LIMITS={hotel:6,restaurant:5,activity:5}
const NAV=/^(?:home|about(?: us)?|contact(?: us)?|menu|sign ?in|log ?in|search|cart|book now|privacy policy|terms(?: of use)?|cookies?|skip to content|subscribe|follow us|share|read more|next|previous)$/i

export type ViewLine={n:number;source:string;start:number;end:number;text:string;name:string;ctx?:Kind}
const FOODISH=/\b(?:restaurant|cafe|caf[eé]|bistro|bar|grill|kitchen|steakhouse|pizzeria|trattoria|taqueria|brasserie|eatery|diner|bakery|tavern|pub|hotel|inn|resort|museum|gallery|garden|park|tour|aquarium|zoo|theater|theatre)\b/i
const AREA_WORDS=/\b(?:calle|avenida|rue|via|paseo|calzada|district|neighbou?rhood|quarter|barrio|downtown|midtown|uptown|corridor|strip|row|walk|mile|waterfront|boardwalk|promenade|old town|little [A-Z]\w+)\b/i
const OWN_WORD=/\b(?:museum|gallery|park|garden|gardens|hotel|inn|resort|cafe|caf[eé]|restaurant|bar|grill|kitchen|house|club|hall|theater|theatre|tower|castle|zoo|aquarium|beach club|spa|trekking|tours?)\b/i
const STREET_END=/^(?:street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|lane|ln|highway|hwy|parkway|pkwy|way|court|ct|causeway|trail|terrace|suite|ste)$/i
const GENERIC_WORDS=new Set('coral reef beach park bay island river lake garden gardens downtown district old new north south east west central grand main ocean sea harbor harbour marina bridge pier point cove key keys city town village center centre square plaza avenue view views sunset sunrise tropical paradise golden blue green white royal'.split(' '))
const SECTION_CTX:[RegExp,Kind][]=[[/\b(?:hotels|hotel (?:suggestions|recommendations|options|picks)|stays|lodging|accommodations?|where to stay|places to stay)\b/i,'hotel'],[/\b(?:restaurants|restaurant (?:suggestions|recommendations|options|picks)|dining|eateries|where to eat|places to eat|cafes|bars)\b/i,'restaurant'],[/\b(?:things to do|(?:activity|attraction) (?:suggestions|recommendations|options|picks)|attractions|activities|sights|museums|experiences|sightseeing)\b/i,'activity']]
const sectionKind=(h:string):Kind|undefined=>{if(h.split(/\s+/).length>8)return undefined;for(const [re,k] of SECTION_CTX)if(re.test(h))return k;return undefined}
const VENUE_LIKE=/\p{Lu}[\p{L}'’]+(?:\s+(?:&\s+)?\p{Lu}[\p{L}'’]+)+/u
const NAME_CONNECT=new Set(['of','the','de','la','le','les','el','del','du','von','van','and','y','&','da','di','der'])
const PHRASE_LEAD=new Set('in at from near top best on for with by to of around about visit explore discover enjoy why how what where when our your all any more most new the-best popular famous'.split(' '))
const SERVICE_WORDS=new Set('transportation transfers transfer tours tour services service rentals rental charter charters packages package deals deal tickets passes pass shuttle shuttles limousine limo booking bookings guide guides cruises cruise excursions excursion private'.split(' '))
const SKIP_RUN=new Set('sunday monday tuesday wednesday thursday friday saturday weekend brunch dinner lunch breakfast happy hour menu menus reservations reservation tickets admission book check booking open daily'.split(' '))
const UI_STRIP=/\b(?:save to (?:wish ?list|favorites|trip)|add to (?:wish ?list|trip|favorites)|create your own\b[^.\n]*|book now|view deal|see (?:all|more)\b|read more|sign in|log in|show more|\d[\d,.]*\s+reviews?|\(\d[\d,]*\)|\d(?:\.\d)?\s*(?:\/\s*5|stars?)|photos?\s*\(?\d*\)?|share|wish ?list|read (?:the )?full (?:review|story|article)|save story|save this|readers['’] choice|subscribe\b[^.\n]*|sign up\b[^.\n]*|newsletter|advertisement|sponsored(?: content)?|click here|learn more|get directions|view (?:menu|map|website)|call now|opens? in new (?:tab|window)|\d+\s*min read)\b/gi
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
const CHIP=/(?:\$\s*\||\|\s*\$|\s\|\s|\bUnitedStates\b|\bUnited States,|\b\d{2,5}\s?[A-Z][A-Za-z]*\s?(?:St|Street|Dr|Drive|Ave|Avenue|Blvd|Boulevard|Rd|Road|Ln|Lane|Way|Pkwy|Hwy)\b\.?|\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b|,\s*\d{5}\b|\$\s*(?=[|,]|$))/
/** Price chips, pipe-separated page chrome and street/zip fragments are not a reason; the parts that carry them are removed. */
export const cleanChips=(t:string)=>t.split(/(?<=[.!?])\s+/).filter(p=>!CHIP.test(p)).join(' ').replace(/\s{2,}/g,' ').trim()
export const stripUi=(t:string)=>t.replace(UI_STRIP,' ').replace(/\s{2,}/g,' ').replace(/^[\s|·•\-–—]+|[\s|·•\-–—]+$/g,'').trim()
const NEWS_LINE=/\b(?:breaks?\s+ground|announces?|announced|unveils?|set to open|will open|to open in|plans? to|proposed|redevelop\w*|demolish\w*|closes?\s+its|has closed|permanently closed|under construction)\b/i
/** The venue name is taken from the line by the server: the leading proper-name run before the first dash, colon, comma, parenthesis or sentence end. */
export function extractLineName(text:string):string|null{
 if(NEWS_LINE.test(text))return null
 for(const seg of text.split(/\s[-–—]\s|[–—:,(|·.!?]/).slice(0,3)){const n=extractFromHead(seg.trim(),text);if(n)return n}
 return null
}
function extractFromHead(head:string,text:string):string|null{
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
 const cands=[...pool.filter(r=>r.ws.length>=2),...(FOODISH.test(text)?pool.filter(r=>r.ws.length<2&&r.from>0&&r.ws[0].length>=5):[]),...(usable.length===1&&words.length<=3&&usable[0].from===0&&usable[0].ws[0].length>=4&&usable[0].ws.length<2?usable:[])]
 for(const pick of cands){const n=validRun(pick);if(n)return n}
 return null
 function validRun(pick:{from:number;ws:string[]}):string|null{
 let ws=pick.ws
 // A name continued by "at <Place>" (e.g. "Coral Reef at Key Biscayne") is kept whole, never cut off before the "at".
 {let j=pick.from+ws.length
  if(ws.length>=2&&words[j]?.toLowerCase()==='at'&&words[j+1]&&isCapW(words[j+1])){const ext=['at'];j++;while(j<words.length&&ext.length<5&&(isCapW(words[j])||(NAME_CONNECT.has(words[j].toLowerCase())&&words[j+1]&&isCapW(words[j+1])))){ext.push(words[j]);j++}ws=[...ws,...ext]}}
 // Address fragments ("100 Chopin Plaza", "Galen Dr") and generic labels are not venue names.
 if(pick.from>0&&/^\d+[a-z]?$/i.test(words[pick.from-1]))return null
 if(STREET_END.test(ws[ws.length-1].replace(/[^\p{L}]/gu,''))||ws.every(w=>GENERIC_WORDS.has(w.toLowerCase().replace(/[^\p{L}]/gu,''))))return null
 // A possessive owner prefix is not the venue. Keep an immediately continued full venue name.
 if(/['’]s$/i.test(ws[ws.length-1])&&!OWN_WORD.test(ws.join(' ')))return null
 const name=ws.join(' ').replace(/[.\-]+$/,'')
 if(!OWN_WORD.test(name)&&(/\b(?:menus?|months?|through|powered by)\b/i.test(name)||ws.every(w=>GEO_NAMES.includes(w.toLowerCase())||NAME_CONNECT.has(w.toLowerCase()))))return null
 // Run-together or camel-case tokens (PoweredBy, HotList, SearchHack) are page UI, and a lone common word needs a venue word on its line.
 if(ws.length<2&&/\p{Ll}\p{Lu}/u.test(ws[0])&&!/^(?:Mc|Mac|O['’]|De|La|Le|Di|Van)/.test(ws[0]))return null
 if(ws.length<2&&!FOODISH.test(text)&&!/\d/.test(name))return null
 // A neighborhood, street or district is an area, not a venue.
 if(AREA_WORDS.test(name)&&!OWN_WORD.test(name))return null
 // A phrase, not a name: leads with a preposition or ranking word, is an all-caps category heading, or is a service category.
 if(PHRASE_LEAD.has(ws[0].toLowerCase().replace(/[^\p{L}]/gu,'')))return null
 // Mixed all-caps heading fragments without a venue noun are not complete names.
 if(ws.length>=2&&ws.some(w=>/^\p{Lu}{4,}$/u.test(w))&&!OWN_WORD.test(name))return null
 const letters=name.replace(/[^\p{L}]/gu,'')
 if(ws.length>=2&&letters.length>=6&&letters===letters.toUpperCase()&&!OWN_WORD.test(name)&&(ws.length>=4||ws.some(w=>SERVICE_WORDS.has(w.toLowerCase().replace(/[^\p{L}]/gu,'')))))return null
 if(ws.some(w=>SERVICE_WORDS.has(w.toLowerCase().replace(/[^\p{L}]/gu,'')))&&!/\b(?:museum|gallery|park|garden|hotel|inn|resort|cafe|caf[eé]|restaurant|bar|grill|kitchen)\b/i.test(name))return null
 const nl=name.toLowerCase().replace(/['’]s$/,'')
 if(UI_NAMES.has(nl)||name.split(/\s+/).every(w=>UI_NAMES.has(w.toLowerCase())))return null
 if(!/\s/.test(name)&&/s$/i.test(name)&&GEO_NAMES.includes(nl.replace(/s$/,'')))return null
 if(name.length<4||name.length>80||!nameShapeOk(name)||isNonVenueName(name)||isCategoryPhrase(name.split(/\s+/)))return null
 return name
 }
}
/** A clean, bounded, numbered view of each usable page: headings, list items and sentences. The server keeps the literal span of every line. */
export function buildPageView(records:SourceRecords,perPage=4500,total=13000,skip?:Set<string>):{text:string;lines:number;pages:number;venueLines:number;entries:ViewLine[]}{
 const entries:ViewLine[]=[];let used=0,pages=0,venueLines=0
 for(const id of records.pageIds()){
  if(isHubUrl(records.pageUrl(id))||skip?.has(id))continue
  const text=records.pageText(id)||'';let size=0,pos=0,added=0,full=false,ctx:Kind|undefined
  for(const raw of text.split('\n')){
   const lineStart=pos;pos+=raw.length+1
   if(full)continue
   const lead=raw.match(/^[\s#>*•\-\d.)]*/)![0].length,content=raw.slice(lead).replace(/\s+$/,'')
   const flat=content.replace(/\s+/g,' ').trim()
   if(/^\s*#/.test(raw)||(flat.length<60&&!/[.!?:]$/.test(flat))){const sk=sectionKind(flat);if(sk)ctx=sk;else if(/^\s*#{1,2}\s/.test(raw))ctx=undefined}
   if(flat.length<8||flat.split(' ').length<2||NAV.test(flat))continue
   for(const m of content.matchAll(/\S[^.!?]*(?:[.!?]+(?=\s|$)|$)/g)){
    const lit=m[0].slice(0,260),flatS=stripUi(lit.replace(/\s+/g,' ').trim())
    if(flatS.length<8||flatS.split(' ').length<2)continue
    if(size+flatS.length>perPage||used+size+flatS.length>total){full=true;break}
    const name=extractLineName(flatS);if(!name)continue
    const start=lineStart+lead+m.index!
    entries.push({n:entries.length+1,source:id,start,end:start+lit.length,text:flatS,name,ctx});size+=flatS.length+name.length+12;added++
    if(VENUE_LIKE.test(flatS))venueLines++
   }
  }
  if(added){pages++;used+=size}
  if(used>=total)break
 }
 // Keep sparse venue pages too: page density is not a reason to discard a supported restaurant or attraction.
 const kept=entries
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
/** A literal page title/category plus this pick's section. Never a synthesized kind claim. */
export function verificationContext(line:ViewLine,records:SourceRecords,entries:ViewLine[]):string{
 const text=records.pageText(line.source)||''
 let category=''
 for(const raw of text.slice(0,line.start).split('\n')){
  const flat=raw.replace(/^[\s#>*•\-\d.)]*/,'').trim()
  if(sectionKind(flat))category=flat
  else if(/^\s*#{1,2}\s/.test(raw))category=''
 }
 const nextHeading=/\n\s*#{1,3}\s/.exec(text.slice(line.end))
 const nextVenue=entries.find(e=>e.source===line.source&&e.start>=line.end&&e.name!==line.name)
 const end=Math.min(line.end+700,nextHeading?line.end+nextHeading.index:Infinity,nextVenue?nextVenue.start:Infinity)
 return [records.pageTitle(line.source)?'Page title: '+records.pageTitle(line.source):'',category?'Page section: '+category:'','Pick section: '+norm(text.slice(line.start,end))].filter(Boolean).join('\n')
}
export async function compileQuoteSelection(input:unknown,records:SourceRecords,request:string,verify:Verify,entries:ViewLine[],already:string[]=[]):Promise<SelectionResult>{
 const list=input&&typeof input==='object'?(input as {candidates?:unknown}).candidates:undefined
 if(!Array.isArray(list)||!list.length)return {error:'Supply candidates: at least one {kind,line}, with line numbers from the candidate lines.',dropped:['empty'],previews:[]}
 const place=placeWordsFrom(request),dropped:string[]=[],previews:string[]=[],pending:{kind:Kind;c:Record<string,unknown>;name:string;quote:string}[]=[],seen=new Set<string>(already.map(normKey)),dest=destinationTokens(request)
 const mentions=extractMentions(records,500,[],{evidence:false})
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
  if(line.ctx&&line.ctx!==kind){reject('kind_mismatch',name);continue}
  // Verify against the source section, not a cleaned reason or an invented listing fallback.
  // Include prose following a heading so a neighborhood cannot become an attraction by losing its context.
  const nextHeading=/\n\s*#{1,3}\s/.exec(text.slice(line.end))
  const sectionEnd=Math.min(line.end+700,nextHeading?line.end+nextHeading.index:Infinity)
  const evidence=verificationContext(line,records,entries)
  const others=[...entries.filter(e=>e.source===line.source).map(e=>e.name),...mentions.filter(m=>m.source===line.source).map(m=>m.text)]
   .filter(n=>n!==name&&!n.includes(name)&&!name.includes(n)&&!STREET_END.test(n.split(/\s+/).pop()||'')&&!n.split(/\s+/).every(w=>SKIP_RUN.has(w.toLowerCase())))
  const mentionsOther=(t:string)=>others.some(o=>t.toLowerCase().includes(o.toLowerCase()))
  const unsafeReason=(t:string)=>mentionsOther(t)||CHIP.test(t)||/[$€£¥]|\b(?:USD|EUR|GBP)\s*\d|\b\d+(?:[.,]\d+)?\s*(?:dollars?|euros?|pounds?)\b|\b(?:I|we|our|ours|us|my|mine)\b/i.test(t)
  const sentences=(t:string)=>t.split(/(?<=[.!?])\s+|\n+/).map(x=>stripUi(norm(x.replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[*_`]/g,''))))
  const own=new RegExp('(?:'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'|^(?:It|Its|This|They|The (?:hotel|restaurant|property|museum|park|venue|bar|cafe))\\b)','i')
  const usable=(x:string)=>x.split(' ').length>=5&&x.length<=260&&!NEWS_LINE.test(x)&&own.test(x)&&!unsafeReason(x)
  // Drop whole unsafe sentences. Cutting them before another venue leaves misleading fragments.
  let quote=sentences(text.slice(line.start,line.end)).filter(usable).join(' ')
  if(!quote){
   const nextVenue=entries.find(e=>e.source===line.source&&e.start>=line.end&&e.name!==name)
   const limit=Math.min(sectionEnd,nextVenue?nextVenue.start:Infinity)
   quote=sentences(text.slice(line.end,limit)).find(usable)||''
  }
  if(!quote)quote=sentences(text).find(x=>x.toLowerCase().includes(name.toLowerCase())&&usable(x))||''
  if(!quote){
   const title=stripUi(norm(records.pageTitle(line.source)||'')).slice(0,100),label=kind==='hotel'?'a place to stay':kind==='restaurant'?'a place to eat or drink':'something to do'
   // The page title is optional display text, never evidence or a way to reintroduce unsafe content.
   quote=`${name}. Listed as ${label}${title&&!unsafeReason(title)?' on "'+title+'"':' on the source page'}.`.slice(0,300)
   const area=norm(text.slice(line.end,sectionEnd)).match(/\b(?:in|to|within|around)\s+(?:the\s+)?([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3}\s+(?:District|Quarter|Neighborhood))\b/)?.[1]
   if(area)quote+=` The source mentions ${area}.`
  }
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
  pending.push({kind,c,name,quote:evidence})
 }
 const verdicts=await Promise.all(pending.map(p=>verify(p.name,p.kind,p.quote).catch(()=>false)))
 const kept:Record<string,unknown>[]=[],counts={hotel:0,restaurant:0,activity:0}
 pending.forEach((p,i)=>{if(!verdicts[i]){reject('not_verified',p.name);return};if(counts[p.kind]>=GROUP_LIMITS[p.kind]){reject('group_limit',p.name);return};counts[p.kind]++;kept.push(p.c)})
 if(!kept.length)return {error:'No valid candidate. Give kind and a line number from the candidate lines (never a name). Pick lines whose venue is a real hotel, restaurant or attraction open now, not a city, site, news item or category. Dropped: '+[...new Set(dropped)].join(', '),dropped,previews}
 return {candidates:kept,dropped,previews}
}
export function verifyPrompt(name:string,kind:Kind,quote:string,destination=''):string{
 const what=kind==='hotel'?'a hotel or lodging property':kind==='restaurant'?'a restaurant, cafe or bar':'an attraction, museum, tour, venue or activity provider'
 const wrong=kind==='hotel'?'a restaurant, attraction or other non-lodging place':kind==='restaurant'?'a hotel, attraction or other non-food place':'a hotel or a restaurant'
 return `Name: "${name}"\nSource context (including surrounding prose): "${quote}"\n\nIs "${name}" a named business or place that is ${what}${destination?' in or near '+destination:''}? Answer yes only if the source context identifies the complete name as a ${kind==='hotel'?'lodging property':kind==='restaurant'?'place to eat or drink':'attraction or activity provider'} rather than an area or category. A named entry in an explicit restaurant/hotel/attraction list is type evidence even without a descriptive sentence. This checks venue identity and kind, not proof of live hours, availability or prices. Answer no if it is ${wrong}, a city, neighborhood, street, district, area, website, meal, event or category, outside ${destination||'the destination'}, news of a closure, demolition or future opening, a chopped or incomplete heading fragment, or if you are unsure. A bare heading with no venue category or descriptive context is not evidence; use its page title, category and surrounding prose. Never use another entry to supply evidence about this name. Answer with exactly one word: yes or no.`
 }
