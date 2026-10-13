import type {SourceRecords} from './source-records'
/** Server-derived menu of literal name mentions from the FULL stored page text.
 * The model sees only a 1000-char prefix of each read, so model-typed excerpts
 * were never findable. Here the server owns spans (offsets into the real content);
 * the model only picks ids and supplies kind and judgment. No kind is inferred. */
export type Kind='hotel'|'restaurant'|'activity'
export type Mention={id:string;source:string;start:number;end:number;text:string;context:string;hint?:Kind}
const CONNECT=new Set(['of','the','de','la','del','&','du','von','van'])
const STOP=new Set(['the','a','an','in','at','on','our','your','my','we','you','it','is','are','this','that','these','those','for','with','from','to','and','or','but','if','as','by','of','all','new','top','best','menu','home','about','contact','book','visit','stay','view','read','more','see','click','login','sign','search','skip','cookie','cookies','privacy','terms','policy','share','follow','subscribe','email','phone','call','open','closed','hours','price','prices','rating','ratings','reviews','review','monday','tuesday','wednesday','thursday','friday','saturday','sunday','january','february','march','april','may','june','july','august','september','october','november','december','hotel','hotels','restaurant','restaurants','dining','activities','things','guide','map','photos','overview','hello','welcome','who','what','where','when','why','how','there','here','also','some','many','most','each','every','one','two','three','best','free','join','get','find','explore','discover','learn','shop','menu','order','now','today','tonight','weekend','back','next','previous','page','pages','copyright','rights','reserved','instagram','facebook','twitter','tiktok','youtube','google','yelp','tripadvisor','usa','us'])
const LEAD=new Set(['the','a','an','in','at','on','our','your','my','we','you','it','this','that','for','with','from','to','near','visit','stay','book','see','view','read','explore','discover','join','get','find','order','welcome','hello','where','what','who','when','how','dinner','lunch','breakfast','rooms','try','enjoy','also','and','or','but','if','as','by','of'])
const TRAIL=new Set(['monday','tuesday','wednesday','thursday','friday','saturday','sunday','january','february','march','april','may','june','july','august','september','october','november','december','today','tonight','now','and','or','of','the'])
const CATEGORY_PLURAL=new Set(['hotels','restaurants','attractions','activities','museums','places','tours','spots','bars','cafes','cafés','resorts','options','destinations','neighborhoods','neighbourhoods','beaches','experiences','guides','reviews','deals','rentals','things','stays','eats','sights','shops','hostels','nightlife','landmarks'])
const CATEGORY_LEAD=new Set(['best','top','luxury','cheap','affordable','popular','famous','favorite','favourite','recommended','beautiful','ultimate','complete','budget','boutique','family','romantic','cool','hidden','local','must','free','great','fun','unique'])
const CATEGORY_NOUN=new Set(['hotel','restaurant','attraction','activity','museum','park','place','tour','spot','bar','cafe','café','resort','option','destination','beach','experience','guide','stay','eat','sight','gallery','shop','market','inn','suite','hostel','club'])
/** Generic category phrases ("Luxury Hotels", "Top Attractions", "Things To Do") are headings, not venues. */
export function isCategoryPhrase(words:string[]):boolean {
 const w=words.map(x=>x.toLowerCase().replace(/[^\p{L}]/gu,'')).filter(Boolean)
 if(!w.length)return true
 const last=w[w.length-1]
 if(CATEGORY_PLURAL.has(last)&&w.length<=2)return true
 if(CATEGORY_LEAD.has(w[0])&&(w[1]==='of'||(w.length<=5&&w.some(x=>CATEGORY_PLURAL.has(x)))))return true
 if(w.length<=2&&CATEGORY_LEAD.has(w[0])&&(CATEGORY_NOUN.has(last)||CATEGORY_PLURAL.has(last)))return true
 if(w.length<=3&&w[0]==='things'&&w[1]==='to')return true
 return w.every(x=>CATEGORY_NOUN.has(x)||CATEGORY_PLURAL.has(x)||CATEGORY_LEAD.has(x)||STOP.has(x))
}
const WORD=/[\p{L}][\p{L}'’.\-]*|&/gu
const isCap=(w:string)=>/^\p{Lu}/u.test(w)&&!/^\p{Lu}{4,}$/u.test(w)
const HINTS:Record<Kind,RegExp>={
 hotel:/\b(?:hotels?|inn|resort|suites?|lodge|lodging|motel|hostel|b&b|guest ?house|rooms?|per night|nightly|check-?in|stay(?:s|ing)?|accommodations?|boutique)\b/gi,
 restaurant:/\b(?:restaurants?|cafe|caf\u00e9|bistro|grill|kitchen|bar|pub|tavern|eatery|diner|pizzeria|steakhouse|brasserie|bakery|dining|dinner|lunch|brunch|breakfast|cuisine|chef|menu|tacos?|sushi|seafood|oysters?|cocktails?)\b/gi,
 activity:/\b(?:museum|park|garden|gardens|tour|tours|gallery|beach|trail|zoo|aquarium|theat(?:er|re)|market|festival|cruise|hike|boat|kayak|paddle|walk|concert|stadium|monument|island|bridge|cathedral|castle|spa|tickets?|admission|exhibits?)\b/gi}
export function hintFor(text:string,context:string):Kind|undefined {
 const sc=(Object.keys(HINTS) as Kind[]).map(k=>{HINTS[k].lastIndex=0;const own=(text.match(HINTS[k])||[]).length*3;HINTS[k].lastIndex=0;return {k,v:own+(context.match(HINTS[k])||[]).length}}).sort((a,b)=>b.v-a.v)
 // A tie gives no hint rather than a wrong one.
 return sc[0].v>0&&sc[0].v-sc[1].v>=1?sc[0].k:undefined
}
/** Aggregator hubs and UI shells (search/travel hubs, social) are not sources of venue facts. */
export function isHubUrl(url:string|null):boolean {
 if(!url)return false
 try{
  const u=new URL(url),h=u.hostname.replace(/^www\./,'').toLowerCase(),path=u.pathname.toLowerCase()
  if(/(^|\.)(google|bing|duckduckgo|yahoo|facebook|instagram|pinterest|tiktok|youtube|youtu|linkedin)\.[a-z.]+$/.test(h)||/^(x|twitter)\.com$/.test(h))return true
  if(/\/(search|flights|maps|travel\/(?:hotels|flights|explore)|hotel-search|searchresults)(\/|$)/.test(path))return true
 }catch{return true}
 return false
}
/** Venue evidence: price, address, rating, hours, booking, rooms, menu, tickets and similar facts in the same sentence. */
const EVIDENCE=/[$€£]\s?\d|\b\d{1,5}\s+[\p{Lu}][\p{L}]+\s+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Way|Ln|Lane|Pl|Place|Pkwy|Highway)\b|\(\d{3}\)|\b\d\.\d\b|\b(?:located|situated|address|opens?|open daily|hours|reservations?|book(?:ing)?|check-?in|per night|nightly|rooms?|suites?|chef|serves?|tasting menu|admission|tickets?|rated|rating|stars?|brunch|dinner|lunch|exhibits?|tours?|rooftop|oceanfront|waterfront)\b/iu
export function sentenceAround(text:string,start:number,end:number):string {
 let a=start;while(a>0&&start-a<160&&!/[\n.!?]/.test(text[a-1]))a--
 let b=end,stops=0;while(b<text.length&&b-end<260){if(/[\n.!?]/.test(text[b])){if(++stops>=2||text[b]==='\n')break}b++}
 return text.slice(a,b).replace(/\s+/g,' ').trim()
}

const GEO_COUNTRY_LIST='united states,usa,america,united kingdom,england,scotland,wales,ireland,canada,mexico,brazil,argentina,chile,peru,colombia,france,germany,spain,portugal,italy,greece,turkey,netherlands,belgium,switzerland,austria,sweden,norway,denmark,finland,poland,czechia,hungary,croatia,iceland,morocco,egypt,south africa,kenya,israel,uae,dubai,india,china,japan,korea,thailand,vietnam,indonesia,singapore,malaysia,philippines,australia,new zealand,cuba,jamaica,bahamas,caribbean,europe,asia,africa,north america,south america,latin america,'
const GEO_STATE_LIST='alabama,alaska,arizona,arkansas,california,colorado,connecticut,delaware,florida,georgia,hawaii,idaho,illinois,indiana,iowa,kansas,kentucky,louisiana,maine,maryland,massachusetts,michigan,minnesota,mississippi,missouri,montana,nebraska,nevada,new hampshire,new jersey,new mexico,new york,north carolina,north dakota,ohio,oklahoma,oregon,pennsylvania,rhode island,south carolina,south dakota,tennessee,texas,utah,vermont,virginia,washington,west virginia,wisconsin,wyoming,'
const GEO_CITY_LIST='new york city,los angeles,san francisco,san diego,las vegas,chicago,boston,seattle,portland,denver,austin,dallas,houston,atlanta,miami,orlando,nashville,new orleans,philadelphia,washington dc,london,paris,rome,madrid,barcelona,berlin,amsterdam,lisbon,vienna,prague,tokyo,kyoto,bangkok,sydney,toronto,vancouver,montreal,mexico city,key west,palm beach,fort lauderdale,miami beach,south beach'
/** Split by granularity so destination resolution can anchor on the city and use state/country only as disambiguation hints. */
export const GEO_COUNTRIES=new Set(GEO_COUNTRY_LIST.split(','))
export const GEO_US_STATES=new Set(GEO_STATE_LIST.split(','))
export const GEO_CITIES=new Set(GEO_CITY_LIST.split(','))
const GEO=new Set([...GEO_COUNTRIES,...GEO_US_STATES,...GEO_CITIES])
const BRAND=/\.(?:com|net|org|io|co)\b|\b(?:booking|expedia|tripadvisor|airbnb|trivago|yelp|opentable|agoda|priceline|orbitz|hotwire|viator|getyourguide|lonely planet|wikipedia|google|facebook|reddit|hotels)\b/i
export const GEO_NAMES=[...GEO].filter(g=>g.length>=4)
export const isNonVenueName=(t:string):boolean=>{const l=t.toLowerCase().replace(/[^\p{L} .]/gu,'').trim();return BRAND.test(t)||GEO.has(l)||l.split(' ').every(w=>GEO.has(w))}
const PLACE_SUFFIX=new Set(['district','neighborhood','neighbourhood','quarter','downtown','county','city','area','village'])
export const placeWordsFrom=(request:string):Set<string>=>new Set((request.match(/\p{Lu}[\p{L}'’-]+/gu)||[]).map(w=>w.toLowerCase()))
export type ExtractOpts={placeWords?:Set<string>;evidence?:boolean}
export function extractMentions(records:SourceRecords,max=45,need:Kind[]=[],opts:ExtractOpts={}):Mention[] {
 const useEvidence=opts.evidence!==false
 const pages=records.pageIds().filter(id=>{
  if(!useEvidence)return true
  if(isHubUrl(records.pageUrl(id)))return false
  const t=records.pageText(id)||'';let n=0;for(const seg of t.split(/[\n.!?]+/)){if(EVIDENCE.test(seg)&&++n>=2)return true}
  return false
 })
 const found=new Map<string,{source:string;start:number;end:number;text:string;count:number;multi:boolean}>()
 for(const source of pages){
  const text=records.pageText(source);if(!text)continue
  const toks:{w:string;s:number;e:number}[]=[];for(const m of text.matchAll(WORD))toks.push({w:m[0].replace(/[.\-]+$/,''),s:m.index!,e:m.index!+m[0].replace(/[.\-]+$/,'').length})
  let i=0
  while(i<toks.length){
   if(!isCap(toks[i].w)){i++;continue}
   let j=i;const words=[toks[i]]
   while(j+1<toks.length&&words.length<7){
    const n=toks[j+1],gap=text.slice(toks[j].e,n.s)
    if(/[\n.!?:;,()|–—]|\s-\s/.test(gap))break
    if(isCap(n.w)){words.push(n);j++;continue}
    if(CONNECT.has(n.w.toLowerCase())&&j+2<toks.length&&isCap(toks[j+2].w)&&!/[\n.!?:;,()|–—]|\s-\s/.test(text.slice(n.e,toks[j+2].s))){words.push(n,toks[j+2]);j+=2;continue}
    break
   }
   // trim leading filler words
   while(words.length>1&&LEAD.has(words[0].w.toLowerCase()))words.shift()
   while(words.length>1&&TRAIL.has(words[words.length-1].w.toLowerCase()))words.pop()
   const first=words[0],last=words[words.length-1],span=text.slice(first.s,last.e)
   const prev=text.slice(Math.max(0,first.s-3),first.s),sentenceInitial=first.s===0||/[.!?\n]\s*$/.test(prev)
   const single=words.length===1,low=span.toLowerCase()
   const ok=span.length>=4&&span.length<=80&&!STOP.has(low)&&!(single&&(sentenceInitial||span.length<(useEvidence?5:4)))&&!isCategoryPhrase(words.map(w=>w.w))
   if(ok){const prior=found.get(low);if(prior)prior.count++;else found.set(low,{source,start:first.s,end:last.e,text:span,count:1,multi:!single})}
   i=j+1
  }
 }
 // List-like lines and headings: the text before a dash, colon, comma or bracket is often the venue name, e.g. "1. Pelican's Crab Shack - seafood".
 for(const source of pages){
  const text=records.pageText(source);if(!text)continue
  let pos=0
  for(const raw of text.split('\n')){
   const lineStart=pos;pos+=raw.length+1
   if(raw.length<4||raw.length>140)continue
   const lead=raw.match(/^[\s#>*•\-\d.)]*/)![0].length,body=raw.slice(lead)
   let head=body.match(/^[^–—:,(|·]*?(?=\s[-–—]\s|[–—:,(|·]|$)/)![0].replace(/\s+$/,'')
   let words=head.split(/\s+/).filter(Boolean),head2=head,skip=0
   while(words.length>1&&LEAD.has(words[0].toLowerCase())){skip+=head2.length-head2.replace(/^\S+\s+/,'').length;head2=head2.replace(/^\S+\s+/,'');words=words.slice(1)}
   head=head2
   if(!words.length||words.length>7||head.length<4||head.length>80)continue
   if(!/^[\p{Lu}\d]/u.test(head))continue
   if(/[.!?]$/.test(head)&&words.length>4)continue
   const minor=(w:string)=>CONNECT.has(w.toLowerCase())||/^[\d&+#.\-]+$/.test(w)||/^\p{Lu}/u.test(w)
   if(!words.every(minor))continue
   const low=head.toLowerCase()
   if(words.length===1&&(STOP.has(low)||head.length<5))continue
   if(words.every(w=>STOP.has(w.toLowerCase()))||isCategoryPhrase(words))continue
   const start=lineStart+lead+skip,prior=found.get(low)
   if(prior)prior.count+=2;else found.set(low,{source,start,end:start+head.length,text:head,count:2,multi:words.length>1})
  }
 }
 const place=opts.placeWords
 const all=[...found.values()].filter(m=>{
  const ws=m.text.toLowerCase().split(/[^\p{L}'’]+/u).filter(Boolean)
  if(place&&ws.length&&ws.every(w=>place.has(w)))return false
  if(PLACE_SUFFIX.has(ws[ws.length-1]??''))return false
  if(isNonVenueName(m.text))return false
  if(!useEvidence)return true
  return EVIDENCE.test(sentenceAround(records.pageText(m.source)!,m.start,m.end))
 }).sort((a,b)=>(Number(b.multi)-Number(a.multi))||b.count-a.count||a.start-b.start)
 const scored=all.map(m=>{const t=records.pageText(m.source)!;const wide=sentenceAround(t,m.start,m.end);return {m,hint:hintFor(m.text,wide)}})
 // Kind-balanced: reserve slots for each requested kind (best hint evidence first, then rank), fill the rest by rank.
 const chosen=new Set<typeof scored[number]>(),per=Math.max(6,Math.floor(max/ Math.max(1,need.length)/1.5))
 for(const k of need)for(const x of scored.filter(x=>x.hint===k).slice(0,per))chosen.add(x)
 for(const x of scored){if(chosen.size>=max)break;chosen.add(x)}
 const ranked=[...chosen].slice(0,max).sort((a,b)=>a.m.source.localeCompare(b.m.source)||a.m.start-b.m.start)
 return ranked.map(({m,hint},k)=>{const t=records.pageText(m.source)!;const ctx=sentenceAround(t,m.start,m.end).slice(0,230);return {id:'m'+(k+1),source:m.source,start:m.start,end:m.end,text:m.text,context:ctx,...(hint?{hint}:{})}})
}
export function menuNote(menu:Mention[]):string {
 return 'Venue-name candidates found by the server in the page text, each with the sentence it appears in. Pick ONLY from these ids, and only when the sentence shows the entry is an actual hotel, restaurant or attraction (skip cities, countries, neighborhoods, site names and generic headings). The kind you choose must match the hint on that line; entries with hint none cannot be picked. Each line: id | exact text | sentence | wording hint (a hint only; decide kind from the sentence).\n'+menu.map(m=>`${m.id} | ${m.text} | ${m.context} | ${m.hint??'none'}`).join('\n')
}

export function hintCounts(menu:Mention[]):string {
 const n=(k:Kind)=>menu.filter(m=>m.hint===k).length
 return `h${n('hotel')}_r${n('restaurant')}_a${n('activity')}_n${menu.filter(m=>!m.hint).length}`
}

/** Guides and roundups list several venues; single news stories do not. */
export function sourceScore(url:string,title:string):number{
 const t=(url+' '+title).toLowerCase()
 let sc=0
 if(/\b(best|guide|where-to|where to|things-to-do|things to do|top-\d+|top \d+|itinerary|roundup|restaurants?|hotels?)\b/.test(t.replace(/[-_/]/g,' ')))sc+=2
 if(/\/news\/|\/20\d\d\/\d\d\/|press-release|breaking|breaks-ground|-opens-|-announces|\/article\/|\bground\b|\bannounce/.test(t))sc-=3
 return sc
}
