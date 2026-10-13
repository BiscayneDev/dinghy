import {activityResearchSlate} from '@/lib/files/geoapify-itinerary'
import {it,expect,vi,afterEach} from 'vitest'
import {geoapifyPlaces,compileApiPlaces,apiPlaceMenu,GEOAPIFY_ATTRIBUTION,apiReasonFacts,applyApiReasons,apiReasonPrompt,researchApiReasons,venueReasonSentence} from '@/lib/files/geoapify-itinerary'
import {SourceRecords} from '@/lib/files/source-records'
import {compileItineraryCandidates} from '@/lib/files/itinerary-candidates'
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals()})
it('missing key and API errors fail soft without leaking secret URLs',async()=>{
 vi.stubEnv('GEOAPIFY_API_KEY','');expect(await geoapifyPlaces('Harbor',['hotel'],new SourceRecords())).toBeNull()
 vi.stubEnv('GEOAPIFY_API_KEY','fictional-secret');vi.stubGlobal('fetch',vi.fn(async()=>new Response('',{status:500})))
 expect(await geoapifyPlaces('Harbor',['restaurant'],new SourceRecords())).toBeNull()
})
it('per-kind calls preserve exact names and addresses, drop nameless and street attractions, dedupe IDs',async()=>{
 vi.stubEnv('GEOAPIFY_API_KEY','fictional-secret');const urls:URL[]=[]
 vi.stubGlobal('fetch',vi.fn(async(u:URL)=>{
  urls.push(u)
  if(u.pathname.includes('geocode'))return new Response(JSON.stringify({results:[{lat:25,lon:-80,rank:{confidence:1}}]}))
  const cat=u.searchParams.get('categories')!,kind=cat.startsWith('catering')?'restaurant':cat.startsWith('accommodation')?'hotel':'activity'
  const p={name:kind==='hotel'?'Unfolded, Signature Collection':kind==='restaurant'?'Noriya':'Tide Museum',categories:[cat],formatted:'42 Quay St, Harbor',lat:25,lon:-80,place_id:kind}
  return new Response(JSON.stringify({features:[{properties:p},{properties:p},{properties:{...p,name:'',place_id:'blank'}},{properties:{...p,name:'Quay Road',place_id:'street',datasource:{raw:{highway:'pedestrian'}}}}]}))
 }))
 const r=new SourceRecords(),places=(await geoapifyPlaces('Harbor',['hotel','restaurant','activity'],r))!
 expect(urls).toHaveLength(5);expect(places.filter(p=>p.kind==='activity')).toHaveLength(1);expect(places.map(p=>p.name)).toContain('Noriya')
 expect(apiPlaceMenu(places)).toContain('42 Quay St');expect(r.pageIds().every(id=>!r.pageUrl(id)!.includes('fictional-secret'))).toBe(true)
 const result=compileApiPlaces({candidates:places.filter(p=>p.id!=='street').map(p=>({kind:p.kind,line:p.line}))},places,r)
 if('error'in result)throw new Error(result.error)
 expect(result.candidates).toHaveLength(3)
 expect('error'in compileItineraryCandidates({body:'## Friday',itinerary_candidates:result.candidates},r)).toBe(false)
 const mismatch=compileApiPlaces({candidates:[{kind:'restaurant',line:places.find(p=>p.kind==='hotel')!.line}]},places,r)
 expect(mismatch.dropped).toContain('kind_mismatch');expect(GEOAPIFY_ATTRIBUTION).toContain('© OpenStreetMap contributors')
})
it('top city rank wins equal confidence without a country filter or bias',async()=>{
 vi.stubEnv('GEOAPIFY_API_KEY','fictional-secret');let filter=''
 vi.stubGlobal('fetch',vi.fn(async(u:URL)=>{
  if(u.pathname.includes('geocode')){expect(u.searchParams.get('type')).toBe('city');expect(u.searchParams.has('filter')).toBe(false);return new Response(JSON.stringify({results:[{lat:26,lon:-81,result_type:'city',rank:{confidence:1,importance:0.2}},{lat:25,lon:-80,result_type:'city',rank:{confidence:1,importance:0.8}}]}))}
  filter=u.searchParams.get('filter')!;return new Response(JSON.stringify({features:[{properties:{name:'Harbor Inn',categories:['accommodation.hotel'],lat:25,lon:-80,place_id:'fictional'}}]}))
 }))
 expect(await geoapifyPlaces('Harbor',['hotel'],new SourceRecords())).not.toBeNull();expect(filter).toBe('circle:-80,25,4000')
})
it('safe fallback reasons never contain the key or API URL',async()=>{
 vi.stubEnv('GEOAPIFY_API_KEY','fictional-secret');let reason=''
 const cb=(r:string)=>{reason=r}
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('',{status:403})))
 expect(await geoapifyPlaces('Harbor',['hotel'],new SourceRecords(),undefined,cb)).toBeNull();expect(reason).toBe('geocode_error_403')
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({results:[]}))))
 await geoapifyPlaces('Harbor',['hotel'],new SourceRecords(),undefined,cb);expect(reason).toBe('geocode_empty')
 vi.stubGlobal('fetch',vi.fn(async()=>{throw new DOMException('fictional-secret','TimeoutError')}))
 await geoapifyPlaces('Harbor',['hotel'],new SourceRecords(),undefined,cb);expect(reason).toBe('timeout');expect(reason).not.toMatch(/secret|https/)
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({results:[{lat:25,lon:-80,rank:{confidence:0.1}}]}))))
 await geoapifyPlaces('Harbor',['hotel'],new SourceRecords(),undefined,cb);expect(reason).toBe('geocode_low_confidence')
})
it('web reasons are confined to the selected provider venue section',()=>{
 const r=new SourceRecords(),rec=r.capture('web_fetch',{url:'https://www.geoapify.com/places-api/',title:'Geoapify listing',content:`Lantern Cafe
Address: 42 Quay St`},'2026-01-01T00:00:00Z')[0]
 const p={line:1,kind:'restaurant' as const,name:'Lantern Cafe',address:'42 Quay St',lat:25,lon:-80,id:'fictional',source:rec.id,start:0,end:12}
 r.capture('web_fetch',{url:'https://fictional.test/dining',title:'Harbor dining',content:`## Lantern Cafe
Lantern Cafe serves healthy bowls beside the quay.
## Rook Kitchen
Rook Kitchen serves seafood.`},'2026-01-01T00:00:00Z')
 const o=compileApiPlaces({candidates:[{kind:'restaurant',line:1}]},[p],r)
 if('error'in o)throw new Error(o.error)
 expect(o.candidates[0].reason).toContain('healthy bowls');expect(o.candidates[0].reason).not.toContain('seafood')
})

it('malformed picks cannot leave any available provider kind empty; fallback prefers cuisine/type then distance',()=>{
 const r=new SourceRecords()
 const specs=[['hotel','Harbor Inn',0.1,'',''],['restaurant','Quay Cafe',0.1,'',''],['restaurant','Lantern Cafe',0.2,'vegetarian',''],['restaurant','Reed Kitchen',0.3,'thai',''],['restaurant','Grove Table',0.4,'italian',''],['activity','Quay Landmark',0.1,'',''],['activity','Tide Museum',0.2,'','museum']]
 const places=specs.map(([kind,name,distance,cuisine,attractionType],i)=>{const rec=r.capture('web_fetch',{url:'https://www.geoapify.com/places-api/',content:String(name)},'2026-01-01T00:00:00Z')[0];return {line:i+1,kind:kind as 'hotel'|'restaurant'|'activity',name:String(name),distance:Number(distance),cuisine:String(cuisine),attractionType:String(attractionType),address:'',lat:25,lon:-80,id:String(i),source:rec.id,start:0,end:String(name).length}})
 for(const input of [null,{}, {candidates:[null,{kind:'restaurant',line:1},{kind:'restaurant',line:9999}]}]){
  const o=compileApiPlaces(input,places,r);if('error'in o)throw new Error(o.error)
  expect(o.candidates.filter(c=>c.kind==='restaurant')).toHaveLength(3)
  expect(o.candidates.filter(c=>c.kind==='hotel')).toHaveLength(1)
  const names=o.candidates.map(c=>r.resolve(c.name)).map(v=>'value'in v?v.value:'')
  expect(names).not.toContain('Quay Cafe');expect(names.indexOf('Tide Museum')).toBeLessThan(names.indexOf('Quay Landmark'))
 }
})
it('decodes provider identities before offsets and excludes ports and infrastructure attractions',async()=>{
 vi.stubEnv('GEOAPIFY_API_KEY','fictional-key')
 vi.stubGlobal('fetch',vi.fn(async(u:URL)=>{
  if(u.pathname.includes('geocode'))return new Response(JSON.stringify({results:[{lat:25,lon:-80}]}))
  const props=(name:string,id:string,raw:Record<string,string>={},cats=['tourism.attraction'])=>({name,place_id:id,categories:cats,lat:25,lon:-80,formatted:'42 Quay St &amp;amp; Harbor',datasource:{raw}})
  return new Response(JSON.stringify({features:[props('Tour Boat Boarding','boarding'),props('Quay Dock','dock'),props('Harbor Ferry','ferry'),props('Quay Tour-Boat','boat'),props('Quay Landmark','tagged',{},['tourism.attraction','tourism.attraction.boat_boarding']),props('Port of Harbor','port'),props('Quay Station','station'),props('Quay Landmark','transport',{},['tourism.attraction','transport.bus']),props('Quay Waterworks','works',{man_made:'works'}),props('Tide &amp;amp; Reed Museum','museum',{tourism:'museum'})].map(properties=>({properties}))}))
 }))
 const r=new SourceRecords(),places=(await geoapifyPlaces('Harbor',['activity'],r))!
 expect(places).toHaveLength(1);expect(places[0].name).toBe('Tide & Reed Museum');expect(places[0].address).toBe('42 Quay St & Harbor');expect(places[0].attractionType).toBe('museum');expect(r.resolve({source:places[0].source,field:'content',start:0,end:places[0].end})).toMatchObject({value:'Tide & Reed Museum'})
})

it('routed-model why accepts only exact facts for that venue, never extra quality, hours or distance claims',()=>{
 const r=new SourceRecords(),name='Lantern Cafe',rec=r.capture('web_fetch',{url:'https://www.geoapify.com/places-api/',content:name},'2026-01-01T00:00:00Z')[0]
 const p={line:1,kind:'restaurant' as const,name,address:'42 Quay St',cuisine:'thai',lat:25,lon:-80,id:'fictional',source:rec.id,start:0,end:name.length}
 const compiled=compileApiPlaces(null,[p],r);if('error'in compiled)throw new Error(compiled.error)
 const facts=apiReasonFacts(p,r)
 expect(apiReasonPrompt(compiled.candidates,[p],r)).toContain('thai cuisine')
 expect(compiled.candidates[0].reason).not.toMatch(/not independently|unverified/)
 expect(compiled.candidates[0].catch).not.toContain('unverified')
 for(const why of ['Best Thai food near your office.',facts[0]+' Open until 10pm.',facts[0].replace('thai','italian'),'Rook Kitchen: provider lists thai cuisine.'])expect(applyApiReasons({reasons:[{line:1,why}]},compiled.candidates,[p],r)).toEqual({accepted:0,rejected:1})
 expect(applyApiReasons({reasons:[{line:1,why:facts[0]}]},compiled.candidates,[p],r)).toEqual({accepted:1,rejected:0})
 expect(compiled.candidates[0].reason).toBe(facts[0])
})
it('per-venue lookup uses fetched named sentences, never snippets or other-city pages',async()=>{
 const r=new SourceRecords(),name='Lantern Cafe',rec=r.capture('web_fetch',{url:'https://www.geoapify.com/places-api/',content:name},'2026-01-01T00:00:00Z')[0]
 const p={line:1,kind:'restaurant' as const,name,address:'42 Quay St',cuisine:'thai',lat:25,lon:-80,id:'fictional',source:rec.id,start:0,end:name.length}
 const o=compileApiPlaces(null,[p],r);if('error'in o)throw new Error(o.error)
 const sentence='Lantern Cafe serves wood-fired noodles and seasonal vegetable bowls.'
 let query=''
 const search=async(q:string)=>{query=q;return {results:[{url:'https://fictional.test/cafe',content:'Lantern Cafe has a rooftop pool.'}]}},read=async()=>({title:'Lantern Cafe in Harbor',content:'Harbor dining. '+sentence+' Rook Kitchen serves seafood.'})
 expect(await researchApiReasons(o.candidates,[p],'Harbor',r,{search,read})).toEqual({found:1,missing:0});expect(query).toContain('"Lantern Cafe" Harbor restaurant')
 expect(o.candidates[0].reason).toBe(sentence);expect(o.candidates[0].reason).not.toContain('pool');expect((p as {webSource?:string}).webSource).toBeTruthy();expect(apiReasonFacts(p,r)).toEqual([sentence])
 expect(applyApiReasons({reasons:[{line:1,why:'Lantern Cafe: provider lists thai cuisine.'}]},o.candidates,[p],r)).toEqual({accepted:0,rejected:1})
 expect(venueReasonSentence(p,'Other City','Harbor dining. '+sentence)).toBe('');expect(venueReasonSentence(p,'Harbor','Harbor dining. Rook Kitchen serves seafood.')).toBe('')
 expect(venueReasonSentence(p,'Harbor','Harbor dining. Lantern Cafe is the best restaurant open until 10pm.')).toBe('')
})
it('timeout prevents late source commits and keeps address-free fallback',async()=>{
 const r=new SourceRecords(),name='Reed Kitchen',rec=r.capture('web_fetch',{url:'https://www.geoapify.com/places-api/',content:name},'2026-01-01T00:00:00Z')[0]
 const p={line:1,kind:'restaurant' as const,name,address:'42 Quay St',cuisine:'thai',lat:25,lon:-80,id:'fictional',source:rec.id,start:0,end:name.length}
 const o=compileApiPlaces(null,[p],r);if('error'in o)throw new Error(o.error)
 const io={search:async()=>({results:[{url:'https://fictional.test/reed'}]}),read:async()=>{await new Promise(resolve=>setTimeout(resolve,35));return {content:'Harbor dining. Reed Kitchen serves wood-fired noodle bowls.'}}}
 expect(await researchApiReasons(o.candidates,[p],'Harbor',r,io,5)).toEqual({found:0,missing:1});await new Promise(resolve=>setTimeout(resolve,50));expect(r.pageIds()).toHaveLength(1)
 expect(o.candidates[0].reason).toContain('thai cuisine');expect(o.candidates[0].reason).not.toContain('42 Quay')
})
it('excludes bare artworks and widens sparse activity coverage to named leisure venues',async()=>{
 vi.stubEnv('GEOAPIFY_API_KEY','fictional-key');const urls:URL[]=[]
 vi.stubGlobal('fetch',vi.fn(async(u:URL)=>{
  urls.push(u);if(u.pathname.includes('geocode'))return new Response(JSON.stringify({results:[{lat:25,lon:-80}]}))
  const widened=u.searchParams.get('filter')!.endsWith(',10000')
  const p=(name:string,id:string,categories:string[],raw:Record<string,string>={})=>({properties:{name,place_id:id,categories,datasource:{raw},lat:25,lon:-80}})
  return new Response(JSON.stringify({features:widened?[p('Tide Museum','museum',['entertainment.museum']),p('Reed Park','park',['leisure.park']),p('Harbor Beach','beach',['beach']),p('Quay Plaque','plaque',['tourism.attraction'],{historic:'memorial'})]:[p('Quay Artwork','art',['tourism.attraction.artwork']),p('Quay Statue','statue',['tourism.attraction'],{tourism:'artwork'}),p('Quay Mural','mural',['tourism.attraction'],{artwork_type:'mural'})]}))
 }))
 const out=(await geoapifyPlaces('Harbor',['activity'],new SourceRecords()))!
 expect(out.map(p=>p.name)).toEqual(['Tide Museum','Reed Park','Harbor Beach']);expect(urls).toHaveLength(3);expect(urls[2].searchParams.get('categories')).toContain('entertainment.museum');expect(urls[2].searchParams.get('filter')).toBe('circle:-80,25,10000')
})

it('broad activity research is not skipped merely because incidental downtown listings exist',async()=>{
 vi.stubEnv('GEOAPIFY_API_KEY','fictional');const urls:URL[]=[]
 vi.stubGlobal('fetch',vi.fn(async u=>{const url=new URL(String(u));urls.push(url);if(url.pathname.includes('geocode'))return new Response(JSON.stringify({results:[{lat:25,lon:-80}]}));const wide=url.searchParams.get('filter')!.endsWith(',10000');const names=wide?['Tide Museum']:['Quay Marker','Reed Marker','Grove Marker'];return new Response(JSON.stringify({features:names.map((name,i)=>({properties:{name,categories:[wide?'entertainment.museum':'tourism.attraction'],lat:25,lon:-80,place_id:name,formatted:'Harbor'}}))}))}))
 const out=(await geoapifyPlaces('Harbor',['activity'],new SourceRecords()))!;expect(out.map(p=>p.name)).toContain('Tide Museum');expect(urls).toHaveLength(3);expect(urls[2].searchParams.get('categories')).not.toContain('tourism.attraction');expect(urls[1].searchParams.get('categories')).toBe('tourism.attraction')
})

it('research slate samples diverse experience subtypes without granting a type recommendation',()=>{
 const make=(line:number,type:string)=>({line,kind:'activity' as const,name:'Fictional '+line,address:'',lat:0,lon:0,id:String(line),source:'src'+line,start:0,end:1,attractionType:type})
 const places=[make(1,'marker'),make(2,'marker'),make(3,'marker'),make(4,'museum'),make(5,'garden'),make(6,'unusual_workshop')]
 expect(activityResearchSlate(places,new Set(['src1']),3).map(p=>p.line)).toEqual([1,2,4,5])
})
