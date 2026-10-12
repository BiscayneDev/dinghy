import type {SourceRecords} from './source-records'
/** Server-derived menu of literal name mentions from the FULL stored page text.
 * The model sees only a 1000-char prefix of each read, so model-typed excerpts
 * were never findable. Here the server owns spans (offsets into the real content);
 * the model only picks ids and supplies kind and judgment. No kind is inferred. */
export type Mention={id:string;source:string;start:number;end:number;text:string;context:string}
const CONNECT=new Set(['of','the','de','la','del','and','&','at','du','von','van'])
const STOP=new Set(['the','a','an','in','at','on','our','your','my','we','you','it','is','are','this','that','these','those','for','with','from','to','and','or','but','if','as','by','of','all','new','top','best','menu','home','about','contact','book','visit','stay','view','read','more','see','click','login','sign','search','skip','cookie','cookies','privacy','terms','policy','share','follow','subscribe','email','phone','call','open','closed','hours','price','prices','rating','ratings','reviews','review','monday','tuesday','wednesday','thursday','friday','saturday','sunday','january','february','march','april','may','june','july','august','september','october','november','december','hotel','hotels','restaurant','restaurants','dining','activities','things','guide','map','photos','overview','hello','welcome','who','what','where','when','why','how','there','here','also','some','many','most','each','every','one','two','three','best','free','join','get','find','explore','discover','learn','shop','menu','order','now','today','tonight','weekend','back','next','previous','page','pages','copyright','rights','reserved','instagram','facebook','twitter','tiktok','youtube','google','yelp','tripadvisor','usa','us'])
const LEAD=new Set(['the','a','an','in','at','on','our','your','my','we','you','it','this','that','for','with','from','to','near','visit','stay','book','see','view','read','explore','discover','join','get','find','order','welcome','hello','where','what','who','when','how','dinner','lunch','breakfast','rooms','try','enjoy','also','and','or','but','if','as','by','of'])
const TRAIL=new Set(['monday','tuesday','wednesday','thursday','friday','saturday','sunday','january','february','march','april','may','june','july','august','september','october','november','december','today','tonight','now','and','or','of','the'])
const WORD=/[\p{L}][\p{L}'’.\-]*|&/gu
const isCap=(w:string)=>/^\p{Lu}/u.test(w)&&!/^\p{Lu}{4,}$/u.test(w)
export function extractMentions(records:SourceRecords,max=40):Mention[] {
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
 const ranked=[...found.values()].sort((a,b)=>(Number(b.multi)-Number(a.multi))||b.count-a.count||a.start-b.start).slice(0,max).sort((a,b)=>a.source.localeCompare(b.source)||a.start-b.start)
 return ranked.map((m,k)=>{const t=records.pageText(m.source)!;const ctx=t.slice(Math.max(0,m.start-50),Math.min(t.length,m.end+60)).replace(/\s+/g,' ').trim();return {id:'m'+(k+1),source:m.source,start:m.start,end:m.end,text:m.text,context:ctx}})
}
export function menuNote(menu:Mention[]):string {
 return 'Venue-name mentions found by the server in the full page text. Pick ONLY from these ids. Each line: id | exact text | nearby context.\n'+menu.map(m=>`${m.id} | ${m.text} | ${m.context}`).join('\n')
}
