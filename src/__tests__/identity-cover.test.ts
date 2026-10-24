import {it,expect} from 'vitest'
import {writeFile,mkdir} from 'node:fs/promises'
import {renderHtml,identityCover} from '@/lib/files/render'

const optionsDoc={title:'Weekender bags, compared',body:'## Picks\n:::options\nDuffle One | $120 | Tough canvas, lifetime repair. | No laptop sleeve\nCargo Tote | $85 | Light, packs flat. | Thin straps\nTrail Case | $150 | Weatherproof, stiff frame. | Heavy\n:::\n\n:::sources\ncanvas review | https://fictional.test/review | checked 2026-10-24\n:::'}
const placesDoc={title:'Coffee near the quay',body:':::places\nLantern Cafe | unknown | Hours not listed | | 42 Quay St, Harbor | | | | |\nPier Coffee | unknown | Hours not listed | | 9 Dock Rd, Harbor | 07:00-14:00 | | | |\n:::','subtitle':'Saturday morning'}
const briefingDoc={title:'Harbor news this week',body:':::briefing\nFerry refit starts Monday | Harbor Gazette | 2026-10-23 | Two boats out for six weeks | https://fictional.test/ferry\n:::'}

it('a comparison doc gets an identity cover with eyebrow, title and count, and no duplicate h1',()=>{
 const html=renderHtml(optionsDoc)
 expect(html).toContain('band hero itinerary-cover');expect(html).toContain('>Comparison</span>');expect(html).toContain('Weekender bags, compared');expect(html).toContain('3 options')
 expect(html).not.toContain('<h1>Weekender bags, compared</h1>');expect(html).not.toContain('sunrise')
})
it('a places doc carries its subtitle and place count',()=>{
 const html=renderHtml(placesDoc)
 expect(html).toContain('>Places</span>');expect(html).toContain('Saturday morning · 2 places');expect(html).not.toContain('<p class="sub">')
 expect(html).not.toContain('<h1>Coffee near the quay</h1>')
})
it('a briefing doc gets a Briefing cover',()=>{
 expect(renderHtml(briefingDoc)).toContain('>Briefing</span>');expect(renderHtml(briefingDoc)).toContain('1 headline')
})
it('mixed recognized blocks yield counts without an eyebrow',()=>{
 const c=identityCover({title:'Harbor weekend picks',body:':::places\nA | unknown | | | |\n:::\n:::options\nB | $1 | why | catch\nC | $2 | why | catch\n:::'})
 expect(c?.eyebrow).toBe('');expect(c?.sub).toBe('1 place · 2 options')
})
it('docs with no recognized blocks keep the sunrise band and their h1',()=>{
 const html=renderHtml({title:'Packing note',body:'## Things\n- Charger\n- Boots'})
 expect(html).not.toContain('band hero itinerary-cover');expect(html).toContain('<h1>Packing note</h1>')
})
it('richer block heroes still win over the identity cover',()=>{
 const weather=renderHtml({title:'Harbor weather',body:':::weather\nHarbor | 21C | clear | 24 | 18 | 10km | 0% | 21C\n:::'})
 expect(weather).not.toContain('band hero itinerary-cover');expect(weather).toContain('hero-n')
 const stay=renderHtml({title:'Harbor hotels',body:':::stay\nHarbor Inn | $200 | 4.5 | Quay | Small rooms | | https://fictional.test/inn\n:::'})
 expect(stay).not.toContain('band hero itinerary-cover');expect(stay).toContain('hero-stay')
 const itin=renderHtml({title:'Itinerary for Harbor, FL',body:'## Day 1\n- 10am Harbor Museum\n\n## Stops\n:::places\nHarbor Museum | unknown | Hours not listed | | 42 Quay St, Harbor | | 25.0,-80.0 | | |\n:::'})
 expect(itin).toContain('Researched itinerary');expect(itin).not.toContain('>Places</span>')
})
it('place cards fall back to an address-encoded Google Maps link when no coordinates exist',()=>{
 const html=renderHtml(placesDoc)
 expect(html).toContain('https://www.google.com/maps/search/?api=1&amp;query=42%20Quay%20St%2C%20Harbor')
 expect(html).toContain('https://maps.apple.com/?q=42%20Quay%20St%2C%20Harbor')
 const coords=renderHtml({title:'x',body:':::places\nHarbor Museum | unknown | Hours not listed | | 42 Quay St, Harbor | | 25.0,-80.0 | | |\n:::'})
 expect(coords).toContain('https://www.google.com/maps/search/?api=1&amp;query=25.0,-80.0')
 const bare=renderHtml({title:'x',body:':::places\nMystery Spot | unknown | Hours not listed | | | | | | |\n:::'})
 expect(bare).not.toContain('google.com/maps')
})
it('writes fictional artifacts for pixel inspection',async()=>{
 await mkdir('/tmp/identity-proof',{recursive:true})
 await writeFile('/tmp/identity-proof/comparison.html',renderHtml(optionsDoc))
 await writeFile('/tmp/identity-proof/places.html',renderHtml(placesDoc))
 await writeFile('/tmp/identity-proof/briefing.html',renderHtml(briefingDoc))
})
