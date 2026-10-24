import {it,expect} from 'vitest'
import {apiItineraryBody,apiItineraryComponents,type ApiPlace} from '@/lib/files/geoapify-itinerary'
import {renderKind} from '@/lib/files/kinds'
import {splitBlocks} from '@/lib/files/render'

/** Offline fictional fixtures only: invented venues, invented coordinates. */
const place=(over:Partial<ApiPlace>):ApiPlace=>({line:1,kind:'activity',name:'Fictional Venue',address:'1 Example Quay, Harbor City',lat:41.1,lon:-70.9,id:'wp_fixture',source:'src1',start:0,end:10,...over})
const picks=[
 {kind:'activity',name:'Beacon Toy Museum',place:place({name:'Beacon Toy Museum',hours:'Tue-Sun 10:00-17:00',website:'https://beacon-toy-museum.example'})},
 {kind:'restaurant',name:'Salt Fig Kitchen',place:place({kind:'restaurant',name:'Salt Fig Kitchen',lat:41.1005,lon:-70.901,line:2})},
 {kind:'hotel',name:'The Fictional Gull',place:place({kind:'hotel',name:'The Fictional Gull',lat:41.101,lon:-70.902,line:3,address:''})},
]

it('appends places cards, same-day route legs with directions links, and gallery subjects from verified fields only',()=>{
 const body='## Saturday\n- Stay: The Fictional Gull\n- Eat: Salt Fig Kitchen\n- Do: Beacon Toy Museum\n- Timing is open: no fixed times were given in the request; venue hours are not verified.'
 const out=apiItineraryComponents(body,picks)
 expect(out).toContain('## Stops\n:::places\n')
 const block=out.match(/:::places\n([\s\S]*?)\n:::/)![1].split('\n')
 expect(block).toHaveLength(3)
 const museum=block.find(l=>l.startsWith('Beacon Toy Museum'))!
 const cells=museum.split(' | ')
 expect(cells[1]).toBe('unknown') // open/closed never guessed
 expect(cells[2]).toBe('Provider-reported hours')
 expect(cells[4]).toBe('1 Example Quay, Harbor City')
 expect(cells[5]).toBe('Tue-Sun 10:00-17:00')
 expect(cells[6]).toMatch(/^41\.10000?,-70\.90000?$/)
 expect(cells[7]).toBe('https://beacon-toy-museum.example')
 // Missing fields stay empty, never invented: the hotel has no address, hours or website.
 const hotel=block.find(l=>l.startsWith('The Fictional Gull'))!.split(' | ')
 expect(hotel[4]).toBe('');expect(hotel[5]).toBe('');expect(hotel[7]).toBe('')
 // Route legs mirror written plan order (Stay then Eat then Do) with empty mode/time and a working directions link.
 const route=out.match(/:::route\n([\s\S]*?)\n:::/)![1].split('\n')
 expect(route).toHaveLength(2)
 expect(route[0]).toMatch(/^The Fictional Gull \| Salt Fig Kitchen \|  \|  \|  \| https:\/\/www\.google\.com\/maps\/dir\/\?api=1&origin=41\.10100?,-70\.90200?&destination=41\.10050?,-70\.90100?$/)
 expect(route[1]).toMatch(/^Salt Fig Kitchen \| Beacon Toy Museum \|/)
 // Gallery subjects go through the existing photo step, one per venue.
 const gal=out.match(/:::gallery\n([\s\S]*?)\n:::/)![1].split('\n')
 expect(gal).toEqual(['photo: Beacon Toy Museum | Beacon Toy Museum','photo: Salt Fig Kitchen | Salt Fig Kitchen','photo: The Fictional Gull | The Fictional Gull'])
})

it('omits every component block when picks carry no provider record',()=>{
 const body='## Saturday\n- Timing to confirm.'
 expect(apiItineraryComponents(body,[{kind:'activity',name:'Nothing Grounded'}])).toBe(body)
})

it('draws no route block for a single stop and no cross-day legs',()=>{
 const two=[
  {kind:'activity',name:'Beacon Toy Museum',place:place({name:'Beacon Toy Museum'})},
  {kind:'restaurant',name:'Salt Fig Kitchen',place:place({kind:'restaurant',name:'Salt Fig Kitchen',lat:41.1005,lon:-70.901})},
 ]
 const one='## Saturday\n- Do: Beacon Toy Museum'
 expect(apiItineraryComponents(one,[two[0]])).not.toContain(':::route')
 const across='## Saturday\n- Do: Beacon Toy Museum\n\n## Sunday\n- Eat: Salt Fig Kitchen'
 expect(apiItineraryComponents(across,two)).not.toContain(':::route')
})

it('apiItineraryBody wires components in and keeps the attribution last',()=>{
 const out=apiItineraryBody('Plan Saturday in Harbor City',picks)
 expect(out).toContain(':::places');expect(out).toContain(':::route');expect(out).toContain(':::gallery')
 expect(out.trimEnd().endsWith('© OpenStreetMap contributors. Provider listings do not confirm current hours, availability, prices or quality.')).toBe(true)
 // Blocks parse as components, not stray text.
 const kinds=splitBlocks(out).filter(s=>s.kind==='block').map(s=>(s as {name:string}).name)
 expect(kinds).toEqual(expect.arrayContaining(['places','route','gallery']))
})

it('renderRoute draws a Directions link for the optional link cell and no empty mode pill',()=>{
 const html=renderKind('route',['The Fictional Gull | Salt Fig Kitchen |  |  |  | https://www.google.com/maps/dir/?api=1&origin=41.101,-70.902&destination=41.1005,-70.901'])
 expect(html).toContain('class="rt-dir"')
 expect(html).toContain('https://www.google.com/maps/dir/?api=1&amp;origin=41.101,-70.902&amp;destination=41.1005,-70.901')
 expect(html).not.toContain('rt-mode') // unknown mode renders no empty pill
 expect(html).not.toContain('rt-time')
 // A leg with real mode/time keeps the classic rendering, and a non-http link cell is dropped.
 const classic=renderKind('route',['Harbor City | Airport | taxi | 35 min | booked 7am | not-a-url'])
 expect(classic).toContain('rt-mode');expect(classic).toContain('35 min');expect(classic).not.toContain('rt-dir')
})

it('places card lines carry coordinates the renderer turns into map links',()=>{
 const body=apiItineraryComponents('## Saturday\n- Do: Beacon Toy Museum\n- Eat: Salt Fig Kitchen',picks.slice(0,2))
 const lines=body.match(/:::places\n([\s\S]*?)\n:::/)![1].split('\n')
 expect(lines[0]).toContain('41.10000,-70.90000')
 expect(lines[1]).toContain('41.10050,-70.90100')
})
