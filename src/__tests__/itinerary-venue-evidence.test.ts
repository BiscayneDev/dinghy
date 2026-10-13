import {it,expect,vi} from 'vitest'
import {SourceRecords} from '@/lib/files/source-records'
import {collectVenueEvidence,venueEvidenceSections,venueSynthesisPrompt,validateVenueReasons,venueReasonJudgePrompt,relevantVenueExcerpts,parseVenueReasonJudge,venueReasonRepairPrompt} from '@/lib/files/itinerary-venue-evidence'
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
it('accepts model judgment only with valid per-claim sources, and a separate evidence verdict',async()=>{
 const records=new SourceRecords(),packets=await collectVenueEvidence([venue],destination,records,{search:async()=>({results:[{url:'https://fictional.test/review'}]}),read:async()=>({title:'Lantern Table Harbor',content:'The quiet dining room and seasonal vegetable bowls make Lantern Table distinctive in Harbor.'})})
 const request='Dinner for visiting founders who want a quiet conversation.'
 const reason={line:1,why:'A quiet dining room with seasonal vegetable bowls.',claims:[{text:'Quiet dining room and seasonal vegetable bowls',evidenceIds:[packets[0].evidence[0].id]}],unknowns:['Hours and availability not checked']}
 const judge=vi.fn(async(_input:Parameters<import('@/lib/files/itinerary-venue-evidence').EvidenceJudge>[0])=>true)
 const accepted=await validateVenueReasons({reasons:[reason]},request,packets,records,judge)
 expect(accepted.accepted).toHaveLength(1);expect(accepted.accepted[0].citations[0].url).toBe('https://fictional.test/review');expect(judge).toHaveBeenCalledOnce()
 const unsupported=await validateVenueReasons({reasons:[{...reason,why:'A rooftop pool just five minutes from your office.'}]},request,packets,records,async()=>false)
 expect(unsupported.rejected[0].code).toBe('judge_no_unspecified')
 for(const field of ['fit','fitBasis']){const out=await validateVenueReasons({reasons:[{...reason,[field]:field==='fit'?'':[]}]},request,packets,records,judge);expect(out.rejected[0].code).toBe('fit_forbidden')}
 const wrongSource=await validateVenueReasons({reasons:[{...reason,claims:[{text:'Pool',evidenceIds:['ev2_1']}]}]},request,packets,records,judge)
 expect(wrongSource.rejected[0].code).toBe('evidence')
 expect(venueSynthesisPrompt(request,packets)).not.toContain(request);expect(venueReasonJudgePrompt(judge.mock.calls[0][0])).toContain('Reject changed numbers')
})
it('synthesis contract spells out validator bounds and permits attributed unclassified descriptions',()=>{
 const p=venueSynthesisPrompt('visiting founders working sessions',[])
 for(const term of ['15-300','1-250','at most120','not src IDs','unknowns'])expect(p).toContain(term)
 const j=venueReasonJudgePrompt({request:'visiting founders',venue,why:'The page describes a quiet room for conversation.',claims:[],evidence:[]})
 expect(j).toContain('Unclassified is unknown ownership');expect(j).toContain('Do not require the description');expect(j).not.toContain('reject all first-party')
})
it('judge operational failures have finite distinct codes, never a fake negative quality verdict',async()=>{
 const records=new SourceRecords(),packets=await collectVenueEvidence([venue],destination,records,{search:async()=>({results:[{url:'https://fictional.test/review'}]}),read:async()=>({title:'Lantern Table Harbor',content:'Lantern Table offers seasonal vegetable bowls in Harbor.'})})
 const reason={line:1,why:'Seasonal bowls offer variety after work.',claims:[{text:'Seasonal vegetable bowls',evidenceIds:[packets[0].evidence[0].id]}],unknowns:[]}
 for(const verdict of ['no','timeout','http','error','invalid'] as const){const out=await validateVenueReasons({reasons:[reason]},'Dinner after work',packets,records,async()=>({verdict}));expect(out.rejected[0].code).toBe(verdict==='no'?'judge_no_unspecified':'judge_'+verdict)}
 const out=await validateVenueReasons({reasons:[reason]},'Dinner after work',packets,records,async input=>{expect(input.request).toBe('Dinner after work');expect(input).not.toHaveProperty('fit');expect(input).not.toHaveProperty('fitBasis');return {verdict:'yes'}})
 expect(out.accepted).toHaveLength(1)
})
it('claims-only contract excludes request context from synthesis and repair but preserves it for judging',async()=>{
 const records=new SourceRecords(),packets=await collectVenueEvidence([venue],destination,records,{search:async()=>({results:[{url:'https://fictional.test/review'}]}),read:async()=>({title:'Lantern Table Harbor',content:'Lantern Table serves seasonal vegetable bowls in Harbor.'})})
 const request='Lodging and dinner after office working sessions.'
 const reason={line:1,why:'The source describes seasonal vegetable bowls.',claims:[{text:'Seasonal vegetable bowls',evidenceIds:[packets[0].evidence[0].id]}],unknowns:[]}
 const out=await validateVenueReasons({reasons:[reason]},request,packets,records,async input=>{expect(input.request).toBe(request);expect(input).not.toHaveProperty('fit');return {verdict:'yes'}})
 expect(out.accepted).toHaveLength(1);expect(out.accepted[0]).not.toHaveProperty('fit');expect(out.accepted[0]).not.toHaveProperty('fitBasis')
 const prompt=venueSynthesisPrompt(request,packets)
 expect(prompt).not.toContain(request);expect(prompt).not.toContain('"fit":');expect(prompt).not.toContain('"fitBasis":');expect(prompt).toContain('Do not explain suitability')
 const repairPrompt=venueReasonRepairPrompt({venue,reason,evidence:packets[0].evidence,rejection:'unsupported_claim'})
 expect(repairPrompt).not.toContain(request);expect(repairPrompt).not.toContain('"fit":');expect(repairPrompt).not.toContain('"reasons":')
 expect(venueReasonJudgePrompt({request,venue,why:reason.why,claims:reason.claims,evidence:packets[0].evidence})).toContain(request)
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

it('parses only finite judge codes, rejects arbitrary prose and contradictory verdicts',()=>{
 expect(parseVenueReasonJudge('{"verdict":"yes","reason":"none"}')).toEqual({verdict:'yes'})
 for(const reason of ['identity','marketing','unsupported_claim','invented_fit','no_strength','uncertain'])expect(parseVenueReasonJudge(JSON.stringify({verdict:'no',reason}))).toEqual({verdict:'no',reason})
 for(const raw of ['YES','NO','{"verdict":"yes","reason":"unsupported_claim"}','{"verdict":"no","reason":"a long explanation"}','{"verdict":"no","reason":"identity","explanation":"private prose"}'])expect(parseVenueReasonJudge(raw)).toEqual({verdict:'invalid'})
})
it('judges only cited excerpts and repairs unsupported claims once through the same gates',async()=>{
 const records=new SourceRecords(),packets=await collectVenueEvidence([venue],destination,records,{search:async()=>({results:[{url:'https://fictional.test/review'}]}),read:async()=>({title:'Lantern Table Harbor',content:'Lantern Table serves seasonal bowls in Harbor. The dining room has a garden terrace.'})})
 const id=packets[0].evidence.find(e=>e.excerpt.includes('seasonal bowls'))!.id
 const reason={line:1,why:'Seasonal bowls with panoramic skyline views.',claims:[{text:'Seasonal bowls with skyline views',evidenceIds:[id]}],unknowns:[]}
 const fixed={...reason,why:'The source describes seasonal bowls.',claims:[{text:'Seasonal bowls',evidenceIds:[id]}]}
 const judge=vi.fn(async(input:Parameters<import('@/lib/files/itinerary-venue-evidence').EvidenceJudge>[0])=>{
  expect(input.evidence.map(e=>e.id)).toEqual([id])
  return input.why===fixed.why?{verdict:'yes' as const}:{verdict:'no' as const,reason:'unsupported_claim' as const}
 })
 const repair=vi.fn(async(input:Parameters<import('@/lib/files/itinerary-venue-evidence').VenueReasonRepair>[0])=>{expect(input.evidence.map(e=>e.id)).toEqual([id]);expect(venueReasonRepairPrompt(input)).toContain('ONE CORRECTION ONLY');return fixed})
 const out=await validateVenueReasons({reasons:[reason]},'Dinner',packets,records,judge,undefined,{repair})
 expect(out.accepted).toHaveLength(1);expect(judge).toHaveBeenCalledTimes(2);expect(repair).toHaveBeenCalledOnce()
 const prompt=venueReasonJudgePrompt({request:'Dinner',venue,why:reason.why,claims:reason.claims,evidence:packets[0].evidence})
 expect(prompt).not.toContain('The dining room has a garden terrace.')
 const alwaysNo=vi.fn(async()=>({verdict:'no' as const,reason:'unsupported_claim' as const}))
 const retry=vi.fn(async()=>fixed)
 expect((await validateVenueReasons({reasons:[reason]},'Dinner',packets,records,alwaysNo,undefined,{repair:retry})).rejected[0].code).toBe('judge_no_unsupported_claim')
 expect(alwaysNo).toHaveBeenCalledTimes(2);expect(retry).toHaveBeenCalledOnce()
})
it('repair cannot change identity, add uncited evidence or retry other rejections',async()=>{
 const records=new SourceRecords(),packets=await collectVenueEvidence([venue],destination,records,{search:async()=>({results:[{url:'https://fictional.test/review'}]}),read:async()=>({title:'Lantern Table Harbor',content:'Lantern Table serves seasonal bowls in Harbor. The dining room has a garden terrace.'})})
 const reason={line:1,why:'The source describes seasonal bowls.',claims:[{text:'Seasonal bowls',evidenceIds:[packets[0].evidence[0].id]}],unknowns:[]}
 const no=async()=>({verdict:'no' as const,reason:'unsupported_claim' as const})
 expect((await validateVenueReasons({reasons:[reason]},'Dinner',packets,records,no,undefined,{repair:async()=>({...reason,line:2})})).rejected[0].code).toBe('repair_invalid')
 expect((await validateVenueReasons({reasons:[reason]},'Dinner',packets,records,no,undefined,{repair:async()=>({...reason,claims:[{text:'Garden terrace',evidenceIds:[packets[0].evidence[1].id]}]})})).rejected[0].code).toBe('evidence')
 for(const code of ['identity','marketing','invented_fit','no_strength','uncertain'] as const){const repair=vi.fn(async()=>reason);expect((await validateVenueReasons({reasons:[reason]},'Dinner',packets,records,async()=>({verdict:'no',reason:code}),undefined,{repair})).rejected[0].code).toBe('judge_no_'+code);expect(repair).not.toHaveBeenCalled()}
})
it('retains short closure notices outside ranked evidence and preserves them across repair',async()=>{
 const hotel={line:1,name:'Quay Lodge',kind:'hotel' as const,website:'https://fictional.test',address:'42 Quay Street'}
 const text='Quay Lodge in Harbor\n'+Array.from({length:12},(_,i)=>'The rooms offer garden views and suites with breakfast service '+i+'.').join('\n')+'\nRooftop:\nTemporarily closed\nAddress: 42 Quay St'
 const records=new SourceRecords(),packets=await collectVenueEvidence([hotel],destination,records,{search:async()=>({results:[{url:'https://fictional.test/lodge'}]}),read:async()=>({title:'Quay Lodge Harbor',content:text})})
 expect(packets[0].evidence.some(e=>e.excerpt.includes('Temporarily closed'))).toBe(false)
 expect(packets[0].contradictionContext?.some(e=>e.excerpt.includes('Rooftop:\nTemporarily closed'))).toBe(true)
 const reason={line:1,why:'Rooms offer garden views and breakfast.',claims:[{text:'Rooms with garden views',evidenceIds:[packets[0].evidence[0].id]}],unknowns:[]}
 const judge=vi.fn(async(input:Parameters<import('@/lib/files/itinerary-venue-evidence').EvidenceJudge>[0])=>{
  expect(input.contradictionContext?.some(e=>e.excerpt.includes('Temporarily closed'))).toBe(true)
  const prompt=venueReasonJudgePrompt(input);expect(prompt).toContain('negative/identity context ONLY');expect(prompt).toContain('Temporarily closed')
  return {verdict:'no' as const,reason:'unsupported_claim' as const}
 })
 const repair=vi.fn(async(input:Parameters<import('@/lib/files/itinerary-venue-evidence').VenueReasonRepair>[0])=>{expect(venueReasonRepairPrompt(input)).toContain('Temporarily closed');return reason})
 const out=await validateVenueReasons({reasons:[reason]},'Lodging',packets,records,judge,undefined,{repair})
 expect(out.accepted).toHaveLength(0);expect(judge).toHaveBeenCalledTimes(2);expect(repair).toHaveBeenCalledOnce()
 expect(packets[0].contradictionContext!.every(e=>records.pageText(e.source)!.includes(e.excerpt))).toBe(true)
})
it('fails identity on conflicting first-party street number even with a permissive judge',async()=>{
 const records=new SourceRecords(),v={...venue,website:'https://fictional.test'}
 const packets=await collectVenueEvidence([v],destination,records,{search:async()=>({results:[{url:'https://fictional.test/dining'}]}),read:async()=>({title:'Lantern Table Harbor',content:'Lantern Table serves seasonal bowls in Harbor.\nAddress: 96 Quay Street, Harbor'})})
 const reason={line:1,why:'The source describes seasonal bowls.',claims:[{text:'Seasonal bowls',evidenceIds:[packets[0].evidence[0].id]}],unknowns:[]}
 const judge=vi.fn(async()=>true),repair=vi.fn(async()=>reason)
 const out=await validateVenueReasons({reasons:[reason]},'Dinner',packets,records,judge,undefined,{repair})
 expect(out.rejected[0].code).toBe('judge_no_identity');expect(judge).not.toHaveBeenCalled();expect(repair).not.toHaveBeenCalled()
 const matched=await validateVenueReasons({reasons:[reason]},'Dinner',[{...packets[0],venue:{...v,address:'96 Quay St'}}],records,judge)
 expect(matched.accepted).toHaveLength(1)
})
it('does not upgrade recipe/sourcing facts into freshness or authenticity and excludes neighbor closure',async()=>{
 const text='Harbor dining\n## Lantern Table\nLantern Table uses locally sourced vegetables and traditional recipes.\nAddress: 42 Quay St\n## Reed Kitchen\nPermanently closed at 96 Quay St.'
 const records=new SourceRecords(),packets=await collectVenueEvidence([venue],destination,records,{search:async()=>({results:[{url:'https://fictional.test/dining'}]}),read:async()=>({title:'Harbor dining',content:text})})
 expect(JSON.stringify(packets[0].contradictionContext)).not.toContain('Permanently closed')
 const reason={line:1,why:'Fresh and culturally authentic cuisine.',claims:[{text:'Locally sourced vegetables and traditional recipes',evidenceIds:[packets[0].evidence[0].id]}],unknowns:[]}
 const out=await validateVenueReasons({reasons:[reason]},'Dinner',packets,records,async input=>{const prompt=venueReasonJudgePrompt(input);expect(prompt).toContain('Never infer freshness from local sourcing');expect(prompt).toContain('cultural authenticity from traditional recipes');return {verdict:'no',reason:'marketing'}})
 expect(out.rejected[0].code).toBe('judge_no_marketing')
 expect(venueSynthesisPrompt('Dinner',packets)).toContain('Locally sourced ingredients do not prove freshness')
})

it('includes same-venue subsection closure but stops before a sibling venue',()=>{
 const text='Harbor hotels\n## Lantern Table\nSeasonal bowls are served in a garden dining room.\n### Terrace status\nTemporarily closed\n## Reed Kitchen\nReed Kitchen offers a rooftop pool.'
 const sections=venueEvidenceSections(venue,destination,'Harbor guide',text)
 expect(sections.join(' ')).toContain('Temporarily closed');expect(sections.join(' ')).not.toContain('rooftop pool')
})
