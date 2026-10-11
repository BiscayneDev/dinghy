import {afterEach,describe,expect,it,vi} from 'vitest'
const {publishSite,card,remember}=vi.hoisted(()=>({publishSite:vi.fn(),card:vi.fn(),remember:vi.fn(async()=>{})}))
vi.mock('@/lib/spectrum/plans',()=>({rememberFile:remember,findFile:vi.fn()}))
vi.mock('@/lib/supabase/server',()=>({createServerClient:()=>({})}))
vi.mock('@/lib/files/share',()=>({publishSite,shareEnabled:()=>true,revokeSite:vi.fn(),updateSite:vi.fn()}))
vi.mock('@/lib/files/photos',()=>({attachPhotos:async(body:string)=>({body,photos:[]})}))
vi.mock('@/lib/brand/kind-card',()=>({renderHeroOg:async()=>null,renderKindCard:card}))
import {fileReply} from '@/lib/files/reply'
import {fileToolsFor} from '@/lib/files/tool'
import {chatWithTools} from '@/lib/spectrum/dinghy'
import {TurnDeadlineExceeded} from '@/lib/spectrum/turn-budget'
import type {UserContext} from '@/lib/llm/types'
const ctx={userId:'fictional',chatGuid:'fictional-chat',tokens:{},timezone:'UTC'} as UserContext
const input={title:'Harbor picks',body:'Fictional reading list',format:'html'}
const site={url:'https://fictional-harbor.here.now/',slug:'fictional-harbor',expiresAt:'2030-01-01T00:00:00Z'}
const deferred=<T>()=>{let resolve!:(value:T)=>void;return{promise:new Promise<T>(r=>{resolve=r}),resolve}}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.clearAllMocks()})
describe('publish settlement',()=>{
 it('reconciles a settled queue before contradictory failure copy',()=>{expect(fileReply('The page creation timed out. I could not make it.',1)).toBe('Here you go.')})
 it('queues the settled page before optional card work finishes',async()=>{publishSite.mockResolvedValue(site);const d=deferred<Buffer|null>();card.mockReturnValue(d.promise);const set=fileToolsFor();const run=set.tools[0].execute(input,{...ctx,photosOk:true});await vi.waitFor(()=>expect(set.files()).toHaveLength(1));expect(set.files()[0].hosted).toEqual(site);set.close();d.resolve(null);expect((await run).success).toBe(true);expect(remember).toHaveBeenCalledWith('fictional','fictional-chat',expect.anything())})
 it('never mutates a closed delivery queue after deferred publishing settles',async()=>{const d=deferred<typeof site>();publishSite.mockReturnValue(d.promise);const set=fileToolsFor();const run=set.tools[0].execute(input,ctx);await vi.waitFor(()=>expect(publishSite).toHaveBeenCalled());set.close();d.resolve(site);expect((await run).success).toBe(false);expect(set.files()).toHaveLength(0);expect(remember).toHaveBeenCalledWith('fictional','fictional-chat',expect.objectContaining({url:site.url}))})
 it('waits past 15 seconds for create_file without returning a false timeout',async()=>{vi.useFakeTimers();const d=deferred<{success:boolean;data:unknown}>();vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:'1',function:{name:'create_file',arguments:'{}'}}]}}]}))));const run=chatWithTools([{role:'user',content:'make a reading page'}],{gatewayUrl:'https://gateway.test',apiKey:'test',model:'test',deadlineAt:Date.now()+60000},[{name:'create_file',description:'test',inputSchema:{},execute:()=>d.promise}],ctx);await vi.advanceTimersByTimeAsync(16000);d.resolve({success:true,data:{status:'queued_for_delivery'}});vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:'Here you go.'},finish_reason:'stop'}]}))));expect((await run).reply).toBe('Here you go.')})
 it('aborts at the real turn deadline without a late delivery queue entry',async()=>{vi.useFakeTimers();const d=deferred<typeof site>();publishSite.mockReturnValue(d.promise);const set=fileToolsFor();vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:'1',function:{name:'create_file',arguments:JSON.stringify(input)}}]}}]}))));const run=chatWithTools([{role:'user',content:'make a page'}],{gatewayUrl:'https://gateway.test',apiKey:'test',model:'test',deadlineAt:Date.now()+1000},set.tools,ctx);const failure=expect(run).rejects.toBeInstanceOf(TurnDeadlineExceeded);await vi.advanceTimersByTimeAsync(1000);await failure;set.close();d.resolve(site);await vi.advanceTimersByTimeAsync(1);expect(set.files()).toHaveLength(0)})
})
