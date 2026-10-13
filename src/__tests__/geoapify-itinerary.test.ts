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
it('ambiguous destinations fail softly rather than choose an equal-ranked city',async()=>{
 vi.stubEnv('GEOAPIFY_API_KEY','fictional-secret');vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({results:[{lat:25,lon:-80,rank:{confidence:1}},{lat:26,lon:-81,rank:{confidence:1}}]}))))
 expect(await geoapifyPlaces('Harbor',['hotel'],new SourceRecords())).toBeNull()
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
