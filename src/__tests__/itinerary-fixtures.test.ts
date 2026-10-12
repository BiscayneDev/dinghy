import {it,expect} from 'vitest'
import {SourceRecords} from '@/lib/files/source-records'
import {extractMentions,hintCounts} from '@/lib/files/itinerary-mentions'
import {compileMentionSelection,requiredKinds,missingKinds,mergePicks} from '@/lib/files/itinerary-selection'
/** Offline fictional fixtures: varied page shapes, so selection quality is tested without paid runs. */
const NAV='Home\nAbout\nContact\nBook Now\nSign In\nPrivacy Policy\n'
const pages:Record<string,{content:string;expect:Record<'hotel'|'restaurant'|'activity',string[]>}>={
 listicle:{content:NAV+'Best of Harbor City\n1. The Gull Hotel - boutique rooms from $210 a night\n2. Lantern Inn - quiet rooms near the pier\n3. Salt & Vine - seafood tasting menu\n4. Blue Door Cafe - brunch spot\n5. Maritime Museum - harbor history exhibits\n6. Pier Kayak Tours - sunset paddle\n',
  expect:{hotel:['Gull Hotel','Lantern Inn'],restaurant:['Salt & Vine','Blue Door Cafe'],activity:['Maritime Museum','Pier Kayak Tours']}},
 sparse_prose:{content:'Visitors to Harbor City often start at Cormorant House, where the rooms overlook the water. For dinner, locals recommend Nori Nori and Pasta Lab. On Saturday try Beacon Hill Walk or the Foundry Gallery.',
  expect:{hotel:['Cormorant House'],restaurant:['Nori Nori','Pasta Lab'],activity:['Beacon Hill Walk','Foundry Gallery']}},
 no_keywords:{content:NAV+'## Our picks\n### Coral Lane Murals\nStreet art district.\n### Tidewater Parlor\nOpen late.\n### The Marlow\nLuxury on the beach.\n### Pelican\'s Crab Shack\nA classic.\n',
  expect:{hotel:['Marlow'],restaurant:["Pelican's Crab Shack",'Tidewater Parlor'],activity:['Coral Lane Murals']}},
 nav_heavy:{content:Array.from({length:60},(_,i)=>`Partner Offer Nr${i} Special\n`).join('')+'Stay: Harborview Suites\nEat: Copper Kettle Bistro\nDo: Lighthouse Boat Tour\n',
  expect:{hotel:['Harborview Suites'],restaurant:['Copper Kettle Bistro'],activity:['Lighthouse Boat Tour']}}}
for(const [name,fx] of Object.entries(pages))it(`fixture ${name}: menu carries a literal span for every expected venue and picks compile`,()=>{
 const r=new SourceRecords();r.capture('web_fetch',{url:'https://fixture.test/'+name,title:name,content:fx.content},'2026-01-01T00:00:00Z')
 const menu=extractMentions(r,60,['hotel','restaurant','activity'],{evidence:false})
 expect(menu.length).toBeLessThanOrEqual(60);expect(hintCounts(menu)).toMatch(/^h\d+_r\d+_a\d+_n\d+$/)
 const picks:any[]=[],unhinted:any[]=[]
 for(const kind of ['hotel','restaurant','activity'] as const)for(const want of fx.expect[kind]){
  const m=menu.find(x=>x.text.includes(want)||want.includes(x.text));expect(m,`${name}: ${want} missing from menu ${menu.map(x=>x.text).join('|')}`).toBeTruthy()
  expect(r.pageText('src1')!.slice(m!.start,m!.end)).toBe(m!.text)
  ;(m!.hint===kind?picks:unhinted).push({kind,id:m!.id,reason:'r',catch:'c'})
 }
 // Hard evidence rule: only entries whose own sentence hints the chosen kind can be picked; the rest are rejected, never relabeled.
 for(const u of unhinted){const o=compileMentionSelection({candidates:[u]},menu,r);expect('error' in o&&o.dropped[0]).toMatch(/no_kind_evidence|kind_conflict/)}
 if(!picks.length)return
 const out=compileMentionSelection({candidates:picks},menu,r)
 expect('error' in out).toBe(false);if('error' in out)return
 expect(out.dropped).toEqual([]);expect(out.candidates.length).toBe(picks.length)
})
import {decodeEntities} from '@/lib/tools/web'
import {neutralizeUnpickedVenues} from '@/lib/files/itinerary-selection'
const page=(content:string)=>{const r=new SourceRecords();r.capture('web_fetch',{url:'https://fixture.test/x',title:'x',content},'2026-01-01T00:00:00Z');return r}
it('decodes named, numeric and double-encoded entities',()=>{
 expect(decodeEntities('Kestrel Lodge &amp;amp;amp; Suites')).toBe('Kestrel Lodge & Suites')
 expect(decodeEntities('Caf&eacute; Lune &#8211; Bar &#x27;n&#39; Grill &lt;3')).toBe("Café Lune – Bar 'n' Grill <3")
 expect(decodeEntities('keep &unknownthing; as is')).toBe('keep &unknownthing; as is')
})
it('trims descriptor suffixes and drops category headings, keeping real names including "& Suites"',()=>{
 const r=page('Luxury Hotels\nBest of Harbor City\nTop Attractions\nThings To Do\nBest Restaurants in Harbor City\nKestrel Lodge & Suites\nMaple Street Museum – Corporate Events\nRiverside Green - Waterfront\nVisit Bayside Garden – Waterfront views and a cafe.\n')
 const t=extractMentions(r,60,['hotel','restaurant','activity'],{evidence:false}).map(m=>m.text)
 for(const bad of ['Luxury Hotels','Best of Harbor City','Top Attractions','Things To Do','Best Restaurants in Harbor City'])expect(t).not.toContain(bad)
 expect(t.some(x=>/[–—]/.test(x)||/ - /.test(x))).toBe(false)
 expect(t).toContain('Kestrel Lodge & Suites');expect(t).toContain('Maple Street Museum');expect(t).toContain('Riverside Green');expect(t).toContain('Bayside Garden')
})
it('hard kind rule: a hotel-hinted entry cannot be relabeled as an activity, even when no activity is hinted',()=>{
 for(const text of ['Stay at The Marlow Hotel, rooms per night.\nSee Coral Lane Gallery, a museum tour.\n','Stay at The Marlow Hotel, rooms per night.\n']){
  const pg=page(text),menu=extractMentions(pg,60,['activity'],{evidence:false}),hot=menu.find(m=>m.text.includes('Marlow'))!
  const out=compileMentionSelection({candidates:[{kind:'activity',id:hot.id,reason:'r',catch:'c'}]},menu,pg)
  expect('error' in out&&out.dropped).toEqual(['kind_conflict'])
 }
})
it('freehand body lines naming venue-like entities outside the picks are removed; picks, headings and user-named places stay',()=>{
 const body='## Friday\n- 10:00 Office visit at Harbor Tower\n- Dinner at Copper Kettle Bistro\n- Check in at Four Corners Hotel\nWorking sessions: venue and duration to confirm.'
 const out=neutralizeUnpickedVenues(body,['Copper Kettle Bistro'],'Plan Friday with office visit at Harbor Tower and hotel recommendations')
 expect(out.removed).toBe(1);expect(out.body).toContain('Copper Kettle Bistro');expect(out.body).toContain('Harbor Tower');expect(out.body).not.toContain('Four Corners');expect(out.body).toContain('## Friday')
})
import {isHubUrl,placeWordsFrom} from '@/lib/files/itinerary-mentions'
const cap=(url:string,content:string)=>{const r=new SourceRecords();r.capture('web_fetch',{url,title:'t',content},'2026-01-01T00:00:00Z');return r}
it('source gate: aggregator and search hubs are skipped, article pages are kept',()=>{
 for(const u of ['https://www.google.com/travel/hotels/harbor','https://www.bing.com/search?q=x','https://www.instagram.com/p/1','https://example.test/search/hotels'])expect(isHubUrl(u)).toBe(true)
 for(const u of ['https://guide.test/harbor-weekend','https://x.test/blog'])expect(isHubUrl(u)).toBe(false)
 const r=cap('https://www.google.com/travel/hotels','Aggregator Hub offers rooms from $100. Aggregator Flights shows tickets.')
 expect(extractMentions(r,45,['hotel']).length).toBe(0)
})
it('evidence gate: UI labels without venue facts are not offered; named venues with facts are', ()=>{
 const r=cap('https://guide.test/a','Sign in with Account Menu. Cookie Settings Panel everywhere.\nThe Gull Hotel is located at 12 Quay Street with rooms from $210 per night.\nDinner at Salt & Vine, a seafood menu from a notable chef.\nWe love Reader Favorites too.')
 const t=extractMentions(r,45,['hotel','restaurant','activity']).map(m=>m.text)
 expect(t.some(x=>/Gull Hotel/.test(x))).toBe(true);expect(t).toContain('Salt & Vine')
 for(const bad of ['Account Menu','Cookie Settings Panel','Reader Favorites'])expect(t).not.toContain(bad)
 expect(extractMentions(r,45,[])[0].context).toMatch(/\./.test(extractMentions(r,45,[])[0].context)?/./:/./)
})
it('gazetteer: city and district names from the request are never menu entries, even with evidence',()=>{
 const req='Plan Friday in Harbor City with a hotel in Old Quarter'
 const r=cap('https://guide.test/b','Harbor City is a place with hotels from $100. Old Quarter has dinner and rooms. The Gull Hotel has rooms near Old Quarter. Quay District is lively with dinner menus. Gull Tower is located on 4 Quay Street.')
 const t=extractMentions(r,45,['hotel'],{placeWords:placeWordsFrom(req)}).map(m=>m.text)
 expect(t).not.toContain('Harbor City');expect(t).not.toContain('Old Quarter');expect(t).not.toContain('Quay District');expect(t.some(x=>/Gull/.test(x))).toBe(true)
})
it('entities in captured titles and content are decoded', ()=>{
 const r=new SourceRecords();r.capture('web_fetch',{url:'https://guide.test/c',title:'Rook &amp;amp; Thistle &amp; Co',content:'Rook &amp;amp; Thistle serves dinner.'},'2026-01-01T00:00:00Z')
 expect(r.pageText('src1')).toBe('Rook & Thistle serves dinner.')
})
it('body naming other venues, including no-keyword names, is stripped; generic lines stay',()=>{
 const body='## Friday\n- Check in at your hotel\n- Drinks at Fenn tonight\n- Lunch near Tern Sand Club\n- Dinner at Salt & Vine'
 const out=neutralizeUnpickedVenues(body,['Salt & Vine'],'Plan Friday in Harbor City')
 expect(out.body).not.toContain('Fenn');expect(out.body).not.toContain('Tern');expect(out.body).toContain('your hotel');expect(out.body).toContain('Salt & Vine')
})
it('source binding still works after capture-time decode: picks reference literal decoded page text',()=>{
 const r=new SourceRecords();r.capture('web_fetch',{url:'https://guide.test/d',title:'t',content:'Visit Rook &amp;amp; Thistle for dinner, a seafood menu tasting from a chef at 9 Quay Street.\nThe Kestrel Lodge has rooms from $120 per night.'},'2026-01-01T00:00:00Z')
 const menu=extractMentions(r,45,['hotel','restaurant']),rt=menu.find(m=>m.text==='Rook & Thistle')!
 expect(rt).toBeTruthy();expect(r.pageText('src1')!.slice(rt.start,rt.end)).toBe('Rook & Thistle')
 const out=compileMentionSelection({candidates:[{kind:'restaurant',id:rt.id,reason:'r',catch:'c'}]},menu,r)
 expect('error' in out).toBe(false)
})

import {isNonVenueName} from '@/lib/files/itinerary-mentions'
it('name filter: site brands, domains and countries/states/cities are never menu entries',()=>{
 for(const n of ['Booking.com','Expedia','TripAdvisor','Hotels.com','Airbnb','America','United States','New York','Florida','Harbor.net'])expect(isNonVenueName(n),n).toBe(true)
 for(const n of ['Kestrel Lodge','Salt & Vine','Pier Kayak Tours'])expect(isNonVenueName(n),n).toBe(false)
 const r=cap('https://guide.test/e','Compare rooms on Booking.com from $90 per night. The best hotels in America have rooms from $120. The Kestrel Lodge has rooms from $150 per night.')
 const t=extractMentions(r,45,['hotel']).map(m=>m.text)
 expect(t).not.toContain('America');expect(t.some(x=>/Booking/.test(x))).toBe(false);expect(t.some(x=>/Kestrel/.test(x))).toBe(true)
})
it('zero-hint kind: no hotel-hinted entries means every hotel pick is rejected (honest partial upstream)',()=>{
 const r=cap('https://guide.test/f','Dinner at Salt & Vine, a seafood menu from a chef at 9 Quay Street. Visit the Maritime Museum, tickets at the door.')
 const menu=extractMentions(r,45,['hotel','restaurant','activity'])
 expect(menu.some(m=>m.hint==='hotel')).toBe(false)
 for(const m of menu){const o=compileMentionSelection({candidates:[{kind:'hotel',id:m.id,reason:'r',catch:'c'}]},menu,r);expect('error' in o).toBe(true)}
})
it('body contradiction: lines saying no restaurants are recommended are removed, and lines naming unpicked entities too',()=>{
 const body='## Friday\n- Lunch near Dilmar Beach Club\n- No restaurants are recommended here.\n- Dinner at Salt & Vine\n- Smith & Wolfe steakhouse at 8'
 const out=neutralizeUnpickedVenues(body,['Salt & Vine'],'Plan Friday in Harbor City')
 expect(out.body).not.toMatch(/Dilmar|Wolfe|No restaurants/);expect(out.body).toContain('Salt & Vine');expect(out.removed).toBe(3)
})

it('headings naming unpicked venues are removed with their orphaned lines; generic headings and agenda survive',()=>{
 const body='## Agenda\n- 10:00 Office visit at Harbor Tower\n## Day 1\n- Check in at your hotel\n## Option 1: Dilmar Beach Club\n- Sunset drinks\n- Cabanas from 4\n## Smith & Wolfe\n- Steaks\n## Working sessions\nWorking sessions: venue and duration to confirm.\n## Salt & Vine\n- Dinner at 8\n## Not found\nI couldn\'t verify a pick for activities.'
 const out=neutralizeUnpickedVenues(body,['Salt & Vine'],'Plan Friday with office visit at Harbor Tower and Day 1 agenda').body
 for(const bad of ['Dilmar','Wolfe','Sunset drinks','Cabanas','Steaks'])expect(out).not.toContain(bad)
 for(const ok of ['## Agenda','Harbor Tower','## Day 1','your hotel','## Working sessions','venue and duration','## Salt & Vine','Dinner at 8','## Not found'])expect(out).toContain(ok)
})
import {buildPageView,compileQuoteSelection} from '@/lib/files/itinerary-view'
const LONG='Intro about the harbor and its history. '.repeat(40)+'\nHarbor City has many rooms from $90 per night.\n## Where to stay\nThe Kestrel Lodge is a quiet harbor hotel with rooms from $150 per night.\n## Eat\nSunday Brunch is served all weekend at Rook & Thistle, a seafood kitchen on Quay Street.\nBook a table at Fenn Social Club for late dinners.\n## Do\nThe Maritime Museum opens daily with harbor exhibits.\n'
const guide=()=>cap('https://guide.test/long',LONG)
const judge=(yes:Record<string,string>)=>async(name:string,kind:string)=>yes[name]===kind
const ask='Plan Friday in Harbor City with hotel, restaurants and activities'
it('page view shows venue text that sits far beyond a short truncation, and skips hub pages',()=>{
 const r=guide();r.capture('web_fetch',{url:'https://www.google.com/travel/hotels',title:'t',content:'Aggregator Hub rooms from $99 per night near you.\nSecond line of the hub page.'},'2026-01-01T00:00:00Z')
 const v=buildPageView(r);expect(v.text).toContain('Kestrel Lodge');expect(v.text).toContain('Maritime Museum');expect(v.text).not.toContain('Aggregator Hub')
})
it('quote selection: literal quote, name inside quote, and per-pick verification bind entity to kind',async()=>{
 const r=guide(),yes={'Kestrel Lodge':'hotel','Rook & Thistle':'restaurant','Maritime Museum':'activity'}
 const out=await compileQuoteSelection({candidates:[
  {kind:'hotel',name:'Kestrel Lodge',quote:'The Kestrel Lodge is a quiet harbor hotel with rooms from $150 per night.'},
  {kind:'restaurant',name:'Rook & Thistle',quote:'Sunday Brunch is served all weekend at Rook & Thistle, a seafood kitchen on Quay Street.'},
  {kind:'activity',name:'Maritime Museum',quote:'The Maritime Museum opens daily with harbor exhibits.'}]},r,ask,judge(yes))
 expect('error' in out).toBe(false);if('error' in out)return
 expect(out.candidates.map((c:any)=>c.kind)).toEqual(['hotel','restaurant','activity']);expect(out.dropped).toEqual([])
 const c:any=out.candidates[1];expect(r.pageText(c.name.source)!.slice(c.name.start,c.name.end)).toBe('Rook & Thistle');expect(c.reason).toContain('seafood kitchen')
})
it('quote selection rejects a meal as a venue, a hotel relabeled as an activity, a quote about a different entity, and invented quotes',async()=>{
 const r=guide(),yes={'Kestrel Lodge':'hotel','Rook & Thistle':'restaurant'}
 const cases:[string,any][]=[
  ['not_verified',{kind:'restaurant',name:'Sunday Brunch',quote:'Sunday Brunch is served all weekend at Rook & Thistle, a seafood kitchen on Quay Street.'}],
  ['not_verified',{kind:'activity',name:'Kestrel Lodge',quote:'The Kestrel Lodge is a quiet harbor hotel with rooms from $150 per night.'}],
  ['name_not_in_quote',{kind:'hotel',name:'Kestrel Lodge',quote:'The Maritime Museum opens daily with harbor exhibits.'}],
  ['quote_not_on_page',{kind:'hotel',name:'Kestrel Lodge',quote:'Kestrel Lodge sits beside a festival ground with live music.'}],
  ['not_a_venue_name',{kind:'hotel',name:'Harbor City',quote:'Harbor City has many rooms from $90 per night.'}]]
 for(const [code,cand] of cases){const o=await compileQuoteSelection({candidates:[cand,{kind:'hotel',name:'Kestrel Lodge',quote:'The Kestrel Lodge is a quiet harbor hotel with rooms from $150 per night.'}]},r,ask,judge(yes));expect('error' in o,code).toBe(false);if('error' in o)continue;expect(o.dropped,code).toContain(code);expect(o.candidates).toHaveLength(1)}
})
it('quote selection with nothing verifiable is an error so the honest partial path takes over',async()=>{
 const o=await compileQuoteSelection({candidates:[{kind:'hotel',name:'Kestrel Lodge',quote:'The Kestrel Lodge is a quiet harbor hotel with rooms from $150 per night.'}]},guide(),ask,async()=>false)
 expect('error' in o&&o.dropped).toEqual(['not_verified'])
})
it('empty headings left after stripping are dropped, headings with content stay',()=>{
 const out=neutralizeUnpickedVenues('# Trip\n## Recommendations for the Day\n- Dinner at Dilmar Beach Club\n## Day 1\n- Check in at your hotel\n## Weekend','x'.split(','),'Plan Friday').body
 expect(out).not.toContain('Recommendations');expect(out).not.toContain('## Weekend');expect(out).toContain('## Day 1');expect(out).toContain('your hotel')
})
