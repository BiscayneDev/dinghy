import type {SourceRecords} from './source-records'
/** Server-derived menu of literal name mentions from the FULL stored page text.
 * The model sees only a 1000-char prefix of each read, so model-typed excerpts
 * were never findable. Here the server owns spans (offsets into the real content);
 * the model only picks ids and supplies kind and judgment. No kind is inferred. */
export type Kind='hotel'|'restaurant'|'activity'
export type Mention={id:string;source:string;start:number;end:number;text:string;context:string;hint?:Kind}
const CONNECT=new Set(['of','the','de','la','del','and','&','at','du','von','van'])
const STOP=new Set(['the','a','an','in','at','on','our','your','my','we','you','it','is','are','this','that','these','those','for','with','from','to','and','or','but','if','as','by','of','all','new','top','best','menu','home','about','contact','book','visit','stay','view','read','more','see','click','login','sign','search','skip','cookie','cookies','privacy','terms','policy','share','follow','subscribe','email','phone','call','open','closed','hours','price','prices','rating','ratings','reviews','review','monday','tuesday','wednesday','thursday','friday','saturday','sunday','january','february','march','april','may','june','july','august','september','october','november','december','hotel','hotels','restaurant','restaurants','dining','activities','things','guide','map','photos','overview','hello','welcome','who','what','where','when','why','how','there','here','also','some','many','most','each','every','one','two','three','best','free','join','get','find','explore','discover','learn','shop','menu','order','now','today','tonight','weekend','back','next','previous','page','pages','copyright','rights','reserved','instagram','facebook','twitter','tiktok','youtube','google','yelp','tripadvisor','usa','us'])
const LEAD=new Set(['the','a','an','in','at','on','our','your','my','we','you','it','this','that','for','with','from','to','near','visit','stay','book','see','view','read','explore','discover','join','get','find','order','welcome','hello','where','what','who','when','how','dinner','lunch','breakfast','rooms','try','enjoy','also','and','or','but','if','as','by','of'])
const TRAIL=new Set(['monday','tuesday','wednesday','thursday','friday','saturday','sunday','january','february','march','april','may','june','july','august','september','october','november','december','today','tonight','now','and','or','of','the'])
const WORD=/[\p{L}][\p{L}'’.\-]*|&/gu
const isCap=(w:string)=>/^\p{Lu}/u.test(w)&&!/^\p{Lu}{4,}$/u.test(w)
const HINTS:Record<Kind,RegExp>={
 hotel:/\b(?:hotels?|inn|resort|suites?|lodge|lodging|motel|hostel|b&b|guest ?house|rooms?|per night|nightly|check-?in|stay(?:s|ing)?|accommodations?|boutique)\b/gi,
 restaurant:/\b(?:restaurants?|cafe|caf\u00e9|bistro|grill|kitchen|bar|pub|tavern|eatery|diner|pizzeria|steakhouse|brasserie|bakery|dining|dinner|lunch|brunch|breakfast|cuisine|chef|menu|tacos?|sushi|seafood|oysters?|cocktails?)\b/gi,
 activity:/\b(?:museum|park|garden|gardens|tour|tours|gallery|beach|trail|zoo|aquarium|theat(?:er|re)|market|festival|cruise|hike|boat|kayak|paddle|walk|concert|stadium|monument|island|bridge|cathedral|castle|spa|tickets?|admission|exhibits?)\b/gi}
export function hintFor(text:string,context:string):Kind|undefined {
 let best:Kind|undefined,top=0
 for(const k of Object.keys(HINTS) as Kind[]){HINTS[k].lastIndex=0;const own=(text.match(HINTS[k])||[]).length*2;HINTS[k].lastIndex=0;const near=(context.match(HINTS[k])||[]).length;const sc=own+near;if(sc>top){top=sc;best=k}}
 return best
}
export function extractMentions(records:SourceRecords,max=48,need:Kind[]=[]):Mention[] {
 const found=new Map<string,{source:string;start:number;end:number;text:string;count:number;multi:boolean}>()
 for(const source of records.pageIds()){
  const text=records.pageText(source);if(!text)continue
  const toks:{w:string;s:number;e:number}[]=[];for(const m of text.matchAll(WORD))toks.push({w:m[0].replace(/[.\-]+$/,''),s:m.index!,e:m.index!+m[0].replace(/[.\-]+$/,'').length})
  let i=0
  while(i<toks.length){
   if(!isCap(toks[i].w)){i++;continue}
   let j=i;const words=[toks[i]]
   while(j+1<toks.length&&words.length<7){
    const n=toks[j+1],gap=text.slice(toks[j].e,n.s)
    if(/[\n.!?:;,()|]/.test(gap))break
    if(isCap(n.w)){words.push(n);j++;continue}
    if(CONNECT.has(n.w.toLowerCase())&&j+2<toks.length&&isCap(toks[j+2].w)&&!/[\n.!?:;,()|]/.test(text.slice(n.e,toks[j+2].s))){words.push(n,toks[j+2]);j+=2;continue}
    break
   }
   // trim leading filler words
   while(words.length>1&&LEAD.has(words[0].w.toLowerCase()))words.shift()
   while(words.length>1&&TRAIL.has(words[words.length-1].w.toLowerCase()))words.pop()
   const first=words[0],last=words[words.length-1],span=text.slice(first.s,last.e)
   const prev=text.slice(Math.max(0,first.s-3),first.s),sentenceInitial=first.s===0||/[.!?\n]\s*$/.test(prev)
   const single=words.length===1,low=span.toLowerCase()
   const ok=span.length>=4&&span.length<=80&&!STOP.has(low)&&!(single&&(sentenceInitial||span.length<5))
   if(ok){const prior=found.get(low);if(prior)prior.count++;else found.set(low,{source,start:first.s,end:last.e,text:span,count:1,multi:!single})}
   i=j+1
  }
 }
 const all=[...found.values()].sort((a,b)=>(Number(b.multi)-Number(a.multi))||b.count-a.count||a.start-b.start)
 const scored=all.map(m=>{const t=records.pageText(m.source)!;const wide=t.slice(Math.max(0,m.start-120),Math.min(t.length,m.end+160)).replace(/\s+/g,' ');return {m,hint:hintFor(m.text,wide)}})
 // Kind-balanced: reserve slots for each requested kind (best hint evidence first, then rank), fill the rest by rank.
 const chosen=new Set<typeof scored[number]>(),per=Math.max(6,Math.floor(max/ Math.max(1,need.length)/1.5))
 for(const k of need)for(const x of scored.filter(x=>x.hint===k).slice(0,per))chosen.add(x)
 for(const x of scored){if(chosen.size>=max)break;chosen.add(x)}
 const ranked=[...chosen].slice(0,max).sort((a,b)=>a.m.source.localeCompare(b.m.source)||a.m.start-b.m.start)
 return ranked.map(({m,hint},k)=>{const t=records.pageText(m.source)!;const ctx=t.slice(Math.max(0,m.start-50),Math.min(t.length,m.end+60)).replace(/\s+/g,' ').trim();return {id:'m'+(k+1),source:m.source,start:m.start,end:m.end,text:m.text,context:ctx,...(hint?{hint}:{})}})
}
export function menuNote(menu:Mention[]):string {
 return 'Venue-name mentions found by the server in the full page text. Pick ONLY from these ids. Each line: id | exact text | nearby context | wording hint (a hint only; decide kind from the context).\n'+menu.map(m=>`${m.id} | ${m.text} | ${m.context} | ${m.hint??'none'}`).join('\n')
}

export function hintCounts(menu:Mention[]):string {
 const n=(k:Kind)=>menu.filter(m=>m.hint===k).length
 return `h${n('hotel')}_r${n('restaurant')}_a${n('activity')}_n${menu.filter(m=>!m.hint).length}`
}
