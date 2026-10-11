import {afterEach,describe,expect,it,vi} from 'vitest'
const {rows,db,sendLink}=vi.hoisted(()=>({rows:{data:[] as unknown[],error:null as unknown},db:vi.fn(),sendLink:vi.fn()}))
vi.mock('@/lib/supabase/server',()=>({createServerClient:()=>({from:db})}))
vi.mock('@/lib/spectrum/links',()=>({sendLink}))
import {wantsPageResend,latestChatFile,verifiedPage,deliverHostedLink} from '@/lib/files/recover'
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks()})
const url='https://fictional-harbor.here.now/'
const file={title:'Harbor reading',url,expires_at:'2030-01-01T00:00:00Z'}
const setup=(data:unknown[])=>{rows.data=data;const q:any={};for(const k of ['select','eq','is','order','or'])q[k]=()=>q;q.limit=async()=>rows;db.mockReturnValue(q)}
describe('page recovery',()=>{
 it('recognizes complaints without creating a new document',()=>{for(const s of ['You didn’t send me the Page','where is the page?','resend the document','send me the link'])expect(wantsPageResend(s)).toBe(true);expect(wantsPageResend('?','Here you go.')).toBe(true);expect(wantsPageResend('?','Which city?')).toBe(false);expect(wantsPageResend('make a new page')).toBe(false)})
 it('isolates chat and exact expiry, supports only history-bound legacy records',async()=>{setup([{...file,chat_guid:'other'},{...file,expires_at:'2020-01-01',chat_guid:'chat'},{...file,chat_guid:null}]);expect(await latestChatFile('u','chat',[])).toBeNull();expect(await latestChatFile('u','chat',[`[file: Harbor reading] ${url}`])).toMatchObject(file)})
 it('checks actual title before resending and rejects expired/redirected content',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>new Response('<title>Harbor reading · Dinghy</title>',{headers:{'content-type':'text/html'}})));expect(await verifiedPage(file)).toBe(true);vi.stubGlobal('fetch',vi.fn(async()=>new Response('<title>Not found</title>',{headers:{'content-type':'text/html'}})));expect(await verifiedPage(file)).toBe(false)})
 it('uses durable sendLink and exposes failed outcome',async()=>{sendLink.mockResolvedValue(false);expect(await deliverHostedLink({send:async()=>{}},'chat',url)).toBe(false);expect(sendLink).toHaveBeenCalledWith(expect.anything(),'chat','reply',url)})
})
