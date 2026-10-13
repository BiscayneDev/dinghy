import {it,expect} from 'vitest'
import {SourceRecords} from '@/lib/files/source-records'
import {parseActivityJudge,activityFitJudgePrompt,incidentalActivityTags,activityFitPrompt,validateActivityFit,applyActivityFit} from '@/lib/files/itinerary-activity-fit'
it('flags marker subtypes without venue-name hardcodes and retains novel experience categories',()=>{
 expect(incidentalActivityTags(['tourism.attraction.marker'],{})).toBe(true);expect(incidentalActivityTags(['tourism.attraction'],{historic:'commemorative'})).toBe(true);expect(incidentalActivityTags(['tourism.attraction'],{tourism:'museum'})).toBe(false)
})
it('a useful activity needs checked experience evidence and judgment, not attraction category',async()=>{
 const records=new SourceRecords(),r=records.capture('web_fetch',{url:'https://fictional.test/workshop',content:'Reed Workshop offers hands-on printmaking sessions in Harbor.'},'fictional-check')[0]
 const packet={venue:{line:1,name:'Reed Workshop',kind:'activity' as const},status:'ready' as const,notes:[],evidence:[{id:'ev1_1',source:r.id,url:r.url,title:'Reed Workshop',excerpt:r.content!,origin:'fetched_page' as const,sourceRole:'unclassified' as const}]}
 const request='Fun things for the weekend after our workday.'
 const verdict={line:1,decision:'recommend',experience:'Hands-on printmaking sessions',requestBasis:['weekend'],evidenceIds:['ev1_1'],reason:'An active break after the workday.',unknowns:['Session schedule not checked']}
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
 const row={line:1,decision:'recommend',experience:'Hands-on printmaking sessions',evidenceIds:['ev1_1'],reason:'An active break after work.',unknowns:[]}
 expect((await validateActivityFit({activities:[row]},'fun weekend',[packet],records,async input=>({verdict:input.request==='fun weekend'?'yes':'no'}))).accepted).toHaveLength(1)
 expect((await validateActivityFit({activities:[{...row,experience:'x'.repeat(251)}]},'fun weekend',[packet],records,async()=>true)).rejected[0].code).toBe('experience_bounds')
})

it('typed experience verdicts fail closed and carry only finite diagnostic reasons',()=>{
 expect(parseActivityJudge('{"verdict":"yes","reason":"none"}')).toEqual({verdict:'yes',reason:'none'})
 expect(parseActivityJudge('{"verdict":"no","reason":"incidental"}')).toEqual({verdict:'no',reason:'incidental'})
 for(const raw of ['YES','{"verdict":"yes","reason":"uncertain"}','{"verdict":"no","reason":"none"}','{"verdict":"no","reason":"private venue text"}'])expect(parseActivityJudge(raw).verdict).toBe('invalid')
 expect(activityFitJudgePrompt({request:'fun weekend',verdict:{line:1,decision:'recommend',experience:'Hands-on workshop',evidenceIds:[],reason:'Weekend outing',unknowns:[]},packet:{venue:{line:1,kind:'activity',name:'Reed Workshop'},status:'missing',evidence:[],notes:[]}})).toContain('honestly listed as unknown')
})
