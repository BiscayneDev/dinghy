import {it,expect} from 'vitest'
import {SourceRecords} from '@/lib/files/source-records'
import {chooseItineraryVenues} from '@/lib/files/itinerary-choose'
it('standard founders request keeps 2 hotels 3 dining 2 weekend picks with own sources even if Places has no match',async()=>{
 const records=new SourceRecords()
 const sources=[['hotel','Reed Inn','Courtyard rooms and rooftop pool.'],['hotel','Quay Suites','Suites with desks and a reading lounge.'],['restaurant','Lantern Table','Wood-fired fish and seasonal vegetables.'],['restaurant','Tern Bistro','French bistro dishes and a terrace.'],['restaurant','Rook Kitchen','Rice bowls and grilled vegetables.'],['activity','Shell Museum','Maritime paintings and model ships.'],['activity','Reed Gardens','Tropical plant paths and sculpture gardens.']]
 const request='I need to make an itinerary for some fictional founders who are coming to Harbor on Friday. They will be touring the fictional Harbor Founders offices in Quay at 10am, followed by some working sessions. They need some hotel and restaurant recommendations as well. And maybe some fun things to do for the weekend after our workday. Maybe a Harbor basketball game.'
 let searched=false
 const out=await chooseItineraryVenues({request,records,destination:'Harbor, FL',signal:new AbortController().signal,verify:async()=>[],research:async()=>{searched=true;for(const [_kind,name,why] of sources)records.capture('web_fetch',{url:'https://fictional.test/'+name.replace(/ /g,'-'),title:name,content:name+'\n'+why},'fictional')},json:async prompt=>prompt.startsWith('Light fact check')?JSON.stringify({checks:sources.map(([_k,name])=>({name,ok:true}))}):JSON.stringify({venues:sources.map(([kind,name,why],i)=>({kind,name,why,sourceId:'src'+(i+1)}))})})
 expect(searched).toBe(true)
 for(const [kind,min] of [['hotel',2],['restaurant',3],['activity',2]] as const)expect(out.picks.filter(p=>p.place.kind===kind).length).toBeGreaterThanOrEqual(min)
 for(const p of out.picks){expect(records.pageUrl(p.sourceId)).toMatch(/^https:/);expect(records.pageText(p.sourceId)).toContain(p.place.name);expect(records.pageText(p.sourceId)).toContain(p.why)}
})
