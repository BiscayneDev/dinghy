import {it,expect,vi,afterEach} from 'vitest'
import {resolveDestination} from '@/lib/files/itinerary-view'
import {geoapifyPlaces} from '@/lib/files/geoapify-itinerary'
import {SourceRecords} from '@/lib/files/source-records'
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals()})
it('anchors the geocode query on the named city, never concatenated neighborhood tokens',()=>{
 const r=resolveDestination('Itinerary for partners coming to Miami, meetings in the North Wharf district, then a weekend of fun.')
 expect(r?.query).toBe('miami');expect(r?.states).toEqual([])
})
it('captures a state correction as a disambiguation hint, not query text',()=>{
 const r=resolveDestination('No, Miami Florida')
 expect(r?.query).toBe('miami');expect(r?.states).toEqual(['florida'])
})
it('fails closed when no usable city phrase exists',()=>{
 expect(resolveDestination('dinner near the Wharf sometime')).toBeNull()
})
const geocode=(results:unknown[])=>new Response(JSON.stringify({results}))
const miamiFl={lat:25.76,lon:-80.19,result_type:'city',city:'Miami',state:'Florida',state_code:'FL',country:'United States',country_code:'US',rank:{importance:0.91,confidence:0.6}}
const miamiOk={lat:36.87,lon:-94.87,result_type:'city',city:'Miami',state:'Oklahoma',state_code:'OK',country:'United States',country_code:'US',rank:{importance:0.42,confidence:1}}
it('the prominent city wins over a same-named small city even at lower confidence',async()=>{
 vi.stubEnv('GEOAPIFY_API_KEY','fictional-secret');let filter=''
 vi.stubGlobal('fetch',vi.fn(async(u:URL)=>{
  if(u.pathname.includes('geocode'))return geocode([miamiOk,miamiFl])
  filter=u.searchParams.get('filter')!;return new Response(JSON.stringify({features:[]}))
 }))
 const resolved:{label?:string}={}
 expect(await geoapifyPlaces('miami',['hotel'],new SourceRecords(),undefined,undefined,{resolved})).toBeNull()
 expect(filter).toContain('-80.19,25.76');expect(resolved.label).toBe('Miami, FL, US')
})
it('a state hint filters to the matching state and mismatches fail closed',async()=>{
 vi.stubEnv('GEOAPIFY_API_KEY','fictional-secret');let filter='',reason=''
 vi.stubGlobal('fetch',vi.fn(async(u:URL)=>{
  if(u.pathname.includes('geocode'))return geocode([miamiOk,miamiFl])
  filter=u.searchParams.get('filter')!;return new Response(JSON.stringify({features:[]}))
 }))
 await geoapifyPlaces('miami',['hotel'],new SourceRecords(),undefined,undefined,{states:['florida']})
 expect(filter).toContain('-80.19,25.76')
 await geoapifyPlaces('miami',['hotel'],new SourceRecords(),undefined,r=>{reason=r},{states:['nevada']})
 expect(reason).toBe('geocode_place_mismatch')
})
it('latest correction supersedes a prior city and state without losing the contract',()=>{
 const marker='\n\nLatest user correction (supersedes conflicting details above): '
 const r=resolveDestination('Make an itinerary in Miami Oklahoma.'+marker+'No, Miami Florida…')
 expect(r?.query).toBe('miami');expect(r?.states).toEqual(['florida']);expect(r?.states).not.toContain('oklahoma')
 const changed=resolveDestination('Make an itinerary in Boston Massachusetts.'+marker+'Actually Miami Florida.')
 expect(changed?.query).toBe('miami');expect(changed?.states).toEqual(['florida'])
 const stateOnly=resolveDestination('Make an itinerary in Miami Oklahoma.'+marker+'No, Florida instead.')
 expect(stateOnly?.query).toBe('miami');expect(stateOnly?.states).toEqual(['florida'])
})
