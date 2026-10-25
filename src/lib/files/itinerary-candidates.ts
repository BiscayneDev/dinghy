import {SourceRecords,type SourceRef} from './source-records'
export const ITINERARY_CANDIDATE_NOTE='For researched recommendation itineraries, itinerary_candidates is REQUIRED. Supply itinerary_candidates: [{kind:"hotel"|"restaurant"|"activity",name:{source:"src2",field:"content",excerpt:"Exact venue name from page content"},reason:"your stated selection reason",catch:"your stated caveat",price?:SourceRef,rating?:SourceRef,area?:SourceRef}]. Names and optional facts must be exact complete excerpts from a successful page read, not search snippets or page titles. Optionally mark at most one favorite and one runner_up per kind, and a skip, with role and fit (one short line on why it suits this person, drawn from what they said or their saved profile; it is your read, not a page fact, and a favorite needs one). Only include explicitly selected and typed candidates; never invent a venue or infer its kind from a title. Omit absent optional facts; the server writes unknown. Keep reason/catch as your own selection judgments, not unsupported factual claims. The server builds stay/options columns and sources. Body keeps the supplied agenda/day headings/working sessions; do NOT write :::stay, :::options or :::sources when supplying candidates. Do NOT include sources as an argument. Do NOT bind null/absent fields (including published_date); write unknown instead. Prefer literal excerpt over counting offsets. Excerpt must occur verbatim in the selected page content; numeric start/end remain supported. Use only fields listed as available in source_records.'
const escapeCell=(s:string)=>s.replace(/&/g,'&amp;').replace(/[<>\\`*_{}\[\]()!#|:]/g,c=>`&#${c.charCodeAt(0)};`).replace(/[\r\n]/g,' ')
const ROLE_LABEL={favorite:'Favorite',runner_up:'Runner-up',skip:'Skip'} as const
const KIND_LABEL={hotel:'Stay',restaurant:'Dining',activity:'Activity'} as const
/** Typed picks only: the model states a role and a fit line; the server renders the labels and keeps the venue name a bound page literal. */
type Pick={kind:'hotel'|'restaurant'|'activity';role:string;name:string;fit:string}
function takeSection(picks:Pick[]):{text:string}|{error:string}{
 const lines:string[]=[]
 for(const kind of ['hotel','restaurant','activity'] as const)for(const role of ['favorite','runner_up','skip'] as const){
  const hit=picks.filter(c=>c.kind===kind&&c.role===role)
  if(hit.length>1&&role!=='skip')return {error:'Candidate role: only one '+role+' per kind.'}
  for(const c of hit)lines.push(`- ${KIND_LABEL[kind]} ${ROLE_LABEL[role].toLowerCase()}: ${c.name}.${c.fit?' '+c.fit:''}`)
 }
 return {text:lines.length?'## My take\nMy read of the pages below, not from the venues. Their facts and links are in the cards.\n'+lines.join('\n'):''}
}
/** No prose parsing or semantic guessing. Typed model selections stay selections,
 * page-bound facts stay literal source text, renderer columns are server-owned. */
export function compileItineraryCandidates(input:unknown,records:SourceRecords,opts?:{appendCards?:boolean}):{input:unknown;compiled:boolean}|{error:string} {
 if(!input||typeof input!=='object')return {error:'File input required.'}
 const i=input as Record<string,unknown>
 if(i.itinerary_candidates===undefined)return {input,compiled:false}
 if(typeof i.body!=='string'||!Array.isArray(i.itinerary_candidates)||!i.itinerary_candidates.length||i.itinerary_candidates.length>12)return {error:'Typed itinerary candidates require a body and1-12 explicitly selected candidates.'}
 if(/(?:^|\n)\s*:::(stay|options|sources)\b/i.test(i.body))return {error:'Do not mix typed itinerary candidates with manual stay/options/sources blocks.'}
 const picks:Pick[]=[]
 const groups:{hotel:string[];restaurant:string[];activity:string[]}={hotel:[],restaurant:[],activity:[]}
 const refToken=(v:unknown,required=false):string|{error:string}=>{
  if(v===undefined&&!required)return 'unknown'
  if(!v||typeof v!=='object'||Array.isArray(v))return {error:'Candidate facts require exact page-content source references.'}
  if(Object.keys(v).some(k=>!['source','field','start','end','excerpt'].includes(k)))return {error:'Unknown candidate reference field.'}
  let r=v as SourceRef & {excerpt?:unknown}
  if(r.excerpt!==undefined){
   if(r.start!==undefined||r.end!==undefined||typeof r.excerpt!=='string'||!r.excerpt.trim()||r.excerpt.length>500)return {error:'Candidate excerpt must be one exact nonempty string, without offsets.'}
   const located=records.locate(r.source,r.excerpt)
   if('error'in located)return located
   r={source:r.source,field:r.field,start:located.start,end:located.end}
  }
  if(r.field!=='content'||!Number.isInteger(r.start)||!Number.isInteger(r.end))return {error:'Candidate facts require exact page-content excerpt offsets, not titles or snippets.'}
  const result=records.resolve(r)
  if('error'in result)return result
  if(!result.value.trim())return {error:'Candidate excerpt must not be empty.'}
  if(result.record.origin!=='page')return {error:'Candidate facts require a successful page read, not search snippets. Use page source IDs: '+records.pageIds().join(', ')+'. Select exact content excerpts from those pages.'}
  return `{{source:${r.source}.content:${r.start}:${r.end}}}`
 }
 for(const raw of i.itinerary_candidates){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return {error:'Each candidate must be explicitly typed.'}
  const c=raw as Record<string,unknown>,kind=c.kind
  if(kind!=='hotel'&&kind!=='restaurant'&&kind!=='activity')return {error:'Candidate kind must be hotel, restaurant or activity.'}
  if(Object.keys(c).some(k=>!['kind','name','reason','catch','price','rating','area','role','fit'].includes(k)))return {error:'Unknown candidate field; no file was published.'}
  if(kind!=='hotel'&&(c.rating!==undefined||c.area!==undefined))return {error:'Rating/area fields are hotel-only; no candidate facts are silently dropped.'}
  if(c.role!==undefined&&c.role!=='favorite'&&c.role!=='runner_up'&&c.role!=='skip')return {error:'Candidate role must be favorite, runner_up or skip.'}
  if(c.fit!==undefined&&(typeof c.fit!=='string'||(c.fit as string).length>300))return {error:'Candidate fit must be literal short text.'}
  if(c.role==='favorite'&&!(typeof c.fit==='string'&&c.fit.trim()))return {error:'A favorite needs a fit line: why it suits this person.'}
  for(const k of ['reason','catch'])if(c[k]!==undefined&&(typeof c[k]!=='string'||(c[k] as string).length>500))return {error:'Candidate reason/catch must be literal short text.'}
  const facts=['name','price','rating','area'].map(k=>refToken(c[k],k==='name'))
  const error=facts.find(v=>typeof v!=='string');if(error&&typeof error!=='string')return error
  const [name,price,rating,area]=facts as string[],reason=escapeCell(typeof c.reason==='string'&&c.reason.trim()?c.reason:'unknown'),catchText=escapeCell(typeof c.catch==='string'&&c.catch.trim()?c.catch:'unknown')
  if(c.role==='favorite'||c.role==='runner_up'||c.role==='skip')picks.push({kind,role:c.role,name,fit:typeof c.fit==='string'&&c.fit.trim()?escapeCell(c.fit):''})
  const source=(c.name as SourceRef).source,link=`{{source:${source}.url}}`
  if(kind==='hotel')groups.hotel.push(`${name} | ${price} | ${rating} | ${area} | ${catchText} | | ${link}`+'\n')
  else groups[kind].push(`${name} | ${price} | ${reason} | ${catchText} ${link}`+'\n')
 }
 if(groups.hotel.length>6||groups.restaurant.length>5||groups.activity.length>5)return {error:'Candidate groups exceed renderer limits:6hotels,5restaurants,5activities.'}
 let body=i.body.trimEnd()
 const take=takeSection(picks)
 if('error'in take)return take
 if(take.text)body+='\n\n'+take.text
 // Provider-picks path: consolidated venue cards (why + hours + actions + source) are built from the validated provider records; appending a second set of option cards would duplicate the same venues.
 if(opts?.appendCards===false){const {itinerary_candidates:_c2,...rest2}=i;return {input:{...rest2,body},compiled:true}}
 if(groups.hotel.length){body+='\n\n## Hotels\n:::stay\n'+groups.hotel.join('')+':::';const reasons=i.itinerary_candidates.filter((c:any)=>c.kind==='hotel').map((c:any)=>typeof c.reason==='string'&&c.reason.trim()?escapeCell(c.reason):'unknown');body+='\n\nSelection reasons:\n'+reasons.map((r:string)=>'- '+r).join('\n')}
 for(const kind of ['restaurant','activity'] as const)if(groups[kind].length)body+='\n\n## '+(kind==='restaurant'?'Dining':'Activities')+'\n:::options\n'+groups[kind].join('')+':::'
 const {itinerary_candidates:_c,...rest}=i
 return {input:{...rest,body},compiled:true}
}

/** Finite metadata only. Never persist model arguments or source text. */
export function itineraryCandidateErrorCode(error:string):string {
 if(error.startsWith('File input'))return 'input'
 if(error.startsWith('Typed itinerary candidates'))return 'count_or_body'
 if(error.startsWith('Do not mix'))return 'manual_blocks'
 if(error.startsWith('Candidate facts require exact page-content source references'))return 'reference_type'
 if(error.startsWith('Unknown candidate reference'))return 'reference_key'
 if(error.startsWith('Candidate facts require exact page-content excerpt offsets'))return 'reference_shape'
 if(error.startsWith('Unknown source'))return 'unknown_source'
 if(error.startsWith('This source field'))return 'absent_field'
 if(error.startsWith('Invalid source excerpt'))return 'offset_range'
 if(error.startsWith('Excerpt cuts'))return 'offset_cut'
 if(error.startsWith('Candidate literal excerpt'))return 'excerpt_absent'
 if(error.startsWith('Candidate excerpt'))return 'empty_excerpt'
 if(error.startsWith('Candidate facts require a successful page'))return 'snippet'
 if(error.startsWith('Each candidate'))return 'candidate_type'
 if(error.startsWith('Candidate kind'))return 'kind'
 if(error.startsWith('Unknown candidate field'))return 'candidate_key'
 if(error.startsWith('Rating/area'))return 'hotel_only'
 if(error.startsWith('Candidate reason/catch'))return 'judgment_shape'
 if(error.startsWith('Candidate role:')||error.startsWith('Candidate role must'))return 'role'
 if(error.startsWith('Candidate fit')||error.startsWith('A favorite needs'))return 'fit'
 if(error.startsWith('Candidate groups'))return 'group_limit'
 return 'other'
}
