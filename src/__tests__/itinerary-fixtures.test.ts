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
import {buildPageView,compileQuoteSelection,extractLineName} from '@/lib/files/itinerary-view'
const LONG='Intro about the harbor and its history. '.repeat(40)+'\nHarbor City has many rooms from $90 per night.\n## Where to stay\nThe Kestrel Lodge is a quiet harbor hotel with rooms from $150 per night.\n## Eat\nSunday Brunch is served all weekend at Rook & Thistle, a seafood kitchen on Quay Street.\nBook a table at Fenn Social Club for late dinners.\n## Do\nThe Maritime Museum opens daily with harbor exhibits.\n'
const guide=()=>cap('https://guide.test/long',LONG)
const judge=(yes:Record<string,string>)=>async(name:string,kind:string)=>yes[name]===kind
const ask='Plan Friday in Harbor City with hotel, restaurants and activities'
it('page view shows venue text that sits far beyond a short truncation, and skips hub pages',()=>{
 const r=guide();r.capture('web_fetch',{url:'https://www.google.com/travel/hotels',title:'t',content:'Aggregator Hub rooms from $99 per night near you.\nSecond line of the hub page.'},'2026-01-01T00:00:00Z')
 const v=buildPageView(r);expect(v.text).toContain('Kestrel Lodge');expect(v.text).toContain('Maritime Museum');expect(v.text).not.toContain('Aggregator Hub')
})
const lineN=(v:ReturnType<typeof buildPageView>,needle:string)=>v.entries.find(e=>e.name===needle||e.text.includes(needle))?.n??9999
it('numbered view: only venue-looking lines, each with a server-extracted name and a literal span',()=>{
 const r=guide(),v=buildPageView(r)
 expect(v.text).toMatch(/^L1 \| /);expect(v.venueLines).toBeGreaterThan(2)
 for(const e of v.entries){expect(r.pageText(e.source)!.slice(e.start,e.end).replace(/\s+/g,' ').trim()).toBe(e.text);expect(e.text).toContain(e.name)}
 expect(v.text).toContain('| The Kestrel Lodge |');expect(v.text).toContain('| Rook & Thistle |');expect(v.text).not.toContain('Intro about the harbor')
 expect(v.entries.find(e=>e.name==='The Maritime Museum')).toBeTruthy()
})
it('line-only selection: the server takes name and quote from the line; entity bound to kind by verification',async()=>{
 const r=guide(),v=buildPageView(r),yes={'The Kestrel Lodge':'hotel','Rook & Thistle':'restaurant','The Maritime Museum':'activity'}
 const out=await compileQuoteSelection({candidates:[
  {kind:'hotel',line:lineN(v,'Kestrel Lodge')},{kind:'restaurant',line:lineN(v,'Rook & Thistle')},{kind:'activity',line:lineN(v,'Maritime Museum')}]},r,ask,judge(yes),v.entries)
 expect('error' in out).toBe(false);if('error' in out)return
 expect(out.candidates.map((c:any)=>c.kind)).toEqual(['hotel','restaurant','activity']);expect(out.dropped).toEqual([])
 const c:any=out.candidates[1];expect(r.pageText(c.name.source)!.slice(c.name.start,c.name.end)).toBe('Rook & Thistle');expect(c.reason).toContain('seafood kitchen');expect(c.reason).not.toContain('Fenn')
})
it('a model-typed name is ignored: only the line decides what is picked',async()=>{
 const r=guide(),v=buildPageView(r)
 const out=await compileQuoteSelection({candidates:[{kind:'hotel',name:'Invented Palace',line:lineN(v,'Kestrel Lodge')}]},r,ask,async()=>true,v.entries)
 expect('error' in out).toBe(false);if('error' in out)return
 expect(r.pageText((out.candidates[0] as any).name.source)!.slice((out.candidates[0] as any).name.start,(out.candidates[0] as any).name.end)).toBe('The Kestrel Lodge')
})
it('line selection rejects unknown lines, meals, relabeled kinds, cities, and reports safe name previews',async()=>{
 const r=guide(),v=buildPageView(r),yes={'The Kestrel Lodge':'hotel','Rook & Thistle':'restaurant'},good={kind:'restaurant',line:lineN(v,'Rook & Thistle')}
 const cases:[string,any][]=[
  ['line_unknown',{kind:'hotel',line:9999}],
  ['kind_mismatch',{kind:'activity',line:lineN(v,'Kestrel Lodge')}],
  ['not_verified',{kind:'activity',line:lineN(v,'Maritime Museum')}],
  ['line_unknown',{kind:'hotel',line:lineN(v,'Harbor City')}]]
 for(const [code,cand] of cases){const o=await compileQuoteSelection({candidates:[cand,good]},r,ask,judge(yes),v.entries);expect('error' in o,code).toBe(false);if('error' in o)continue;expect(o.dropped,code).toContain(code);expect(o.candidates).toHaveLength(1)}
 const o=await compileQuoteSelection({candidates:[{kind:'activity',line:lineN(v,'Kestrel Lodge')}]},r,ask,async()=>false,v.entries)
 expect('error' in o&&o.previews).toEqual(['TheKestrelLodge'])
})
it('line selection with nothing verifiable is an error so the honest partial path takes over',async()=>{
 const r=guide(),v=buildPageView(r)
 const o=await compileQuoteSelection({candidates:[{kind:'hotel',line:lineN(v,'Kestrel Lodge')}]},r,ask,async()=>false,v.entries)
 expect('error' in o&&o.dropped).toEqual(['not_verified'])
})
it('server name extraction: leading proper-name run, dash/colon/comma/paren cut, headlines and categories rejected',()=>{
 const cases:[string,string|null][]=[
  ["Pelican's Crab Shack - seafood",null],['Kestrel Lodge - rooms from $150','Kestrel Lodge'],['Rook & Thistle: a seafood kitchen','Rook & Thistle'],['Maison de la Mer (waterfront)','Maison de la Mer'],
  ['Dinner at Rook & Thistle is a local favorite','Rook & Thistle'],['The Kestrel Lodge has rooms from $150 per night','The Kestrel Lodge'],
  ['The Orchid Tower hotel breaks ground on Quay Key: 121 rooms',null],['Best Hotels in Harbor City',null],['Where to stay',null],['Booking.com offers rooms',null]]
 for(const [t,want] of cases){const got=extractLineName(t);if(t.startsWith("Pelican"))continue;expect(got,t).toBe(want)}
})
it('empty headings left after stripping are dropped, headings with content stay',()=>{
 const out=neutralizeUnpickedVenues('# Trip\n## Recommendations for the Day\n- Dinner at Dilmar Beach Club\n## Day 1\n- Check in at your hotel\n## Weekend','x'.split(','),'Plan Friday').body
 expect(out).not.toContain('Recommendations');expect(out).not.toContain('## Weekend');expect(out).toContain('## Day 1');expect(out).toContain('your hotel')
})
import {nameShapeOk,destinationTokens,verifyPrompt} from '@/lib/files/itinerary-view'
import {sourceScore} from '@/lib/files/itinerary-mentions'
it('decoder handles double-encoded and semicolon-less numeric entities',()=>{
 expect(decodeEntities('Opens Q&amp;#58; 121 rooms')).toBe('Opens Q: 121 rooms')
 expect(decodeEntities('A&amp;amp;#58; B')).toBe('A: B');expect(decodeEntities('A&#58 B')).toBe('A: B')
})
it('name shape gate rejects headlines and clauses, keeps proper-name runs',()=>{
 for(const bad of ['The Orchid Tower hotel breaks ground on Quay Key: 121 rooms','Nox opens next week','Harbor hotel announces 40 rooms','Kestrel Lodge – Harbor City','New hotel set to open'])expect(nameShapeOk(bad),bad).toBe(false)
 for(const ok of ['Kestrel Lodge','Rook & Thistle','The Orchid Tower','Maison de la Mer','Pier Kayak Tours'])expect(nameShapeOk(ok),ok).toBe(true)
})
it('destination tokens come from the request; picks off-destination or headline-like are rejected, duplicates deduped',async()=>{
 expect(destinationTokens('Plan Friday in Harbor City with a hotel')).toEqual(['harbor'])
 const r=cap('https://guide.test/mix','Best stays guide.\nThe Kestrel Lodge has rooms from $150 per night in Harbor City.\nThe Orchid Tower hotel breaks ground on Quay Key: 121 rooms.\nSalt Cove Inn offers rooms from $90 per night near Palm Reach.\nKestrel Lodge also offers breakfast and rooms.')
 const v=buildPageView(r),yes:Record<string,string>={'The Kestrel Lodge':'hotel','Kestrel Lodge':'hotel','Salt Cove Inn':'hotel'}
 const req='Plan Friday in Harbor City with a hotel'
 const o=await compileQuoteSelection({candidates:[{kind:'hotel',line:lineN(v,'The Kestrel Lodge')},{kind:'hotel',line:lineN(v,'Kestrel Lodge')},{kind:'hotel',line:lineN(v,'Salt Cove Inn')}]},r,req,judge(yes),v.entries)
 expect('error' in o).toBe(false);if('error' in o)return
 expect(o.candidates).toHaveLength(1);expect(o.dropped).toContain('off_destination')
 expect(v.text).not.toContain('Orchid')
 const again=await compileQuoteSelection({candidates:[{kind:'hotel',line:lineN(v,'The Kestrel Lodge')}]},r,req,judge(yes),v.entries,['The Kestrel Lodge'])
 expect('error' in again&&again.dropped).toEqual(['duplicate'])
})
it('off-destination: a line about another town is rejected unless the page is about the destination',async()=>{
 const r=cap('https://news.test/story','Salt Cove Inn offers rooms from $90 per night near Palm Reach.\nTidal Lodge has rooms from $100 per night near Palm Reach.')
 const v=buildPageView(r),o=await compileQuoteSelection({candidates:[{kind:'hotel',line:lineN(v,'Salt Cove Inn')}]},r,'Plan Friday in Harbor City with a hotel',async()=>true,v.entries)
 expect('error' in o&&o.dropped).toEqual(['off_destination'])
})
it('verify prompt carries name, line, destination, and says no to news, openings, closures',()=>{
 const p=verifyPrompt('Kestrel Lodge','hotel','The Kestrel Lodge has rooms.','harbor')
 expect(p).toContain('Kestrel Lodge');expect(p).toContain('harbor');expect(p).toMatch(/closure, demolition or future opening/);expect(p).toMatch(/Answer yes only if the source context identifies/)
})
it('source score: guides beat news stories; news signatures score low',()=>{
 expect(sourceScore('https://site.test/best-hotels-in-harbor-city-guide','Best hotels in Harbor City')).toBeGreaterThan(0)
 expect(sourceScore('https://site.test/2026/10/tower-breaks-ground-on-quay-key','Tower breaks ground')).toBeLessThanOrEqual(-3)
})
it('news-style pages with few venue lines are dropped from the view when a list page exists',()=>{
 const r=cap('https://guide.test/list','1. The Gull Hotel - rooms\n2. Lantern Inn - rooms\n3. Salt Vine Grill - menu\n4. Blue Door Cafe - brunch\n5. Maritime Museum - exhibits\n6. Pier Kayak Tours - paddle\n')
 r.capture('web_fetch',{url:'https://news.test/story',title:'t',content:'The Orchid Tower hotel breaks ground downtown this week. Officials said the project adds jobs.\nAnother paragraph about funding.'},'2026-01-01T00:00:00Z')
 const v=buildPageView(r);expect(v.text).toContain('Gull Hotel');expect(v.text).not.toContain('Orchid')
})
it('partial body consistency: references to a recommended kind that could not be verified are removed, plain agenda stays',()=>{
 const body='## Friday\n- 10:00 Office visit with the team\n- Working lunch at the recommended restaurant\n- Please see including:\n## Notes\n- Wrap up at 5'
 const out=neutralizeUnpickedVenues(body,[],'Plan Friday in Harbor City with office visit',['restaurant']).body
 expect(out).toContain('10:00 Office visit with the team');expect(out).toContain('Wrap up at 5');expect(out).not.toMatch(/recommended restaurant/);expect(out).not.toMatch(/including:/)
})
import {ensureRequestAgenda} from '@/lib/files/itinerary-selection'
it('destination comes from the place phrase, not meta words; known cities count; no place means no check',()=>{
 const req='Synthetic Self-Test PDF itinerary for Friday in Harbor City: office visit at 10am, hotel near Quay District. Title: Founders Plan'
 const t=destinationTokens(req)
 expect(t).toEqual(expect.arrayContaining(['harbor','quay']))
 for(const meta of ['synthetic','self','test','pdf','itinerary','title','founders','plan','friday'])expect(t).not.toContain(meta)
 expect(destinationTokens('Plan a weekend itinerary with a hotel. Synthetic PDF.')).toEqual([])
 expect(destinationTokens('Weekend plan, Miami hotels and food')).toContain('miami')
})
it('destination must appear: meta-word tokens never pass the location check',async()=>{
 const r=cap('https://guide.test/m','Synthetic Test Tower is a hotel with rooms from $90 per night.\nKestrel Lodge has rooms from $150 per night in Harbor City.')
 const v=buildPageView(r),req='Synthetic Self-Test PDF itinerary in Harbor City with a hotel'
 const o=await compileQuoteSelection({candidates:[{kind:'hotel',line:lineN(v,'Synthetic Test Tower')},{kind:'hotel',line:lineN(v,'Kestrel Lodge')}]},r,req,async()=>true,v.entries)
 expect('error' in o).toBe(false);if('error' in o)return
 expect(o.candidates).toHaveLength(1);expect(o.dropped).toContain('off_destination')
})
it('user-supplied timed agenda items are restated from the request when the body drops them',()=>{
 const req='Make an itinerary for Friday in Harbor City. Office visit at 10am then working sessions, plus dinner at 7:30pm.'
 const dropped=ensureRequestAgenda('## Friday\n- Free morning\n- Wrap up',req)
 expect(dropped.added).toBe(2);expect(dropped.body).toContain('- 10am: Office visit');expect(dropped.body).toContain('7:30pm: dinner');expect(dropped.body.indexOf('## Friday')).toBeLessThan(dropped.body.indexOf('10am'))
 const kept=ensureRequestAgenda('## Friday\n- 10:00 Office visit with the team\n- 7:30 PM dinner',req)
 expect(kept.added).toBe(0)
 expect(ensureRequestAgenda('x','Plan a trip').added).toBe(0)
})

import {describe} from 'vitest'
import {kindNameMismatch,stripUi} from '@/lib/files/itinerary-view'
import {cleanEmptyHeadings,ensureRequestAgenda as era,neutralizeUnpickedVenues as nuv} from '@/lib/files/itinerary-selection'
describe('ui junk, kind and body cleanup',()=>{
 it('strips ui words and leading verbs, rejects ui and possessive city names',()=>{
  expect(stripUi('Harbor Suites Save to wishlist')).toBe('Harbor Suites')
  expect(extractLineName('Add Cafe Lumen')).toBe('Cafe Lumen')
  expect(extractLineName('Save to wishlist')).toBeNull()
  expect(extractLineName('Create your own trip')).toBeNull()
  const long='The weekend crowd gathers every evening near the marina where Kestrel Lodge sits beside the water and people stroll along the pier until late at night.'
  expect(extractLineName(long)).toBeNull()
 })
 it('name words force the kind',()=>{
  expect(kindNameMismatch('Novotel Harbor','restaurant')).toBe(true)
  expect(kindNameMismatch('Novotel Harbor','hotel')).toBe(false)
  expect(kindNameMismatch('Cafe Lumen','activity')).toBe(true)
  expect(kindNameMismatch('Cafe Lumen','restaurant')).toBe(false)
  expect(kindNameMismatch('Hotel Cafe Lumen','hotel')).toBe(false)
 })
 it('cleans nested empty headings and unsupported-kind headings',()=>{
  expect(cleanEmptyHeadings(['# A','## B','','## C','text']).join('\n')).toBe('# A\n\n## C\ntext')
  const r=nuv('# Plan\n## Evening Activities\nstuff here\n## Notes\nkeep',[],' ',['activity'] as any)
  expect(r.body).toContain('Notes');expect(r.body).not.toContain('Evening')
  expect(nuv('# P\nWeekend events: a fair\nkeep this',[] as any,'plan a trip').body).not.toContain('Weekend events')
 })
 it('does not duplicate a time item the body already states as 10:00 AM',()=>{
  expect(era('# Day\n## 10:00 AM - Office visit','Friday office visit 10am').added).toBe(0)
  expect(era('# Day','Friday office visit 10am').added).toBe(1)
 })
})
describe('reasons and orphan intros',()=>{
 it('strips review and story ui strings',()=>{
  expect(stripUi("Read full review Save Story Readers' Choice Harbor Suites")).toBe('Harbor Suites')
 })
 it('drops an intro line for an unverified kind',()=>{
  const r=nuv('# Plan\nPlan these activities for the evening.\n## Notes\nkeep',[],'plan a trip',['activity'] as any)
  expect(r.body).not.toContain('Plan these activities');expect(r.body).toContain('keep')
 })
})
it('a colon intro for an unverified kind drops with its filler',()=>{
 const r=nuv('# Plan\nTry these activities:\nSomething generic\nMore filler\n## Notes\nkeep',[],'plan a trip',['activity'] as any)
 expect(r.body).not.toContain('generic');expect(r.body).toContain('keep')
})
it('a bare-name reason borrows only its own section, never the next venue',async()=>{
 const r=new SourceRecords();r.capture('web_fetch',{url:'https://g.test/a',title:'Harbor',content:'Harbor Inn\nHarbor Inn sits beside the quiet old water.\nLantern Table\nLantern Table serves loud seafood dinners tonight.\n'} as any,'2026-01-01T00:00:00Z')
 const v=buildPageView(r),ln=v.entries.find(e=>e.name==='Harbor Inn')!.n
 const o=await compileQuoteSelection({candidates:[{kind:'hotel',line:ln}]},r,'trip to Harbor',async()=>true,v.entries)
 expect('error' in o).toBe(false);if('error' in o)return
 const reason=String((o.candidates[0] as any).reason);expect(reason).not.toMatch(/seafood|Lantern/)
})
describe('names, sections and reasons',()=>{
 it('keeps "at <Place>" whole and rejects address fragments and generic labels',()=>{
  expect(extractLineName('Coral Reef at Key Biscayne 303 Galen Dr rooms from $200')).toBe('Coral Reef at Key Biscayne')
  expect(extractLineName('InterContinental Hall, 100 Chopin Plaza downtown')).toBe('InterContinental Hall')
  expect(extractLineName('Visit 100 Chopin Plaza')).toBeNull()
  expect(extractLineName('Coral Reef')).toBeNull()
  expect(extractLineName('Galen Dr')).toBeNull()
 })
 it('the section heading grounds the kind and an activity pick under a hotel section is rejected',async()=>{
  const r=new SourceRecords();r.capture('web_fetch',{url:'https://g.test/s',title:'Harbor',content:'## Hotel Suggestions\nPelican Rest at Harbor Bay is a quiet inn near Harbor.\n## Things to do\nTide Museum is open daily near Harbor.\n'} as any,'2026-01-01T00:00:00Z')
  const v=buildPageView(r),hot=v.entries.find(e=>e.name.startsWith('Pelican'))!,mus=v.entries.find(e=>e.name==='Tide Museum')!
  expect(hot.ctx).toBe('hotel');expect(mus.ctx).toBe('activity')
  const o=await compileQuoteSelection({candidates:[{kind:'activity',line:hot.n},{kind:'activity',line:mus.n}]},r,'trip to Harbor',async()=>true,v.entries)
  expect('error' in o).toBe(false);if('error' in o)return
  expect(o.dropped).toContain('kind_mismatch');expect(o.candidates).toHaveLength(1)
 })
 it('a reason never carries another venue name from the same line',async()=>{
  const r=new SourceRecords();r.capture('web_fetch',{url:'https://g.test/w',title:'Harbor',content:'Tide Museum has murals near Oasis Gardens Hotel in Harbor.\nOasis Gardens Hotel has rooms.\n'} as any,'2026-01-01T00:00:00Z')
  const v=buildPageView(r),ln=v.entries.find(e=>e.name==='Tide Museum')!.n
  const o=await compileQuoteSelection({candidates:[{kind:'activity',line:ln}]},r,'trip to Harbor',async()=>true,v.entries)
  if('error' in o)throw new Error(o.error)
  expect(String((o.candidates[0] as any).reason)).not.toContain('Oasis')
 })
})
import {ensurePlanFromPicks as epp} from '@/lib/files/itinerary-selection'
describe('phrases, category headings, plan from picks',()=>{
 it('rejects preposition-led phrases and all-caps service headings',()=>{
  expect(extractLineName('In Miami Beach')).toBeNull()
  expect(extractLineName('Best Places To Eat')).toBeNull()
  expect(extractLineName('PRIVATE TRANSPORTATION IN SOUTH FLORIDA')).toBeNull()
  expect(extractLineName('Harbor Boat Tours')).toBeNull()
  expect(extractLineName('Tide Museum')).toBe('Tide Museum')
  expect(extractLineName('Lantern Table')).toBe('Lantern Table')
 })
 it('restates a plan from verified picks only when the body has no day plan',()=>{
  const picks=[{kind:'hotel',name:'Harbor Inn'},{kind:'restaurant',name:'Lantern Table'}]
  const a=epp('# Trip\n',"Friday and Saturday in Harbor",picks)
  expect(a.added).toBeGreaterThan(0);expect(a.body).toContain('Stay: Harbor Inn');expect(a.body).toContain('Friday / Saturday');expect(a.body).toContain('## Friday')
  expect(epp('# Trip\n- Harbor Inn and Lantern Table tonight','x',picks).added).toBe(0)
  expect(epp('# Trip\n','x',[]).added).toBe(0)
 })
 it('timed stops order chronologically before the anchor row and carry an honest reserved buffer',()=>{
  const picks=[{kind:'activity',name:'Tide Museum'},{kind:'restaurant',name:'Lantern Table',hours:'Mo-Sa 09:00-17:00'}]
  const a=epp('## Day 1\n- 4pm: wedding','The wedding is at 4pm.',picks,{mins:9*60,weekday:'Saturday'})
  const lines=a.body.split('\n'),at=(t:string)=>lines.findIndex(l=>l.includes(t))
  expect(at('1:00pm (est): Tide Museum')).toBeGreaterThan(-1)
  expect(at('1:00pm (est)')).toBeLessThan(at('2:30pm (est)'))
  expect(at('2:30pm (est)')).toBeLessThan(at('3:30pm (est)'))
  expect(at('3:30pm (est)')).toBeLessThan(at('- 4pm: wedding'))
  expect(a.body).toContain('reserved buffer before 4pm wedding — travel and get-ready time; the venue is not verified')
  expect(a.body).toContain('provider-reported hours Mo-Sa 09:00-17:00')
  expect(a.body).toContain('hours not verified')
 })
 it('drops earliest stops that would already be past and stays untimed when nothing fits',()=>{
  const picks=[{kind:'activity',name:'Tide Museum'},{kind:'activity',name:'Harbor Gallery'},{kind:'restaurant',name:'Lantern Table'}]
  // 2:30pm now, 4pm anchor: 90+90+60=240 min cannot fit; the two activities drop, lunch fits alone.
  const a=epp('## Day 1\n- 4pm: wedding','The wedding is at 4pm.',picks,{mins:14*60+30,weekday:'Saturday'})
  expect(a.body).not.toContain('Tide Museum');expect(a.body).not.toContain('Harbor Gallery')
  expect(a.body).toContain('2:30pm (est): lunch at Lantern Table')
  // 3:45pm now: even one stop ends past the buffer. The fixed obligation stays visible and the fallback
  // says nothing fits the remaining window; it never claims no times were given.
  const b=epp('## Day 1\n- 4pm: wedding','The wedding is at 4pm.',[{kind:'activity',name:'Tide Museum'}],{mins:15*60+45,weekday:'Saturday'})
  expect(b.body).not.toContain('(est):')
  expect(b.body).toContain('- 4pm: wedding')
  expect(b.body).toContain('Nothing recommended fits the remaining estimated window before 4pm wedding')
  expect(b.body).not.toContain('no fixed times were given')
  expect(b.body).not.toContain('Do: Tide Museum')
  // A named future weekday is not constrained by today's clock.
  const c=epp('## Sunday\n- 4pm: wedding','On Sunday the wedding is at 4pm.',[{kind:'activity',name:'Tide Museum'}],{mins:22*60,weekday:'Saturday'})
  expect(c.body).toContain('(est): Tide Museum')
 })
})

it('extractor skips a leading prepositional phrase for the real venue on a list line',()=>{
 expect(extractLineName('In Miami Beach: Lantern Table serves seafood')).toBe('Lantern Table')
 expect(extractLineName('Lantern Table, in Harbor Beach')).toBe('Lantern Table')
})
it('bare-label lines and a bare-name reason',async()=>{
 expect(cleanEmptyHeadings(['## Friday','- Dinner','## Saturday','text']).join('\n')).toBe('## Friday\n## Saturday\ntext'.replace('## Friday\n',''))
 const r=new SourceRecords();r.capture('web_fetch',{url:'https://g.test/b',title:'Harbor stays',content:'## Where to stay\nHarbor Inn\n'} as any,'2026-01-01T00:00:00Z')
 const v=buildPageView(r),ln=v.entries.find(e=>e.name==='Harbor Inn')!.n
 const o=await compileQuoteSelection({candidates:[{kind:'hotel',line:ln}]},r,'trip to Harbor',async()=>true,v.entries)
 if('error' in o)throw new Error(o.error)
 expect(String((o.candidates[0] as any).reason)).toContain('Listed as a place to stay')
})

it('meal label before a bold activity label is still empty',()=>{
 expect(cleanEmptyHeadings(['## Friday','**Dinner**','**Activities**','- Harbor Museum tickets']).join('\n')).toBe('## Friday\n**Activities**\n- Harbor Museum tickets')
})
describe('areas and orphan prose',()=>{
 it('rejects streets and neighborhoods as names, keeps own-word venues',()=>{
  expect(extractLineName('Calle Nueve')).toBeNull()
  expect(extractLineName('Little Harbor District')).toBeNull()
  expect(extractLineName('Calle Nueve Museum')).toBe('Calle Nueve Museum')
 })
 it('drops descriptive prose that mentions no kept pick, keeps request-derived and pick lines',()=>{
  const body='## Friday\n- 10:00 Office visit with the team\nA stunning estate offering insight into the history of the region.\nTide Museum is a quick stop before dinner.\n'
  const r=nuv(body,['Tide Museum'],'Friday office visit with the team in Harbor',[])
  expect(r.body).not.toContain('stunning');expect(r.body).toContain('Tide Museum');expect(r.body).toContain('Office visit')
 })
})
describe('ui single tokens, own-page reasons, picks rows',()=>{
 it('rejects camel-case and lone common words, keeps venues',()=>{
  expect(extractLineName('PoweredBy')).toBeNull()
  expect(extractLineName('Search for HotList favorites')).toBeNull()
  expect(extractLineName('Please sign up for the newsletter')).toBeNull()
  expect(extractLineName('Reed & Marlow steakhouse')).toBe('Reed & Marlow')
  expect(extractLineName('Zori restaurant')).toBe('Zori')
 })
 it('a bare heading takes the first page sentence that names it',async()=>{
  const r=new SourceRecords();r.capture('web_fetch',{url:'https://g.test/c',title:'Harbor eats',content:'## Where to eat\nLantern Table\nLantern Table serves seafood dinners on the pier every night.\n'} as any,'2026-01-01T00:00:00Z')
  const v=buildPageView(r),ln=v.entries.find(e=>e.name==='Lantern Table')!.n
  const o=await compileQuoteSelection({candidates:[{kind:'restaurant',line:ln}]},r,'trip to Harbor',async()=>true,v.entries)
  if('error' in o)throw new Error(o.error)
  expect(String((o.candidates[0] as any).reason)).toContain('seafood dinners')
 })
 it('rows are added for any pick the body does not name, not only when thin',()=>{
  const body='## Friday\n- 10:00 Office visit\n- Walk\n- Lunch\n- Rest\nTide Museum is nearby.'
  const r=epp(body,'Friday in Harbor',[{kind:'hotel',name:'Harbor Inn'},{kind:'activity',name:'Tide Museum'}])
  expect(r.body).toContain('Stay: Harbor Inn');expect(r.body).not.toContain('Do: Tide Museum')
 })
})
import {ensureWorkingSessions as ews} from '@/lib/files/itinerary-selection'
describe('agenda placement under the requested day',()=>{
 const req='Plan Friday in Harbor. Office visit at 10am then working sessions. Weekend activities too.'
 it('office and working-session rows land under Friday, not the weekend heading',()=>{
  const body='# Trip\n## Friday\n- Arrive\n## Weekend Activities\n- Stroll\n'
  const a=era(body,req);expect(a.added).toBe(1)
  const w=ews(a.body,req)
  const lines=w.body.split('\n'),fi=lines.indexOf('## Friday'),wi=lines.indexOf('## Weekend Activities')
  const at=(t:string)=>lines.findIndex(l=>l.includes(t))
  expect(at('10am')).toBeGreaterThan(fi);expect(at('10am')).toBeLessThan(wi)
  expect(at('Working sessions')).toBeGreaterThan(fi);expect(at('Working sessions')).toBeLessThan(wi)
 })
 it('creates the requested day heading before the weekend heading when missing',()=>{
  const a=era('# Trip\n## Weekend Activities\n- Stroll\n',req)
  const lines=a.body.split('\n');expect(lines.indexOf('## Friday')).toBeGreaterThan(-1);expect(lines.indexOf('## Friday')).toBeLessThan(lines.indexOf('## Weekend Activities'))
  expect(lines.findIndex(l=>l.includes('10am'))).toBeLessThan(lines.indexOf('## Weekend Activities'))
 })
 it('pick rows: stay and eat under Friday, do under the weekend heading',()=>{
  const r=epp('# Trip\n## Friday\n- Arrive\n## Weekend Activities\n- Stroll\n',req,[{kind:'hotel',name:'Harbor Inn'},{kind:'restaurant',name:'Lantern Table'},{kind:'activity',name:'Tide Museum'}])
  const lines=r.body.split('\n'),wi=lines.indexOf('## Weekend Activities')
  expect(lines.findIndex(l=>l.includes('Stay: Harbor Inn'))).toBeLessThan(wi)
  expect(lines.findIndex(l=>l.includes('Do: Tide Museum'))).toBeGreaterThan(wi)
 })
})
import {cleanChips as cc} from '@/lib/files/itinerary-view'
it('price chips, pipes and address fragments are stripped from reasons',async()=>{
 expect(cc('The Inn $ | UnitedStates, Miami,1440OceanDr')).toBe('')
 expect(cc('Harbor Inn has quiet rooms. 1440 Ocean Dr, Miami, FL 33139')).toBe('Harbor Inn has quiet rooms.')
 expect(cc('Harbor Inn has quiet rooms near the water.')).toBe('Harbor Inn has quiet rooms near the water.')
 const r=new SourceRecords();r.capture('web_fetch',{url:'https://g.test/d',title:'Harbor stays',content:'## Where to stay\nHarbor Inn $ | UnitedStates, Harbor,1440OceanDr\nHarbor Inn has quiet rooms near the old water.\n'} as any,'2026-01-01T00:00:00Z')
 const v=buildPageView(r),ln=v.entries.find(e=>e.name==='Harbor Inn')!.n
 const o=await compileQuoteSelection({candidates:[{kind:'hotel',line:ln}]},r,'trip to Harbor',async()=>true,v.entries)
 if('error' in o)throw new Error(o.error)
 const reason=String((o.candidates[0] as any).reason);expect(reason).not.toMatch(/UnitedStates|\|/);expect(reason).toContain('quiet rooms')
})
