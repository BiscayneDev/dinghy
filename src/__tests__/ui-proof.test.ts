import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
const {chat,file,close,enqueue}=vi.hoisted(()=>({chat:vi.fn(),file:vi.fn(),close:vi.fn(),enqueue:vi.fn()}))
vi.mock('@/lib/spectrum/dinghy',()=>({chatWithTools:chat}))
vi.mock('@/lib/spectrum/config',()=>({SHIPYARD_API_KEY:'fictional-key',SHIPYARD_MODEL:'pinned',GATEWAY_URL:'https://gateway.test'}))
vi.mock('@/lib/files/tool',()=>({fileToolsFor:()=>({tools:[{name:'create_file'},{name:'revoke_file'},{name:'find_places'}],files:file,close})}))
vi.mock('@/lib/spectrum/outbox',()=>({enqueueOutbox:enqueue}))
vi.mock('@/lib/spectrum/waitlist-invites',()=>({chatGuidForPhone:(p:string)=>'any;-;'+p}))
import {runUiProof,UI_PROOF_REQUEST,UI_PROOF_SENDER,UI_PROOF_BLIND_SPOTS} from '@/lib/spectrum/ui-proof'
import {selectDeliverable} from '@/lib/files/deliverable-contract'
import {jevUiEnabled} from '@/lib/pages/catalogue'
beforeEach(()=>{vi.stubEnv('HERENOW_API_KEY','fictional');vi.stubEnv('DINGHY_UI_PROOF_RECIPIENT','+15550001111');file.mockReturnValue([{title:'Synthetic UI self-test',bytes:Buffer.from('HTML'),mimeType:'text/html',card:Buffer.from('PNG'),markdown:'fictional',hosted:{url:'https://fictional.here.now/',expiresAt:'2030-06-04'}}]);chat.mockImplementation(async(_h,o)=>{await o.onStage('context','ui:jev:generate');return{reply:'done'}});enqueue.mockResolvedValue('outbox-1')})
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks()})
describe('UI proof runner',()=>{
 it('uses only fixed input, blank identity, the self-test sender, and exactly one gated run',async()=>{
  const record=vi.fn(async()=>{}),result=await runUiProof(record)
  expect(result.verdict).toBe('passed');expect(result.route).toBe('generate')
  expect(chat).toHaveBeenCalledTimes(1)
  expect(chat.mock.calls[0][0]).toEqual([{role:'user',content:UI_PROOF_REQUEST}])
  expect(chat.mock.calls[0][1]).toMatchObject({sender:UI_PROOF_SENDER,capabilities:{google:false,wallet:false,files:true,search:false}})
  expect(chat.mock.calls[0][2].map((t:any)=>t.name)).toEqual(['create_file'])
  expect(chat.mock.calls[0][3]).toEqual({userId:'',telegramId:0,telegramChatId:0,name:'Synthetic test',timezone:'America/New_York',tokens:{}})
  expect(close).toHaveBeenCalledOnce()
 })
 it('fixed request matches no legacy deliverable kind, so the UI gate routes it',()=>{
  expect(selectDeliverable([{role:'user',content:UI_PROOF_REQUEST}])).toBeNull()
 })
 it('self-test handle gates only itself: no organic owner exposure in either direction',()=>{
  vi.stubEnv('DINGHY_JEV_UI',UI_PROOF_SENDER)
  expect(jevUiEnabled(UI_PROOF_SENDER)).toBe(true)
  expect(jevUiEnabled('+12035168398')).toBe(false)
  vi.stubEnv('DINGHY_JEV_UI','+12035168398')
  expect(jevUiEnabled(UI_PROOF_SENDER)).toBe(false)
 })
 it('delivers one fixed-marker plain link to the env-fixed recipient, never model text',async()=>{
  const result=await runUiProof(async()=>{})
  expect(enqueue).toHaveBeenCalledTimes(1)
  const [guid,kind,text]=enqueue.mock.calls[0]
  expect(guid).toBe('any;-;+15550001111');expect(kind).toBe('reply')
  expect(text).toContain('fictional');expect(text).toContain('https://fictional.here.now/')
  expect(text).not.toContain('done')
  expect(result.delivery).toEqual({outboxId:'outbox-1'})
 })
 it('no artifact or no recipient means nothing is delivered',async()=>{
  file.mockReturnValue([])
  const r1=await runUiProof(async()=>{})
  expect(r1.verdict).toBe('failed');expect(r1.delivery).toEqual({skipped:'no_artifact'})
  file.mockReturnValue([{title:'t',bytes:Buffer.from('H'),mimeType:'text/html',hosted:{url:'https://fictional.here.now/',expiresAt:'x'}}])
  vi.stubEnv('DINGHY_UI_PROOF_RECIPIENT','')
  const r2=await runUiProof(async()=>{})
  expect(r2.delivery).toEqual({skipped:'no_recipient'})
  expect(enqueue).not.toHaveBeenCalled()
 })
 it('never calls the gateway without required keys',async()=>{vi.stubEnv('HERENOW_API_KEY','');expect((await runUiProof(async()=>{})).verdict).toBe('unavailable');expect(chat).not.toHaveBeenCalled()})
 it('a failed run is not retried, leaks no raw error, and closes the queue',async()=>{chat.mockRejectedValue(new Error('secret bearer raw response'));const report=await runUiProof(async()=>{});expect(report.verdict).toBe('failed');expect(chat).toHaveBeenCalledTimes(1);expect(enqueue).not.toHaveBeenCalled();expect(JSON.stringify(report)).not.toContain('secret bearer');expect(close).toHaveBeenCalledOnce()})
 it('blind spots stay explicit about the owner-number gap and failed-attempt cost',()=>{
  expect(UI_PROOF_BLIND_SPOTS.join(' ')).toMatch(/owner-number allowlist match is unit-tested only/)
  expect(UI_PROOF_BLIND_SPOTS.join(' ')).toMatch(/may still be billed/)
 })
})
