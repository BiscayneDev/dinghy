import {it,expect} from 'vitest'
import {SourceRecords} from '@/lib/files/source-records'
import {widenQuery,widenSourceScore,diningPageEvidence} from '@/lib/files/itinerary-research'
const page=(title:string,content:string)=>{const r=new SourceRecords();r.capture('web_fetch',{url:'https://fictional.test/guide',title,content},'2026-01-01T00:00:00Z');return r}
it('dining query puts the destination after in and ranks guides above deal/event/accessibility/menu pages',()=>{
 expect(widenQuery('restaurant','Harbor City')).toBe('best restaurants in Harbor City where to eat restaurant guide')
 const guide=widenSourceScore('restaurant','https://fictional.test/best-restaurants','Best restaurants in Harbor City')
 for(const category of ['deals','festival','accessibility','menu','celebration'])expect(widenSourceScore('restaurant','https://fictional.test/'+category,category+' in Harbor City')).toBeLessThan(guide)
})
it('chrome-only readable pages earn no dining stop slot',()=>{
 const r=page('Harbor dining event','Greater Harbor and Bay\nSouth Harbor Wine\nSavor the Stories\nAccessible Restaurants\n25th Celebration\nSeason Menus')
 expect(diningPageEvidence(r,r.pageIds()).usable).toBe(false)
})
it('named restaurant lines make a usable guide, hotels do not',()=>{
 const r=page('Harbor restaurant guide','Lantern Restaurant serves seafood.\nFenn Bistro serves lunch.\nRook Kitchen serves dinner.\nTern Cafe serves coffee.')
 expect(diningPageEvidence(r,r.pageIds())).toMatchObject({usable:true,venueLines:4})
 const hotels=page('Harbor hotels','## Hotels\nGull Hotel has a restaurant.\nKestrel Inn has dining.')
 expect(diningPageEvidence(hotels,hotels.pageIds()).usable).toBe(false)
})
it('menu-only pages are skipped but a multi-venue dining guide with offer wording can survive',()=>{
 const r=page('Season Menu','Lantern Restaurant serves seasonal dishes.')
 expect(diningPageEvidence(r,r.pageIds()).usable).toBe(false)
 const list=page('Season restaurant deals','Lantern Restaurant serves seafood.\nFenn Bistro serves lunch.\nRook Kitchen serves dinner.')
 expect(diningPageEvidence(list,list.pageIds()).usable).toBe(true)
})
import {extractLineName} from '@/lib/files/itinerary-view'
import {neutralizeUnpickedVenues} from '@/lib/files/itinerary-selection'
it('a possessive owner fragment is not the venue but a complete continued name survives',()=>{
 expect(extractLineName("Ira Sedgewick's")).toBeNull()
 expect(extractLineName("Ira Sedgewick's Good Tide Hotel")).toBe("Ira Sedgewick's Good Tide Hotel")
 expect(extractLineName("Ira Sedgewick's good tide hotel")).toBeNull()
})
it('a hotel cannot be described as a dining pick under lunch, but stays and plain agenda remain',()=>{
 const body='## Lunch Recommendations\nHarbor Inn offers a relaxed dining atmosphere.\n## Hotels\nHarbor Inn has quiet rooms.\n## Friday\n- Meet at Harbor Inn'
 const o=neutralizeUnpickedVenues(body,['Harbor Inn'],'Friday in Harbor with Hotels and Lunch Recommendations',[],[{kind:'hotel',name:'Harbor Inn'}])
 expect(o.body).not.toContain('relaxed dining');expect(o.body).toContain('quiet rooms');expect(o.body).toContain('Meet at Harbor Inn')
})
