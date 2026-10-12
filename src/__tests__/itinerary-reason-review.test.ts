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
