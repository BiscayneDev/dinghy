import {it,expect} from 'vitest'
import {SourceRecords} from '@/lib/files/source-records'
import {chooseVenuesPrompt,parseChosenVenues,venueVeto,chooseItineraryVenues} from '@/lib/files/itinerary-choose'
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

it('token lookup matches branded aliases but not unrelated names',()=>{
 expect(namedLookupMatch('Manna Life Food','Manna')).toBe(true)
 expect(namedLookupMatch('The Reed Hotel','Reed Hotel')).toBe(true)
 expect(namedLookupMatch('Lantern Table','Reed Workshop')).toBe(false)
})

it('end to end: model picks retain their explanations without a second judge',async()=>{
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
 expect(outcome.picks.map(p=>p.place.name)).toEqual(['Reed Hotel','Lantern Table','Reed Workshop','Harbor Guide'])
 expect(outcome.picks[0].why).toContain('rooftop pool')
})

it('a broken chooser response yields no picks and never throws',async()=>{
 const {records}=fixture()
 const outcome=await chooseItineraryVenues({request:'weekend',records,destination:'Harbor',json:async()=>'not json',signal:new AbortController().signal,verify:async()=>[]})
 expect(outcome.picks).toEqual([]);expect(outcome.chosen).toBe(0)
})

it('does not invoke an explanation judge',async()=>{
 const {records,page}=fixture();let calls=0
 await chooseItineraryVenues({request:'Harbor',records,destination:'Harbor',signal:new AbortController().signal,verify:async()=>[],json:async()=>{calls++;return JSON.stringify({venues:[{name:'Reed Hotel',kind:'hotel',why:'Courtyard rooms and a rooftop pool.',sourceId:page.id}]})}})
 expect(calls).toBe(1)
})

it('city words never turn different hotel names into a match',()=>{
 expect(namedLookupMatch('AC Hotel Harbor Quay','W Harbor')).toBe(false)
 expect(namedLookupMatch('AC Hotel Harbor Quay','AC Hotel Harbor Quay')).toBe(true)
 expect(namedLookupMatch('W Harbor','W Harbor')).toBe(true)
})
it('keeps a sourced venue when a model explanation exceeds the length cap',()=>{
 const {records,page}=fixture()
 const picks=parseChosenVenues({venues:[{name:'Reed Hotel',kind:'hotel',why:'Rooms with a rooftop pool. '+('Useful rooms. '.repeat(30)),sourceId:page.id}]},records)
 expect(picks).toHaveLength(1);expect(picks[0].why.length).toBeLessThanOrEqual(300)
})
it('binds composed page URLs and preserves the picked name across a provider alias',async()=>{
 const records=new SourceRecords();const page=records.capture('web_fetch',{url:'https://harbor.test/coast',content:'South Harbor Beach has coastal paths and picnic spots.'},'2030-01-01')[0]
 const out=await chooseItineraryVenues({request:'Harbor weekend',records,destination:'Harbor',signal:new AbortController().signal,json:async()=>JSON.stringify({venues:[{name:'South Harbor Beach',kind:'activity',why:'Coastal paths and picnic spots.',sourceUrl:page.url}]}),verify:async()=>[{line:1,kind:'activity',name:'South Harbor Pointe Beach',address:'Harbor',lat:1,lon:1,id:'fixture',source:page.id,start:0,end:18}]})
 expect(out.picks[0].place.name).toBe('South Harbor Beach');expect(out.picks[0].sourceId).toBe(page.id);expect(records.pageText(out.picks[0].place.source)?.slice(out.picks[0].place.start,out.picks[0].place.end)).toBe('South Harbor Beach')
})

import {readFileSync} from 'node:fs'
it('free conversation gives early composition the same schema and enough output room as the final turn',()=>{
 const source=readFileSync('src/lib/spectrum/dinghy.ts','utf8')
 expect(source).toContain('The exact response shape is')
 expect(source).toContain('max_tokens:1800')
 expect(source).not.toContain('max_tokens:composeNow?1800:800')
 expect(source).toContain("response_format:{type:'json_object'}")
 expect(source).toContain('step<20&&!signal.aborted')
 expect(source).toContain('Read-page sources available: ')
})
