import {it,expect} from 'vitest'
import {SourceRecords} from '@/lib/files/source-records'
import {buildPageView,compileQuoteSelection,extractLineName,completeNameSpan} from '@/lib/files/itinerary-view'
it('takes the complete capitalized run and rejects marketing headings',()=>{
 expect(extractLineName('Kestrel Harbor Hotel & Residences has quiet rooms.')).toBe('Kestrel Harbor Hotel & Residences')
 for(const t of ['Taste It All','Discover Harbor Dining','Explore Local Restaurants','Must-Try Restaurants','Guide To Dining'])expect(extractLineName(t)).toBeNull()
})
it('source offsets cannot cut a prefix or suffix of a longer name',()=>{
 const text='Kestrel Harbor Hotel & Residences has rooms.'
 const at=text.indexOf('Harbor Hotel')
 expect(completeNameSpan(text,at,at+'Harbor Hotel'.length)).toBe(false)
 expect(completeNameSpan(text,0,'Kestrel Harbor Hotel & Residences'.length)).toBe(true)
 expect(completeNameSpan('Visit Harbor Hotel, rooms available.',6,18)).toBe(true)
})
it('rejects an injected chopped view even when its name is literal and verifier says yes',async()=>{
 const r=new SourceRecords();r.capture('web_fetch',{url:'https://fictional.test/stays',title:'Harbor hotels',content:'Kestrel Harbor Hotel & Residences has rooms in Harbor.'},'2026-01-01T00:00:00Z')
 const v=buildPageView(r),e=v.entries[0];e.name='Harbor Hotel'
 const o=await compileQuoteSelection({candidates:[{kind:'hotel',line:e.n}]},r,'hotels in Harbor',async()=>true,v.entries)
 expect(o.dropped).toContain('name_fragment');expect('error' in o).toBe(true)
})
it('ambiguous short headings lose to a full source name elsewhere on the page',async()=>{
 const r=new SourceRecords();r.capture('web_fetch',{url:'https://fictional.test/stays',title:'Harbor hotels',content:'## Harbor Hotel\nKestrel Harbor Hotel & Residences has rooms in Harbor.'},'2026-01-01T00:00:00Z')
 const v=buildPageView(r),line=v.entries.find(e=>e.name==='Harbor Hotel')!.n
 const o=await compileQuoteSelection({candidates:[{kind:'hotel',line}]},r,'hotels in Harbor',async()=>true,v.entries)
 expect(o.dropped).toContain('name_fragment')
})

it('metadata titles and area category heroes are not venue names',()=>{
 expect(extractLineName('Miami Restaurants')).toBeNull()
 const r=new SourceRecords();r.capture('web_fetch',{url:'https://fictional.test/list',title:'Harbor Hotel | Travel Journal',content:'Harbor Hotel | Travel Journal\nKestrel Harbor Hotel & Residences\n$$ | UNITED STATES, HARBOR\nREAD FULL REVIEW'},'2026-01-01T00:00:00Z')
 const v=buildPageView(r);expect(v.entries.some(e=>e.name==='Harbor Hotel')).toBe(false);expect(v.entries.some(e=>e.name==='Kestrel Harbor Hotel & Residences')).toBe(true)
})
it('a dedicated venue page with matching title still supplies a real descriptive venue line',()=>{
 const r=new SourceRecords();r.capture('web_fetch',{url:'https://fictional.test/inn',title:'Harbor Inn | Official Site',content:'Harbor Inn has rooms beside the quay.'},'2026-01-01T00:00:00Z')
 expect(buildPageView(r).entries.some(e=>e.name==='Harbor Inn')).toBe(true)
})
