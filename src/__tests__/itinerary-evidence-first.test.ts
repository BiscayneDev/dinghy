import {it,expect,vi} from 'vitest'
import {SourceRecords} from '@/lib/files/source-records'
import {selectEvidenceFirst} from '@/lib/files/itinerary-evidence-first'
function fixture(){const records=new SourceRecords(),text='Reed Workshop has printmaking exhibits. It offers hands-on carving sessions.',r=records.capture('web_fetch',{url:'https://fictional.test/workshop',content:text},'fictional')[0];const packet={venue:{line:1,name:'Reed Workshop',kind:'activity' as const},status:'ready' as const,notes:[],evidence:[{id:'ev1_1',source:r.id,url:r.url,title:'Reed Workshop',excerpt:text,origin:'fetched_page' as const,sourceRole:'unclassified' as const}]};return {records,packet}}
it('judges two exact current spans separately and retains the accepted one',async()=>{
 const {records,packet}=fixture(),judge=vi.fn(async (input:Parameters<import('@/lib/files/itinerary-activity-fit').ActivityFitJudge>[0])=>({verdict:input.verdict.experience.includes('carving')?'yes' as const:'no' as const,reason:input.verdict.experience.includes('carving')?'none' as const:'no_experience' as const}))
 const result=await selectEvidenceFirst('weekend',[packet],records,async()=>({spanIds:['span1_1','span1_2']}),async()=>true,judge,new AbortController().signal)
 expect(judge).toHaveBeenCalledTimes(2);expect(result.activities).toHaveLength(1);expect(result.reasons[0].why).toContain('hands-on carving');expect(result.reasons[0].citations[0].url).toBe('https://fictional.test/workshop')
})
it('unknown spans and aborted work grant no reason or activity',async()=>{
 const {records,packet}=fixture(),judge=vi.fn(async()=>true),controller=new AbortController()
 const result=await selectEvidenceFirst('weekend',[packet],records,async()=>({spanIds:['span999_1']}),judge,judge,controller.signal)
 expect(result.reasons).toEqual([]);expect(judge).not.toHaveBeenCalled();controller.abort()
 expect((await selectEvidenceFirst('weekend',[packet],records,async()=>({spanIds:['span1_1']}),judge,judge,controller.signal)).reasons).toEqual([])
})
it('synthesis claims can use only independently accepted spans and must pass unchanged judge',async()=>{
 const {records,packet}=fixture(),judge=vi.fn(async()=>true),signal=new AbortController().signal
 const result=await selectEvidenceFirst('weekend',[packet],records,async()=>({spanIds:['span1_1','span1_2']}),judge,judge,signal,async()=>({why:'Printmaking exhibits and hands-on carving give you two things to explore.',claims:[{text:'Printmaking exhibits and hands-on carving',spanIds:['span1_1','span1_2']}]}))
 expect(result.reasons[0].why).toContain('two things');expect(result.reasons[0].claims[0].evidenceIds).toEqual(['ev1_1'])
 const rejected=await selectEvidenceFirst('weekend',[packet],records,async()=>({spanIds:['span1_1']}),judge,judge,signal,async()=>({why:'Free admission every weekend',claims:[{text:'Free admission',spanIds:['invented']}]}))
 expect(rejected.reasons[0].why).toContain('The source describes');expect(rejected.rejected).toContain('synthesis_span')
})
