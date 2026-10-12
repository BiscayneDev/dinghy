import {it,expect} from 'vitest'
import {writeFile,mkdir} from 'node:fs/promises'
import {renderHtml,renderPdf,itineraryCover} from '@/lib/files/render'
import {dedupePickBullets} from '@/lib/files/itinerary-selection'
import {SourceRecords} from '@/lib/files/source-records'
import {buildPageView,compileQuoteSelection} from '@/lib/files/itinerary-view'
it('dedupes repeated untimed pick bullets but preserves timed visits',()=>{
 const o=dedupePickBullets('## Weekend\n- Do: Tide Museum\n- Visit Tide Museum\n- 10am Tide Museum',['Tide Museum'])
 expect(o.removed).toBe(1);expect(o.body).toContain('10am');expect(o.body).toContain('Do:')
})
it('markdown and case-normalized names can find a clean own-page sentence',async()=>{
 const r=new SourceRecords();r.capture('web_fetch',{url:'https://fictional.test/cafe',title:'Harbor dining',content:'#### Lantern Cafe\n**lantern cafe** serves healthy bowls beside the quay.\n'},'2026-01-01T00:00:00Z')
 const v=buildPageView(r),line=v.entries.find(e=>e.name==='Lantern Cafe')!.n
 const o=await compileQuoteSelection({candidates:[{kind:'restaurant',line}]},r,'restaurants in Harbor',async()=>true,v.entries)
 if('error' in o)throw new Error(o.error)
 expect(String(o.candidates[0].reason)).toContain('healthy bowls')
})
it('renders a real named itinerary cover on web and PDF, with long reasons kept together',async()=>{
 const doc={title:'Harbor City · Friday and weekend',body:'## Friday\n- 10am: Office visit\n- Working sessions: venue and duration to confirm.\n## Weekend\n- Do: Tide Museum\n## Hotels\n:::stay\nHarbor Inn | unknown | unknown | unknown | Hours unverified | | https://fictional.test/inn\n:::\n\nSelection reasons:\n- Harbor Inn has quiet rooms beside the quay.\n\n## Dining\n:::options\nLantern Cafe | unknown | Healthy bowls beside the quay. | Hours unverified https://fictional.test/cafe\n:::'}
 expect(itineraryCover(doc)?.name).toBe('Harbor Inn')
 const html=renderHtml(doc);expect(html).toContain('itinerary-cover');expect(html).toContain('Researched itinerary')
 await mkdir('/tmp/itinerary-polish',{recursive:true});await writeFile('/tmp/itinerary-polish/page.html',html);await writeFile('/tmp/itinerary-polish/file.pdf',await renderPdf(doc))
 const long={...doc,body:doc.body.replace('## Hotels',Array.from({length:13},(_,i)=>'- Agenda note '+i+' preserves the requested work and leaves timing open.').join('\n')+'\n## Hotels')}
 await writeFile('/tmp/itinerary-polish/long.pdf',await renderPdf(long))
})

it('first-person only reviews fall back with a literal area mention, not rewritten opinions',async()=>{
 const r=new SourceRecords();r.capture('web_fetch',{url:'https://fictional.test/cafe',title:'Harbor dining',content:"#### Lantern Cafe\nI had Lantern Cafe on our list. We came down to the Lantern District for healthy food.\n"},'2026-01-01T00:00:00Z')
 const v=buildPageView(r),line=v.entries.find(e=>e.name==='Lantern Cafe')!.n
 const o=await compileQuoteSelection({candidates:[{kind:'restaurant',line}]},r,'restaurants in Harbor',async()=>true,v.entries)
 if('error' in o)throw new Error(o.error)
 const reason=String(o.candidates[0].reason);expect(reason).toContain('source mentions Lantern District');expect(reason).not.toMatch(/We came|healthy food|I had/)
})

import {neutralizeUnpickedVenues} from '@/lib/files/itinerary-selection'
it('bold-only venue bullets cannot leak unpicked or wrong-kind picks under Dinner',()=>{
 const req='Friday in Harbor with Dinner and Hotels recommendations'
 const body='## Friday\n**Dinner**\n- **Rosenleaf**\n- **Harbor Inn**\n- **Lantern Cafe**\n- **Working sessions**\n## Hotels\n- **Harbor Inn**'
 const o=neutralizeUnpickedVenues(body,['Harbor Inn','Lantern Cafe'],req,[],[{kind:'hotel',name:'Harbor Inn'},{kind:'restaurant',name:'Lantern Cafe'}])
 expect(o.body).not.toContain('Rosenleaf');expect(o.body.split('## Hotels')[0]).not.toContain('Harbor Inn');expect(o.body).toContain('Lantern Cafe');expect(o.body).toContain('Working sessions');expect(o.body.split('## Hotels')[1]).toContain('Harbor Inn')
})
it('partial hotel aliases in bold bullets still cannot become dinner picks',()=>{
 const o=neutralizeUnpickedVenues('## Dinner\n- **Harbor Inn**',['Harbor Inn Seaside'],'Dinner in Harbor',[],[{kind:'hotel',name:'Harbor Inn Seaside'}])
 expect(o.body).not.toContain('Harbor Inn')
})
it('writes a multipage PDF with a long hotel URL for bullet pagination review',async()=>{
 const body=Array.from({length:22},(_,i)=>'- Agenda '+i+' keeps the requested work visible.').join('\n')+'\n## Hotels\n:::stay\nHarbor Inn | unknown | unknown | unknown | Hours and availability unverified | | https://fictional.test/hotel/harbor-inn/long-path-to-the-source-page-for-complete-provenance-and-link-verification\n:::\n\nSelection reasons:\n- Harbor Inn is listed as a place to stay.'
 await mkdir('/tmp/itinerary-polish',{recursive:true});await writeFile('/tmp/itinerary-polish/bullet.pdf',await renderPdf({title:'Harbor weekend',body}))
})
it('meal orphan wait and reservation claims disappear without a named pick',()=>{
 const o=neutralizeUnpickedVenues('## Lunch\nReservations may be hard to get\n## Dinner\nPopular spot, expect a wait\n## Friday\n- Office visit',['Harbor Inn'],'Lunch Dinner Friday office visit',[],[{kind:'hotel',name:'Harbor Inn'}])
 expect(o.body).not.toMatch(/hard to get|expect a wait/);expect(o.body).toContain('Office visit')
})
