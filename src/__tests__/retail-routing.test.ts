import {afterEach,describe,expect,it,vi} from 'vitest'
import {isFoodDrinkQuery,isRetailAvailability,wantsPlaces} from '@/lib/places/intent'
import {gateTools} from '@/lib/spectrum/tool-gating'
import {fileToolsFor} from '@/lib/files/tool'
import {chatWithTools} from '@/lib/spectrum/dinghy'
vi.mock('@/lib/data-portability/erasure-state',()=>({assertAccountActive:vi.fn(async()=>{})}))
afterEach(()=>vi.unstubAllGlobals())
const ctx={userId:'fictional',telegramId:0,telegramChatId:0,name:'Alex',timezone:'UTC',tokens:{}}
const ask='Flying into Harbor Airport, where can I find nicotine pouches?'
const tool=(name:string)=>({name,description:'test',inputSchema:{},execute:vi.fn(async()=>({success:true,data:{}}))})
describe('retail vs food routing',()=>{
 it('keeps food discovery but excludes retail and mixed requests',()=>{for(const s of ['chicken rice','burger','coffee','laksa','vegan food','buy coffee','coffee shop','buy a burger'])expect(isFoodDrinkQuery(s)).toBe(true);for(const s of ['nicotine pouches','phone charger','pharmacy','coffee and cigarettes'])expect(isFoodDrinkQuery(s)).toBe(false);expect(isRetailAvailability(ask)).toBe(true);expect(wantsPlaces('where can I get coffee and nicotine near the airport')).toBe(false)})
 it('removes the food finder despite prior food context, including small toolsets',()=>{const gated=gateTools([tool('find_places'),tool('web_search')],[ask,'where to eat nearby']);expect(gated.active.map(t=>t.name)).toEqual(['web_search'])})
 it('refuses unsupported products before any map query or page publishing',async()=>{const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const r=await fileToolsFor().tools.find(t=>t.name==='find_places')!.execute({anchor:'Harbor Airport',what:'nicotine pouches'},ctx);expect(r.success).toBe(false);expect(r.error).toContain('only finds food and drink');expect(fetch).not.toHaveBeenCalled()})
 it('offers search, not eateries, and supplies terminal/access/stock grounding guidance',async()=>{const bodies:any[]=[];const search=tool('web_search'),food=tool('find_places');vi.stubGlobal('fetch',vi.fn(async(_u,init)=>{bodies.push(JSON.parse(init.body));return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'I checked the retailer directory.'}}]}))}));await chatWithTools([{role:'user',content:ask}],{gatewayUrl:'https://gateway.test',apiKey:'test',model:'test'},[search,food],ctx);expect(bodies[0].tool_choice).toEqual({type:'function',function:{name:'web_search'}});expect(bodies[0].tools.map((t:any)=>t.function.name)).toEqual(['web_search']);expect(JSON.stringify(bodies[0].messages)).toContain('airside/landside');expect(JSON.stringify(bodies[0].messages)).toContain('current stock');expect(food.execute).not.toHaveBeenCalled()})
})
