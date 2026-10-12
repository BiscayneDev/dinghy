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
 const picks:any[]=[]
 for(const kind of ['hotel','restaurant','activity'] as const)for(const want of fx.expect[kind]){
  const m=menu.find(x=>x.text.includes(want)||want.includes(x.text));expect(m,`${name}: ${want} missing from menu ${menu.map(x=>x.text).join('|')}`).toBeTruthy()
  expect(r.pageText('src1')!.slice(m!.start,m!.end)).toBe(m!.text)
  picks.push({kind,id:m!.id,reason:'r',catch:'c'})
 }
 const out=compileMentionSelection({candidates:picks},menu,r)
 expect('error' in out).toBe(false);if('error' in out)return
 expect(out.dropped).toEqual([]);expect(out.candidates.length).toBe(picks.length)
 expect(missingKinds(mergePicks([],out.candidates),requiredKinds('hotel, restaurants and activities'))).toEqual([])
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
it('soft kind check: a hinted hotel cannot fill activity while hinted activities remain unpicked, but is accepted when none exist',()=>{
 const withAct=page('Stay at The Marlow Hotel, rooms per night.\nSee Coral Lane Gallery, a museum tour.\n')
 const menu=extractMentions(withAct,60,['activity'],{evidence:false}),hot=menu.find(m=>m.text.includes('Marlow'))!
 const out=compileMentionSelection({candidates:[{kind:'activity',id:hot.id,reason:'r',catch:'c'}]},menu,withAct)
 expect('error' in out&&out.dropped).toEqual(['kind_conflict'])
 const noAct=page('Stay at The Marlow Hotel, rooms per night.\n'),m2=extractMentions(noAct,60,['activity'],{evidence:false}),h2=m2.find(m=>m.text.includes('Marlow'))!
 expect('error' in compileMentionSelection({candidates:[{kind:'activity',id:h2.id,reason:'r',catch:'c'}]},m2,noAct)).toBe(false)
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
