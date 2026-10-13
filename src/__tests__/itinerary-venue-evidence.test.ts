import {it,expect,vi} from 'vitest'
import {SourceRecords} from '@/lib/files/source-records'
import {collectVenueEvidence,venueEvidenceSections,venueSynthesisPrompt,validateVenueReasons,venueReasonJudgePrompt,relevantVenueExcerpts} from '@/lib/files/itinerary-venue-evidence'
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
 expect(unsupported.rejected[0].code).toBe('judge_no')
 const invented=await validateVenueReasons({reasons:[{...reason,fitBasis:['vegetarian allergy']}]},request,packets,records,judge)
 expect(invented.accepted[0].fitBasis).toEqual([request]);expect(judge.mock.calls.at(-1)![0].fitBasis).toEqual([request])
 const wrongSource=await validateVenueReasons({reasons:[{...reason,claims:[{text:'Pool',evidenceIds:['ev2_1']}]}]},request,packets,records,judge)
 expect(wrongSource.rejected[0].code).toBe('evidence')
 expect(venueSynthesisPrompt(request,packets)).toContain(request);expect(venueReasonJudgePrompt(judge.mock.calls[0][0])).toContain('Reject changed numbers')
})
it('synthesis contract spells out validator bounds and permits attributed unclassified descriptions',()=>{
 const p=venueSynthesisPrompt('visiting founders working sessions',[])
 for(const term of ['15-300','1-250','0-200','at most120','not src IDs','server supplies','unknowns'])expect(p).toContain(term)
 const j=venueReasonJudgePrompt({request:'visiting founders',venue,why:'The page describes a quiet room for conversation.',claims:[],fit:'For conversation',fitBasis:['visiting founders'],evidence:[]})
 expect(j).toContain('Unclassified is unknown ownership');expect(j).toContain('Subjective fit');expect(j).not.toContain('reject all first-party')
})
it('judge operational failures have finite distinct codes, never a fake negative quality verdict',async()=>{
 const records=new SourceRecords(),packets=await collectVenueEvidence([venue],destination,records,{search:async()=>({results:[{url:'https://fictional.test/review'}]}),read:async()=>({title:'Lantern Table Harbor',content:'Lantern Table offers seasonal vegetable bowls in Harbor.'})})
 const reason={line:1,why:'Seasonal bowls offer variety after work.',claims:[{text:'Seasonal vegetable bowls',evidenceIds:[packets[0].evidence[0].id]}],fit:'Variety after work.',unknowns:[]}
 for(const verdict of ['no','timeout','http','error','invalid'] as const){const out=await validateVenueReasons({reasons:[reason]},'Dinner after work',packets,records,async()=>({verdict}));expect(out.rejected[0].code).toBe('judge_'+verdict)}
 const out=await validateVenueReasons({reasons:[reason]},'Dinner after work',packets,records,async input=>{expect(input.fitBasis).toEqual(['Dinner after work']);return {verdict:'yes'}})
 expect(out.accepted).toHaveLength(1)
})
it('does not force invented fit needs; empty fit with useful supported description is valid',async()=>{
 const records=new SourceRecords(),packets=await collectVenueEvidence([venue],destination,records,{search:async()=>({results:[{url:'https://fictional.test/review'}]}),read:async()=>({title:'Lantern Table Harbor',content:'Lantern Table serves seasonal vegetable bowls in Harbor.'})})
 const reason={line:1,why:'The source describes seasonal vegetable bowls.',claims:[{text:'Seasonal vegetable bowls',evidenceIds:[packets[0].evidence[0].id]}],fit:'',unknowns:[]}
 expect((await validateVenueReasons({reasons:[reason]},'Hotels and restaurants after office working sessions',packets,records,async()=>({verdict:'yes'}))).accepted).toHaveLength(1)
 const prompt=venueSynthesisPrompt('Hotels and restaurants after office working sessions',packets)
 expect(prompt).toContain('does NOT request hotel meeting space');expect(prompt).toContain('fit 0-200');expect(prompt).toContain('neutral paraphrases')
 expect(venueReasonJudgePrompt({request:'Office working sessions and lodging',venue,why:'Meeting facilities ideal for your working sessions',claims:[],fit:'',fitBasis:[],evidence:[]})).toContain('Reject those invented needs')
})

it('ranks useful late details ahead of navigation without rewriting source text',()=>{
 const chrome=Array.from({length:20},(_,i)=>'Privacy policy and cookie settings for visitor '+i+'.').join('\n')
 const bland=Array.from({length:12},(_,i)=>'Explore our latest news update number '+i+' and find out more.').join('\n')
 const detail='Lantern Table serves vegetable bowls with wood-fired noodles in a courtyard dining room.'
 const text=chrome+'\n'+bland+'\n'+detail
 const out=relevantVenueExcerpts([text],text,venue)
 expect(out).toContain(detail);expect(out[0]).toBe(detail);expect(out.some(s=>/privacy|cookies/i.test(s))).toBe(false);expect(out.every(s=>text.includes(s))).toBe(true)
})
it('title-matched pages retain relevant content after the old ten-thousand-character cutoff',()=>{
 const text='Harbor\n'+('Privacy policy and cookie settings.\n'.repeat(350))+'Lantern Table serves seasonal bowls on a garden terrace.'
 const sections=venueEvidenceSections(venue,destination,'Lantern Table Harbor',text)
 expect(relevantVenueExcerpts(sections,text,venue)).toContain('Lantern Table serves seasonal bowls on a garden terrace.')
})
