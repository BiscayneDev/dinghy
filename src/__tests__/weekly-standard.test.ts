import {afterEach,describe,expect,it,vi} from 'vitest'
import {weeklyListRequest,weeklyPageError} from '@/lib/files/weekly-standard'
import {chatWithTools} from '@/lib/spectrum/dinghy'
import {renderHtml} from '@/lib/files/render'
vi.mock('@/lib/data-portability/erasure-state',()=>({assertAccountActive:vi.fn(async()=>{})}))
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks()})
const ask='What are the top sci-fi books this week?'
const u='https://example.test/fictional-weekly-chart'
const media=':::media\nHarbor Star | book | 2026 | | Alex Example | First on the chart | | https://example.test/book\n:::'
const sources=`:::sources\nHarbor Review weekly chart | ${u} | list published 2026-10-09, checked 2026-10-10\n:::`
describe('current list standard',()=>{
 it('does not gate ordinary evergreen recommendations',()=>{expect(weeklyListRequest(ask)).toBe(true);expect(weeklyPageError({body:'classic favorites'},'recommend books',[])).toBeNull()})
 it('rejects unsourced generic classics and unobserved source URLs',()=>{expect(weeklyPageError({body:media},ask,[u])).toContain(':::sources');expect(weeklyPageError({body:media+'\n'+sources},ask,[])).toContain('exact URL')})
 it('requires visible date and media rows',()=>{expect(weeklyPageError({body:sources},ask,[u])).toContain(':::media');expect(weeklyPageError({body:media+'\n'+sources.replace('list published 2026-10-09, checked 2026-10-10','recent')},ask,[u])).toContain('YYYY-MM-DD')})
 it('renders source names, links and dates in the page',()=>{const html=renderHtml({title:'Harbor books this week',body:media+'\n'+sources});expect(html).toContain('Harbor Review weekly chart');expect(html).toContain('list published 2026-10-09, checked 2026-10-10');expect(html).toContain(u);expect(html).toContain('Harbor Star')})
 it('accepts named dated observed evidence with media',()=>{expect(weeklyPageError({body:media+'\n'+sources},ask,[u])).toBeNull()})
})

describe('weekly tool enforcement',()=>{
 it('blocks the unsourced page before execution and lets a repaired page use this turn evidence',async()=>{
  let n=0;const bodies:any[]=[];const file=vi.fn(async()=>({success:true,data:{status:'queued_for_delivery'}}));
  vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{bodies.push(JSON.parse(init.body));n++;const name=n===1?'web_search':n<=3?'create_file':null;const args=n===2?{title:'Harbor picks',body:media+'\n{{source:src1.title}}'}:{title:'Harbor picks',body:media+'\n'+sources.replace(u,'{{source:src1.url}}')};return new Response(JSON.stringify({choices:[{finish_reason:name?'tool_calls':'stop',message:name?{content:null,tool_calls:[{id:String(n),function:{name,arguments:JSON.stringify(args)}}]}:{content:'Here you go.'}}]}))}));
  const r=await chatWithTools([{role:'user',content:ask}],{gatewayUrl:'https://gateway.test',apiKey:'test',model:'test'},[{name:'web_search',description:'test',inputSchema:{},execute:async()=>({success:true,data:{results:[{title:'Harbor Review',url:u,published_date:'2026-10-09'}]}})},{name:'create_file',description:'test',inputSchema:{},execute:file}],{userId:'fictional',telegramId:0,telegramChatId:0,name:'Alex',timezone:'UTC',tokens:{}});
  expect(file).toHaveBeenCalledTimes(1);expect(JSON.stringify(bodies[2].messages)).toContain('current top list needs');expect(r.reply).toBe('Here you go.');
 })
})
