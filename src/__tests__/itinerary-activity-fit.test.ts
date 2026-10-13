import {it,expect} from 'vitest'
import {SourceRecords} from '@/lib/files/source-records'
import {activityEvidenceSpans,repairableActivityRejection,activityFitRepairPrompt,parseActivityJudge,activityFitJudgePrompt,incidentalActivityTags,activityFitPrompt,validateActivityFit,applyActivityFit} from '@/lib/files/itinerary-activity-fit'
it('flags marker subtypes without venue-name hardcodes and retains novel experience categories',()=>{
 expect(incidentalActivityTags(['tourism.attraction.marker'],{})).toBe(true);expect(incidentalActivityTags(['tourism.attraction'],{historic:'commemorative'})).toBe(true);expect(incidentalActivityTags(['tourism.attraction'],{tourism:'museum'})).toBe(false)
})
it('a useful activity needs checked experience evidence and judgment, not attraction category',async()=>{
 const records=new SourceRecords(),r=records.capture('web_fetch',{url:'https://fictional.test/workshop',content:'Reed Workshop offers hands-on printmaking sessions in Harbor.'},'fictional-check')[0]
 const packet={venue:{line:1,name:'Reed Workshop',kind:'activity' as const},status:'ready' as const,notes:[],evidence:[{id:'ev1_1',source:r.id,url:r.url,title:'Reed Workshop',excerpt:r.content!,origin:'fetched_page' as const,sourceRole:'unclassified' as const}]}
 const request='Fun things for the weekend after our workday.'
 const verdict={line:1,decision:'recommend',experience:'hands-on printmaking sessions',requestBasis:['weekend'],evidenceIds:['ev1_1'],reason:'An active break after the workday.',unknowns:['Session schedule not checked']}
 expect((await validateActivityFit({activities:[verdict]},request,[packet],records,async()=>true)).accepted).toHaveLength(1)
 expect((await validateActivityFit({activities:[{...verdict,evidenceIds:[]}]},request,[packet],records,async()=>true)).rejected[0].code).toBe('no_experience')
 expect((await validateActivityFit({activities:[verdict]},request,[packet],records,async()=>false)).rejected[0].code).toBe('judge_no')
 expect(activityFitPrompt(request,[packet])).toContain('not category labels')
})
it('removes incidental picks and reselects an independently supported novel experience, or leaves an honest gap',()=>{
 const marker={kind:'activity',name:{source:'marker'}},workshop={kind:'activity',name:{source:'workshop'},evidenceLine:2},hotel={kind:'hotel',name:{source:'hotel'}}
 const fit={line:2,decision:'recommend' as const,experience:'Hands-on printmaking',requestBasis:['weekend'],evidenceIds:['ev2_1'],reason:'Active weekend visit',unknowns:[]}
 const result=applyActivityFit([hotel,marker],[{...marker,evidenceLine:1},workshop],[fit])
 expect(result.omitted).toBe(1);expect(result.reselected).toBe(1);expect(result.candidates).toEqual([hotel,{kind:'activity',name:{source:'workshop'}}])
 expect(applyActivityFit([hotel,marker],[{...marker,evidenceLine:1}],[]).candidates).toEqual([hotel])
})
it('HTTP/invalid judge outcomes never grant experience permission',async()=>{
 const records=new SourceRecords(),r=records.capture('web_fetch',{url:'https://fictional.test/site',content:'Harbor Site is marked by a commemorative plaque.'},'fictional')[0]
 const packet={venue:{line:1,name:'Harbor Site',kind:'activity' as const},status:'ready' as const,notes:[],evidence:[{id:'ev1_1',source:r.id,url:r.url,title:'Harbor Site',excerpt:r.content!,origin:'fetched_page' as const,sourceRole:'unclassified' as const}]}
 const verdict={line:1,decision:'recommend',experience:'A commemorative plaque',requestBasis:['weekend'],evidenceIds:['ev1_1'],reason:'Weekend history stop',unknowns:[]}
 expect((await validateActivityFit({activities:[verdict]},'fun weekend',[packet],records,async()=>({verdict:'http'}))).accepted).toHaveLength(0)
})

it('request authority is server-held and field failures have finite codes',async()=>{
 const records=new SourceRecords(),r=records.capture('web_fetch',{url:'https://fictional.test/workshop',content:'Reed Workshop offers hands-on printmaking sessions in Harbor.'},'fictional')[0]
 const packet={venue:{line:1,name:'Reed Workshop',kind:'activity' as const},status:'ready' as const,notes:[],evidence:[{id:'ev1_1',source:r.id,url:r.url,title:'Reed Workshop',excerpt:r.content!,origin:'fetched_page' as const,sourceRole:'unclassified' as const}]}
 const row={line:1,decision:'recommend',experience:'hands-on printmaking sessions',evidenceIds:['ev1_1'],reason:'An active break after work.',unknowns:[]}
 expect((await validateActivityFit({activities:[row]},'fun weekend',[packet],records,async input=>({verdict:input.request==='fun weekend'?'yes':'no'}))).accepted).toHaveLength(1)
 expect((await validateActivityFit({activities:[{...row,experience:'x'.repeat(251)}]},'fun weekend',[packet],records,async()=>true)).rejected[0].code).toBe('experience_bounds')
})

it('typed experience verdicts fail closed and carry only finite diagnostic reasons',()=>{
 expect(parseActivityJudge('{"verdict":"yes","reason":"none"}')).toEqual({verdict:'yes',reason:'none'})
 expect(parseActivityJudge('{"verdict":"no","reason":"incidental"}')).toEqual({verdict:'no',reason:'incidental'})
 for(const raw of ['YES','{"verdict":"yes","reason":"uncertain"}','{"verdict":"no","reason":"none"}','{"verdict":"no","reason":"private venue text"}'])expect(parseActivityJudge(raw).verdict).toBe('invalid')
 expect(activityFitJudgePrompt({request:'fun weekend',verdict:{line:1,decision:'recommend',experience:'Hands-on workshop',evidenceIds:[],reason:'Weekend outing',unknowns:[]},packet:{venue:{line:1,kind:'activity',name:'Reed Workshop'},status:'missing',evidence:[],notes:[]}})).toContain('honestly listed as unknown')
})

it('repair targets only unsupported claims, not incidental or missing experiences',()=>{
 const packets=[1,2,3].map(line=>({venue:{line,name:'Fictional '+line,kind:'activity' as const},status:'ready' as const,evidence:[],notes:[]}))
 const prompt=activityFitRepairPrompt('fun weekend',packets,[{line:1,code:'judge_no_unsupported_claim'},{line:2,code:'judge_no_no_experience'},{line:3,code:'judge_no_incidental'}])
 expect(prompt).toContain('Fictional 1');expect(prompt).not.toContain('Fictional 2');expect(prompt).not.toContain('Fictional 3');expect(prompt).toContain('ONE exact numbered spanId')
})

it('optional unknowns do not create authority; malformed caveats remain rejected with finite codes',async()=>{
 const records=new SourceRecords(),r=records.capture('web_fetch',{url:'https://fictional.test/workshop',content:'Reed Workshop offers hands-on printmaking sessions in Harbor.'},'fictional')[0]
 const packet={venue:{line:1,name:'Reed Workshop',kind:'activity' as const},status:'ready' as const,notes:[],evidence:[{id:'ev1_1',source:r.id,url:r.url,title:'Reed Workshop',excerpt:r.content!,origin:'fetched_page' as const,sourceRole:'unclassified' as const}]}
 const row={line:1,decision:'recommend',experience:'hands-on printmaking sessions',evidenceIds:['ev1_1'],reason:'A possible weekend visit'}
 expect((await validateActivityFit({activities:[row]},'fun weekend',[packet],records,async()=>true)).accepted[0].unknowns).toEqual([])
 expect((await validateActivityFit({activities:[row]},'fun weekend',[packet],records,async()=>false)).accepted).toHaveLength(0)
 for(const [unknowns,code] of [[{},'unknowns_array'],[false,'unknowns_array'],[[9],'unknowns_item'],[['x'.repeat(121)],'unknowns_bounds']] as const)expect((await validateActivityFit({activities:[{...row,unknowns}]},'fun weekend',[packet],records,async()=>true)).rejected[0].code).toBe(code)
})

it('enforces literal experience and keeps contradictory uncited context available to the judge',async()=>{
 const records=new SourceRecords(),r=records.capture('web_fetch',{url:'https://fictional.test/workshop',content:'Reed Workshop offers hands-on printmaking sessions. Sessions are temporarily suspended.'},'fictional')[0]
 const packet={venue:{line:1,name:'Reed Workshop',kind:'activity' as const},status:'ready' as const,notes:[],evidence:[{id:'ev1_1',source:r.id,url:r.url,title:'Reed Workshop',excerpt:'Reed Workshop offers hands-on printmaking sessions.',origin:'fetched_page' as const,sourceRole:'unclassified' as const},{id:'ev1_2',source:r.id,url:r.url,title:'Reed Workshop',excerpt:'Sessions are temporarily suspended.',origin:'fetched_page' as const,sourceRole:'unclassified' as const}]}
 const row={line:1,decision:'recommend',experience:'hands-on printmaking sessions',evidenceIds:['ev1_1'],reason:'Relaxing and fun'}
 expect((await validateActivityFit({activities:[{...row,experience:'Amazing creative fun'}]},'weekend',[packet],records,async()=>true)).rejected[0].code).toBe('experience_not_literal')
 const result=await validateActivityFit({activities:[row]},'weekend',[packet],records,async input=>{expect(input.packet.evidence).toHaveLength(2);expect(input.verdict.reason).not.toContain('Relaxing');return {verdict:'no',reason:'availability'}})
 expect(result.accepted).toHaveLength(0)
})


it('repairs a nonliteral quote once without retrying substantive vetoes',()=>{
 for(const code of ['judge_no_unsupported_claim','experience_not_literal'])expect(repairableActivityRejection(code)).toBe(true)
 for(const code of ['judge_no_no_experience','judge_no_incidental','judge_no_identity','judge_no_availability','evidence','no_experience'])expect(repairableActivityRejection(code)).toBe(false)
 const packets=[1,2].map(line=>({venue:{line,name:'Fictional '+line,kind:'activity' as const},status:'ready' as const,evidence:[],notes:[]}))
 const prompt=activityFitRepairPrompt('fun weekend',packets,[{line:1,code:'experience_not_literal'},{line:2,code:'judge_no_no_experience'}])
 expect(prompt).toContain('Fictional 1');expect(prompt).not.toContain('Fictional 2');expect(prompt).toContain('ONE exact numbered spanId')
})


it('server span selection supplies exact quote and its evidence, never model prose',async()=>{
 const records=new SourceRecords(),r=records.capture('web_fetch',{url:'https://fictional.test/workshop',content:'Reed Workshop offers hands-on printmaking sessions.'},'fictional')[0]
 const packet={venue:{line:1,name:'Reed Workshop',kind:'activity' as const},status:'ready' as const,notes:[],evidence:[{id:'ev1_1',source:r.id,url:r.url,title:'Reed Workshop',excerpt:r.content!,origin:'fetched_page' as const,sourceRole:'unclassified' as const}]}
 const span=activityEvidenceSpans(packet)[0]
 const out=await validateActivityFit({activities:[{line:1,decision:'recommend',spanId:span.id,experience:'Invented luxury',evidenceIds:['evil']}]},'weekend',[packet],records,async input=>{expect(input.verdict.experience).toBe(span.text);expect(input.verdict.evidenceIds).toEqual(['ev1_1']);return true})
 expect(out.accepted).toHaveLength(1)
 expect((await validateActivityFit({activities:[{line:1,decision:'recommend',spanId:'span999_1'}]},'weekend',[packet],records,async()=>true)).accepted).toHaveLength(0)
})
