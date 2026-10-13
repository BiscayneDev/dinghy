import {it,expect,vi} from 'vitest'
import {SourceRecords} from '@/lib/files/source-records'
import {collectVenueEvidence,venueEvidenceSections,venueSynthesisPrompt,validateVenueReasons,venueReasonJudgePrompt} from '@/lib/files/itinerary-venue-evidence'
const venue={line:1,name:'Lantern Table',kind:'restaurant' as const,address:'42 Quay St'}
const destination={query:'Harbor, North Coast',matchTerms:['Harbor']}
it('keeps first-person and review context within the named venue section, excluding next venue',()=>{
 const text='Harbor dining\n## Lantern Table\nWe specialize in seasonal vegetable bowls. The quiet dining room works for conversation.\n## Reed Kitchen\nReed Kitchen has a rooftop pool.'
 const sections=venueEvidenceSections(venue,destination,'Harbor dining review',text)
 expect(sections.join(' ')).toContain('We specialize');expect(sections.join(' ')).not.toContain('rooftop pool')
 expect(venueEvidenceSections(venue,{query:'Other Harbor',matchTerms:['Other Harbor']},'Review',text)).toEqual([])
})
it('collects parallel fetched sections and preserves provenance without trusting snippets',async()=>{
 const records=new SourceRecords();let active=0,max=0
 const search=async()=>({results:[{url:'https://fictional.test/review',content:'Lantern Table has a rooftop pool.'},{url:'https://fictional.test/own'}]})
 const read=async(url:string)=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,5));active--;return {title:'Lantern Table in Harbor',content:url.endsWith('own')?'Harbor\nWe offer seasonal vegetable bowls and a quiet dining room.':'Harbor\n## Lantern Table\nThe vegetable bowls have bold, smoky flavors.\n## Reed Kitchen\nIt has a rooftop pool.'}}
 const packets=await collectVenueEvidence([venue],destination,records,{search,read},{budgetMs:100})
 expect(max).toBe(2);expect(packets[0].status).toBe('ready');expect(packets[0].evidence).toHaveLength(2);expect(JSON.stringify(packets)).not.toContain('rooftop pool');expect(packets[0].evidence.every(e=>records.pageText(e.source)!.includes(e.excerpt))).toBe(true)
})
it('late timeouts cannot capture evidence',async()=>{
 const records=new SourceRecords(),packets=await collectVenueEvidence([venue],destination,records,{search:async()=>({results:[{url:'https://fictional.test/review'}]}),read:async()=>{await new Promise(r=>setTimeout(r,30));return {title:'Lantern Table Harbor',content:'Lantern Table serves seasonal bowls in Harbor.'}}},{budgetMs:3})
 expect(packets[0].status).toBe('timeout');await new Promise(r=>setTimeout(r,40));expect(records.size()).toBe(0)
})
it('accepts model judgment only with valid per-claim sources, request fit and a separate evidence verdict',async()=>{
 const records=new SourceRecords(),packets=await collectVenueEvidence([venue],destination,records,{search:async()=>({results:[{url:'https://fictional.test/review'}]}),read:async()=>({title:'Lantern Table Harbor',content:'The quiet dining room and seasonal vegetable bowls make Lantern Table distinctive in Harbor.'})})
 const request='Dinner for visiting founders who want a quiet conversation.'
 const reason={line:1,why:'A quiet dining room with seasonal vegetable bowls, a good fit for conversation after work.',claims:[{text:'Quiet dining room and seasonal vegetable bowls',evidenceIds:[packets[0].evidence[0].id]}],fit:'A good fit for conversation after work.',fitBasis:['quiet conversation'],unknowns:['Hours and availability not checked']}
 const judge=vi.fn(async(_input:Parameters<import('@/lib/files/itinerary-venue-evidence').EvidenceJudge>[0])=>true)
 const accepted=await validateVenueReasons({reasons:[reason]},request,packets,records,judge)
 expect(accepted.accepted).toHaveLength(1);expect(accepted.accepted[0].citations[0].url).toBe('https://fictional.test/review');expect(judge).toHaveBeenCalledOnce()
 const unsupported=await validateVenueReasons({reasons:[{...reason,why:'A rooftop pool just five minutes from your office.'}]},request,packets,records,async()=>false)
 expect(unsupported.rejected[0].code).toBe('unsupported')
 const invented=await validateVenueReasons({reasons:[{...reason,fitBasis:['vegetarian allergy']}]},request,packets,records,judge)
 expect(invented.rejected[0].code).toBe('fit_basis')
 const wrongSource=await validateVenueReasons({reasons:[{...reason,claims:[{text:'Pool',evidenceIds:['ev2_1']}]}]},request,packets,records,judge)
 expect(wrongSource.rejected[0].code).toBe('evidence')
 expect(venueSynthesisPrompt(request,packets)).toContain(request);expect(venueReasonJudgePrompt(judge.mock.calls[0][0])).toContain('Reject changed numbers')
})
