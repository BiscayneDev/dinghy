import {it,expect} from 'vitest'
import {SourceRecords} from '@/lib/files/source-records'
import {buildPageView,compileQuoteSelection} from '@/lib/files/itinerary-view'
it('review: next venue heading is not this hotel reason',async()=>{
 const r=new SourceRecords();r.capture('web_fetch',{url:'https://fictional.test/review',title:'Harbor',content:'Harbor Inn\nLantern Table\nLantern Table serves loud seafood dinners tonight.\n'},'2026-01-01T00:00:00Z')
 const v=buildPageView(r),ln=v.entries.find(e=>e.name==='Harbor Inn')!.n
 const o=await compileQuoteSelection({candidates:[{kind:'hotel',line:ln}]},r,'trip to Harbor',async()=>true,v.entries)
 if('error' in o)throw new Error(o.error)
 expect(String(o.candidates[0].reason)).not.toContain('Lantern')
})
import {extractLineName,verifyPrompt} from '@/lib/files/itinerary-view'
import {ensurePlanFromPicks} from '@/lib/files/itinerary-selection'
it('mixed all-caps heading fragments are rejected, complete venue nouns survive',()=>{
 expect(extractLineName('QUAYSIDE & Bay Harbor Islands')).toBeNull()
 expect(extractLineName('LANTERN & COAST MUSEUM')).toBe('LANTERN & COAST MUSEUM')
 expect(extractLineName('Quayside Museum')).toBe('Quayside Museum')
})
it('verification receives neighborhood prose after the heading, not fabricated kind evidence',async()=>{
 const r=new SourceRecords();r.capture('web_fetch',{url:'https://fictional.test/areas',title:'Harbor guide',content:'## Quayside Harbor\nThese are quiet neighborhoods and places to stay, not attractions.\n'},'2026-01-01T00:00:00Z')
 const v=buildPageView(r);let context=''
 const o=await compileQuoteSelection({candidates:[{kind:'activity',line:v.entries[0].n}]},r,'trip to Harbor',async(_n,_k,q)=>{context=q;return false},v.entries)
 expect(context).toContain('quiet neighborhoods');expect(context).not.toContain('Listed as something to do');expect('error' in o).toBe(true)
 expect(verifyPrompt('Quayside Harbor','activity',context)).toContain('A bare heading with no venue category')
})
it('unsafe price, first-person and second-venue sentences are dropped, not clipped',async()=>{
 const r=new SourceRecords();r.capture('web_fetch',{url:'https://fictional.test/reasons',title:'Harbor guide',content:'Tide Museum has murals and tickets cost $12.\nTide Museum is next to 1-900-Fortune restaurant.\nWe welcome guests to Tide Museum for art exhibits.\nTide Museum displays rotating murals by local artists.\n'},'2026-01-01T00:00:00Z')
 const v=buildPageView(r),ln=v.entries.find(e=>e.name==='Tide Museum')!.n
 const o=await compileQuoteSelection({candidates:[{kind:'activity',line:ln}]},r,'trip to Harbor',async()=>true,v.entries)
 if('error' in o)throw new Error(o.error)
 const reason=String(o.candidates[0].reason)
 expect(reason).toContain('rotating murals');expect(reason).not.toMatch(/\$12|Fortune|We welcome|is next to/)
})
it('first-person own-site reason falls back honestly when no clean description exists',async()=>{
 const r=new SourceRecords();r.capture('web_fetch',{url:'https://fictional.test/own',title:'Our Harbor Inn',content:'## Harbor Inn\nAt Harbor Inn, we offer quiet rooms beside the water.\n'},'2026-01-01T00:00:00Z')
 const v=buildPageView(r),ln=v.entries.find(e=>e.name==='Harbor Inn')!.n
 const o=await compileQuoteSelection({candidates:[{kind:'hotel',line:ln}]},r,'trip to Harbor',async()=>true,v.entries)
 if('error' in o)throw new Error(o.error)
 expect(String(o.candidates[0].reason)).toBe('Harbor Inn. Listed as a place to stay on the source page.')
})
it('all missing picks appear, and a requested weekend creates a separate section',()=>{
 const picks=[...['Harbor Inn','Kestrel Lodge','Gull Hotel'].map(name=>({kind:'hotel',name})),...['Lantern Table','Rook Kitchen','Fenn Bistro','The Ledger'].map(name=>({kind:'restaurant',name})),...['Tide Museum','Shell Gallery','Beacon Garden','Quay Aquarium'].map(name=>({kind:'activity',name}))]
 const o=ensurePlanFromPicks('# Trip\n## Friday\n- Arrive','Friday in Harbor, plus weekend activities',picks)
 for(const p of picks)expect(o.body).toContain(p.name)
 const [friday,weekend]=o.body.split('## Weekend');expect(friday).toContain('Eat:');expect(friday).not.toContain('Do:');expect(weekend).toContain('Do:')
 expect(ensurePlanFromPicks(o.body,'Friday in Harbor, plus weekend activities',picks).added).toBe(0)
})

// These tests validate the context contract with a deterministic judge, not a live routed-model verdict.
it('plain restaurant list retains literal category evidence for every pick',async()=>{
 const r=new SourceRecords();r.capture('web_fetch',{url:'https://fictional.test/eats',title:'Harbor dining guide',content:'## Restaurants in Harbor\n### Lantern Table\n### Rook & Thistle\n### Fenn Bistro\n'},'2026-01-01T00:00:00Z')
 const v=buildPageView(r),names=['Lantern Table','Rook & Thistle','Fenn Bistro'],contexts:string[]=[]
 const o=await compileQuoteSelection({candidates:names.map(name=>({kind:'restaurant',line:v.entries.find(e=>e.name===name)!.n}))},r,'restaurants in Harbor',async(name,kind,context)=>{contexts.push(context);return kind==='restaurant'&&context.includes('Page section: Restaurants in Harbor')&&context.includes('Pick section: '+name)},v.entries)
 if('error' in o)throw new Error(o.error)
 expect(o.candidates).toHaveLength(3)
 for(const [i,c] of contexts.entries()){expect(c).toContain(names[i]);for(const other of names.filter(n=>n!==names[i]))expect(c).not.toContain(other)}
 const prompt=verifyPrompt('Lantern Table','restaurant',contexts[0])
 expect(prompt).toContain('list is type evidence');expect(prompt).toContain('not proof of live hours')
})
it('plain attraction list retains category evidence without borrowing the next attraction',async()=>{
 const r=new SourceRecords();r.capture('web_fetch',{url:'https://fictional.test/do',title:'Harbor activities',content:'## Attractions in Harbor\nTide Museum\nShell Gallery\n'},'2026-01-01T00:00:00Z')
 const v=buildPageView(r)
 const o=await compileQuoteSelection({candidates:[{kind:'activity',line:v.entries.find(e=>e.name==='Tide Museum')!.n}]},r,'activities in Harbor',async(_n,_k,q)=>q.includes('Page section: Attractions in Harbor')&&!q.includes('Shell Gallery'),v.entries)
 expect('error' in o).toBe(false)
})

import {ensureRequestAgenda,ensureWorkingSessions} from '@/lib/files/itinerary-selection'
it('reuses a Day 1 Friday heading for picks and request-derived agenda',()=>{
 const request='Friday office visit 10am then working sessions, plus weekend activities'
 let body=ensureRequestAgenda('# Trip\n## Day 1 Friday\n- Arrive',request).body
 body=ensureWorkingSessions(body,request).body
 body=ensurePlanFromPicks(body,request,[{kind:'hotel',name:'Harbor Inn'}]).body
 expect(body).not.toContain('## Friday');expect(body).toContain('## Day 1 Friday');expect(body).toContain('10am');expect(body).toContain('Working sessions');expect(body).toContain('Harbor Inn')
})
it('category page chrome is not extracted as a venue',()=>{
 for(const chrome of ['Season Menus','Through October','Harbor Dining Months','Powered By','Miami and Miami'])expect(extractLineName(chrome)).toBeNull()
 expect(extractLineName('Lantern Restaurant seasonal menus')).toBe('Lantern Restaurant')
})
it('sparse restaurant pages survive a denser hotel page',()=>{
 const r=new SourceRecords();r.capture('web_fetch',{url:'https://fictional.test/stays',title:'Harbor hotels',content:['Gull Hotel','Rook Hotel','Kestrel Hotel','Heron Hotel','Osprey Hotel','Tern Hotel'].map(n=>n+' has rooms near Harbor.').join('\n')},'2026-01-01T00:00:00Z')
 r.capture('web_fetch',{url:'https://fictional.test/dining',title:'Harbor restaurants',content:'Lantern Table serves seafood in Harbor.\nFenn Bistro serves lunch in Harbor.'},'2026-01-01T00:00:00Z')
 const v=buildPageView(r);expect(v.entries.some(e=>e.name==='Lantern Table')).toBe(true);expect(v.entries.some(e=>e.name==='Fenn Bistro')).toBe(true)
})
