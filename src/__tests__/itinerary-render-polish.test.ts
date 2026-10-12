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
