import {it,expect} from 'vitest'
import {SourceRecords} from '@/lib/files/source-records'
import {chooseVenuesPrompt,parseChosenVenues,venueVeto,venueSanityPrompt,parseSanityChecks,chooseItineraryVenues} from '@/lib/files/itinerary-choose'
import {namedLookupMatch,type ApiPlace} from '@/lib/files/geoapify-itinerary'

const PAGE='Harbor Guide\nThe Reed Hotel has courtyard rooms and a rooftop pool.\nLantern Table serves wood-fired fish and seasonal vegetables.\nReed Workshop offers hands-on printmaking sessions for visitors.'
function fixture(){
 const records=new SourceRecords()
 const page=records.capture('web_fetch',{url:'https://fictional.test/guide',title:'Harbor Guide',content:PAGE},'fictional')[0]
 return {records,page}
}
const place=(line:number,kind:'hotel'|'restaurant'|'activity',name:string,records:SourceRecords):ApiPlace=>{
 const rec=records.capture('web_fetch',{url:'https://www.geoapify.com/places-api/',title:'Geoapify venue listing',content:name+'\nKind: '+kind},'fictional-'+name)[0]
 return {line,kind,name,address:'100 Reed Street, Harbor, FL 33130, United States',lat:25.7,lon:-80.1,id:'id-'+name,source:rec.id,start:0,end:name.length}
}

it('chooser prompt supplies fetched public pages, never the provider record',()=>{
 const {records}=fixture()
 const prompt=chooseVenuesPrompt('weekend in Harbor',records)
 expect(prompt).toContain('Reed Hotel');expect(prompt).not.toContain('geoapify.com/places-api')
})

it('parse keeps literal named picks and drops invented, miscased-kind and over-cap rows',()=>{
 const {records,page}=fixture()
 const out=parseChosenVenues({venues:[
  {name:'Reed Hotel',kind:'hotel',why:'Courtyard rooms and a rooftop pool.',sourceId:page.id},
  {name:'Invented Inn',kind:'hotel',why:'Not on the page at all.',sourceId:page.id},
  {name:'Lantern Table',kind:'spa',why:'Wood-fired fish.',sourceId:page.id},
  {name:'Lantern Table',kind:'restaurant',why:'Wood-fired fish and seasonal vegetables.',sourceId:page.id},
  {name:'Lantern Table',kind:'restaurant',why:'Duplicate row with another why text.',sourceId:page.id},
  {name:'Reed Workshop',kind:'activity',why:'Visitors can join hands-on printmaking sessions.',sourceId:page.id},
  {name:'Short',kind:'activity',why:'too short',sourceId:page.id},
 ]},records)
 expect(out.map(v=>v.name)).toEqual(['Reed Hotel','Lantern Table','Reed Workshop'])
})

it('veto fires only on explicit closure text or a contradicting street address',()=>{
 expect(venueVeto('Reed Hotel','The Reed Hotel is permanently closed this year.','100 Reed Street')).toBe('closure')
 expect(venueVeto('Reed Hotel','Visit the Reed Hotel at 420 Reed Street.','100 Reed Street, Harbor')).toBe('address_conflict')
 expect(venueVeto('Reed Hotel','Visit the Reed Hotel at 100 Reed Street.','100 Reed Street, Harbor')).toBeNull()
 expect(venueVeto('Reed Hotel','The Reed Hotel has no listed hours here.','100 Reed Street')).toBeNull()
 expect(venueVeto('Missing Venue','Nothing here about it.','100 Reed Street')).toBeNull()
})

it('sanity checks parse to a per-name map and fail open on malformed output',()=>{
 expect(parseSanityChecks({checks:[{name:'Reed Hotel',ok:true},{name:'Lantern Table',ok:false}]})!.get('lantern table')).toBe(false)
 expect(parseSanityChecks({nope:1})).toBeNull()
 expect(venueSanityPrompt([{name:'Reed Hotel',kind:'hotel',why:'x',excerpt:'y'}])).toContain('Reed Hotel')
})

it('token lookup matches branded aliases but not unrelated names',()=>{
 expect(namedLookupMatch('Manna Life Food','Manna')).toBe(true)
 expect(namedLookupMatch('The Reed Hotel','Reed Hotel')).toBe(true)
 expect(namedLookupMatch('Lantern Table','Reed Workshop')).toBe(false)
})

it('end to end: verified picks carry explanations; sanity drops invented facts',async()=>{
 const {records,page}=fixture()
 const json=async (prompt:string)=>prompt.startsWith('Light fact check')?JSON.stringify({checks:[{name:'Reed Hotel',ok:true},{name:'Lantern Table',ok:false},{name:'Reed Workshop',ok:true}]}):JSON.stringify({venues:[
  {name:'Reed Hotel',kind:'hotel',why:'Courtyard rooms and a rooftop pool.',sourceId:page.id},
  {name:'Lantern Table',kind:'restaurant',why:'Invented tasting menu with wine pairings.',sourceId:page.id},
  {name:'Reed Workshop',kind:'activity',why:'Visitors can join hands-on printmaking sessions.',sourceId:page.id},
  {name:'Harbor Guide',kind:'activity',why:'On the page but never verified by Places.',sourceId:page.id},
 ]})
 const verify=async(noms:{name:string;kind:'hotel'|'restaurant'|'activity'}[],r:SourceRecords)=>noms.filter(n=>n.name!=='Harbor Guide').map((n,i)=>place(i+1,n.kind,n.name,r))
 const outcome=await chooseItineraryVenues({request:'weekend in Harbor',records,destination:'Harbor, FL',json,signal:new AbortController().signal,verify})
 expect(outcome.chosen).toBe(4);expect(outcome.verified).toBe(3)
 expect(outcome.picks.map(p=>p.place.name)).toEqual(['Reed Hotel','Reed Workshop'])
 expect(outcome.picks[0].why).toContain('rooftop pool')
})

it('a broken chooser response yields no picks and never throws',async()=>{
 const {records}=fixture()
 const outcome=await chooseItineraryVenues({request:'weekend',records,destination:'Harbor',json:async()=>'not json',signal:new AbortController().signal,verify:async()=>[]})
 expect(outcome.picks).toEqual([]);expect(outcome.chosen).toBe(0)
})

it('sanity excerpt stays in the exact hotel section, not a neighborhood above it',async()=>{
 const records=new SourceRecords(),page=records.capture('web_fetch',{url:'https://fictional.test/stays',title:'Harbor stays',content:'### Beach neighborhood\nBeach access and personal goods shops.\n#### Reed Hotel\nRooftop pool with city views.\n#### Another Inn\nHas a spa.'},'fictional')[0]
 let excerpt=''
 await chooseItineraryVenues({request:'Harbor hotel',records,destination:'Harbor',signal:new AbortController().signal,verify:async(_n,r)=>[place(1,'hotel','Reed Hotel',r)],json:async prompt=>{
 if(prompt.startsWith('Light fact check')){excerpt=prompt;return JSON.stringify({checks:[{name:'Reed Hotel',ok:false}]})}
 return JSON.stringify({venues:[{name:'Reed Hotel',kind:'hotel',why:'Has beach access and nearby personal goods shops.',sourceId:page.id}]})
 }})
 expect(excerpt).toContain('Rooftop pool');expect(excerpt).not.toContain('Beach neighborhood');expect(excerpt).not.toContain('Has a spa.')
})

it('sanity can correct a mixed-up feature using venue section prose',async()=>{
 const {records,page}=fixture()
 const outcome=await chooseItineraryVenues({request:'Harbor hotel',records,destination:'Harbor',signal:new AbortController().signal,verify:async(_n,r)=>[place(1,'hotel','Reed Hotel',r)],json:async prompt=>prompt.startsWith('Light fact check')?JSON.stringify({checks:[{name:'Reed Hotel',ok:false,why:'Courtyard rooms and a rooftop pool.'}]}):JSON.stringify({venues:[{name:'Reed Hotel',kind:'hotel',why:'Has beach access and nearby personal goods shops.',sourceId:page.id}]})})
 expect(outcome.picks[0].why).toBe('Courtyard rooms and a rooftop pool.')
})

it('city words never turn different hotel names into a match',()=>{
 expect(namedLookupMatch('AC Hotel Harbor Quay','W Harbor')).toBe(false)
 expect(namedLookupMatch('AC Hotel Harbor Quay','AC Hotel Harbor Quay')).toBe(true)
 expect(namedLookupMatch('W Harbor','W Harbor')).toBe(true)
})
