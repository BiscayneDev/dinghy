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
 const menu=extractMentions(r,60,['hotel','restaurant','activity'])
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
