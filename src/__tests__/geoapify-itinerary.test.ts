import {it,expect,vi,afterEach} from 'vitest'
import {geoapifyPlaces,compileApiPlaces,apiPlaceMenu,GEOAPIFY_ATTRIBUTION} from '@/lib/files/geoapify-itinerary'
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
 expect(urls).toHaveLength(4);expect(places.filter(p=>p.kind==='activity')).toHaveLength(1);expect(places.map(p=>p.name)).toContain('Noriya')
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
