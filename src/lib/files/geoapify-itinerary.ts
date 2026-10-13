import {SourceRecords} from './source-records'
export type PlaceKind='hotel'|'restaurant'|'activity'
export type ApiPlace={line:number;kind:PlaceKind;name:string;address:string;lat:number;lon:number;id:string;source:string;start:number;end:number}
export const GEOAPIFY_ATTRIBUTION='Venue names, categories and addresses: Geoapify · © OpenStreetMap contributors. Provider listings do not confirm current hours, availability, prices or quality.'
const categories:Record<PlaceKind,string>={hotel:'accommodation.hotel',restaurant:'catering.restaurant',activity:'tourism.attraction'}
const num=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x)
/** Requests are bounded and sequential (four at most), below the provider's 5 requests/second plan limit. Never log URL/errors with the secret. */
export async function geoapifyPlaces(destination:string,kinds:PlaceKind[],records:SourceRecords,signal?:AbortSignal,onFallback?:(reason:string)=>void):Promise<ApiPlace[]|null>{
 const fail=(reason:string)=>{onFallback?.(reason);return null}
 const key=process.env.GEOAPIFY_API_KEY;if(!key)return fail('missing_key');if(!destination.trim())return fail('geocode_empty')
 let phase='geocode'
 let status:number|undefined
 const get=async(path:string,params:Record<string,string>)=>{
  const u=new URL('https://api.geoapify.com/'+path);for(const [k,v] of Object.entries({...params,apiKey:key}))u.searchParams.set(k,v)
  const ac=AbortSignal.timeout(6000),r=await fetch(u,{signal:signal?AbortSignal.any([signal,ac]):ac});if(!r.ok){status=r.status;throw new Error('Provider request failed')};return r.json()
 }
 try{
  const geo=await get('v1/geocode/search',{text:destination,type:'city',limit:'5',format:'json'}) as {results?:{lat?:unknown;lon?:unknown;result_type?:string;rank?:{importance?:number;confidence?:number;confidence_city_level?:number}}[]}
  const hits=(geo.results||[]).filter(h=>num(h.lat)&&num(h.lon))
  const score=(h:typeof hits[number])=>(h.result_type==='city'?10:0)+(h.rank?.importance??0)+(h.rank?.confidence_city_level??h.rank?.confidence??0)
  const anchor=[...hits].sort((a,b)=>score(b)-score(a))[0]
  if(!anchor)return fail('geocode_empty')
  const confidence=anchor.rank?.confidence_city_level??anchor.rank?.confidence
  if(confidence!==undefined&&confidence<0.3)return fail('geocode_low_confidence')
  phase='places'
  const out:ApiPlace[]=[],seen=new Set<string>(),providerRecords=new SourceRecords()
  for(const kind of kinds){
   await new Promise(resolve=>setTimeout(resolve,210))
   const data=await get('v2/places',{categories:categories[kind],filter:`circle:${anchor.lon},${anchor.lat},4000`,bias:`proximity:${anchor.lon},${anchor.lat}`,limit:'20'}) as {features?:{properties?:Record<string,unknown>}[]}
   for(const f of data.features||[]){
    const p=f.properties||{},name=typeof p.name==='string'?p.name.trim():'',cats=Array.isArray(p.categories)?p.categories.filter((c):c is string=>typeof c==='string'):[]
    if(!name||name.length>120||/[\n\r|<>]/.test(name)||!cats.some(c=>c===categories[kind]||c.startsWith(categories[kind]+'.'))||!num(p.lat)||!num(p.lon)||typeof p.place_id!=='string'||/[\n\r|<>]/.test(p.place_id))continue
    const raw=(p.datasource as {raw?:Record<string,unknown>}|undefined)?.raw||{}
    if(kind==='activity'&&(cats.some(c=>/^transport\.|^commercial\.|^accommodation\.|^catering\./.test(c))||raw.highway||raw.place||/\b(?:street|road|avenue|boulevard)\b/i.test(name)))continue
    const identity=p.place_id;if(seen.has(identity))continue;seen.add(identity)
    const address=typeof p.formatted==='string'?p.formatted.replace(/[\n\r|<>]/g,' ').slice(0,300):''
    const content=`${name}\nKind: ${kind}\nAddress: ${address||'Not supplied'}\nCoordinates: ${p.lat}, ${p.lon}\nProvider place ID: ${identity}\n${GEOAPIFY_ATTRIBUTION}`
    // Public documentation link, never an API URL containing a key. Content explicitly labels provider data.
    const rec=providerRecords.capture('web_fetch',{url:'https://www.geoapify.com/places-api/',title:'Geoapify venue listing',content},new Date().toISOString())[0]
    out.push({line:out.length+1,kind,name,address,lat:p.lat,lon:p.lon,id:identity,source:rec.id,start:0,end:name.length})
   }
  }
  if(!out.length)return fail('zero_results')
  for(const p of out){const rec=records.capture('web_fetch',{url:'https://www.geoapify.com/places-api/',title:'Geoapify venue listing',content:providerRecords.pageText(p.source)},new Date().toISOString())[0];p.source=rec.id}
  return out
 }catch(error){return fail(status?`${phase}_error_${status}`:signal?.aborted||error instanceof Error&&/abort|timeout/i.test(error.name)?'timeout':`${phase}_error`)}
}
export function apiPlaceMenu(places:ApiPlace[]):string{
 return 'Typed Geoapify venue listings. Choose the places that fit the request by line number. Kind is fixed by the provider category and cannot be changed. Names and addresses are provider data, not proof of quality, hours, prices or availability. Do not select streets, generic areas or mismatched types. Each line: line | kind | complete name | address.\n'+places.map(p=>`L${p.line} | ${p.kind} | ${p.name} | ${p.address||'Address not supplied'}`).join('\n')
}
/** Reason is restricted to the exact selected name's own page section; API name/kind never come from web prose. */
function reasonFor(p:ApiPlace,records:SourceRecords):string{
 for(const source of records.pageIds()){
  if(source===p.source)continue
  const text=records.pageText(source)||'',at=text.toLowerCase().indexOf(p.name.toLowerCase());if(at<0)continue
  const lineEnd=text.indexOf('\n',at)
  const previous=text.slice(0,lineEnd<0?text.length:lineEnd).split('\n').reverse().find(l=>/^\s*#{1,6}\s/.test(l))
  if(!previous||!previous.toLowerCase().includes(p.name.toLowerCase()))continue
  const tail=text.slice(at,at+700).split(/\n\s*#{1,6}\s/)[0]
  const sentence=tail.split(/(?<=[.!?])\s+|\n+/).map(x=>x.replace(/[*_`]/g,'').trim()).find(x=>x.toLowerCase().includes(p.name.toLowerCase())&&x.split(/\s+/).length>=6&&x.length<=260&&!/[$€£]|\b(?:we|our|I|my|us)\b|\|/i.test(x))
  if(sentence){
   const otherNames=records.pageIds().filter(id=>id!==p.source).flatMap(id=>(records.pageText(id)||'').split('\n').filter(l=>/^\s*#{1,6}\s/.test(l)).map(l=>l.replace(/^\s*#{1,6}\s*/,''))).filter(n=>n&&!n.toLowerCase().includes(p.name.toLowerCase()))
   if(!otherNames.some(n=>sentence.toLowerCase().includes(n.toLowerCase())))return sentence
  }
 }
 return 'Listed by Geoapify as '+(p.kind==='hotel'?'a hotel':p.kind==='restaurant'?'a restaurant':'an attraction')+'. Fit, hours and availability not independently confirmed.'
}
export function compileApiPlaces(input:unknown,places:ApiPlace[],records:SourceRecords):{candidates:Record<string,unknown>[];dropped:string[];previews:string[]}|{error:string;dropped:string[];previews:string[]}{
 const list=(input as {candidates?:unknown}|null)?.candidates;if(!Array.isArray(list))return {error:'Choose typed venue line numbers.',dropped:['empty'],previews:[]}
 const candidates:Record<string,unknown>[]=[],dropped:string[]=[],seen=new Set<string>(),counts:Record<string,number>={hotel:0,restaurant:0,activity:0}
 for(const item of list){const p=places.find(p=>p.line===item?.line);if(!p){dropped.push('line_unknown');continue}if(item.kind!==p.kind){dropped.push('kind_mismatch');continue}if(seen.has(p.id)||counts[p.kind]>=3){dropped.push('duplicate_or_limit');continue}seen.add(p.id);counts[p.kind]++
  candidates.push({kind:p.kind,name:{source:p.source,field:'content',start:p.start,end:p.end},reason:reasonFor(p,records),catch:`${p.address?'Address: '+p.address+'. ':''}Provider-listed; hours, prices and availability unverified`,...(p.kind==='hotel'&&p.address?{area:{source:p.source,field:'content',excerpt:p.address}}:{})})
 }
 return candidates.length?{candidates,dropped,previews:[]}:{error:'No typed provider venue selected.',dropped,previews:[]}
}
