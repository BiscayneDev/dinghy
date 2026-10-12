import {it,expect} from 'vitest'
import {SourceRecords} from '@/lib/files/source-records'
import {compileSelection,injectCandidates,selectionToolDef} from '@/lib/files/itinerary-selection'
const page=()=>{const r=new SourceRecords();r.capture('web_fetch',{url:'https://harbor.test/v',title:'Harbor',content:'Nav. Stay at Harbor Inn, from $120 per night.\nEat: Harbor   Cafe.\nSee Harbor Museum.'},'2026-01-01T00:00:00Z');return r}
const c=(kind:string,excerpt:string,extra:any={})=>({kind,name:{source:'src1',excerpt},reason:'r',catch:'c',...extra})
it('keeps valid picks, snaps whitespace/case, drops invented and snippet-less ones',()=>{
 const r=page(),out=compileSelection({candidates:[c('hotel','harbor inn',{price:{source:'src1',excerpt:'$120 per night'}}),c('restaurant','Harbor Cafe'),c('activity','Harbor Museum'),c('activity','Invented Tower')]},r)
 expect('error' in out).toBe(false)
 if('error' in out)return
 expect(out.candidates).toHaveLength(3);expect(out.dropped).toEqual(['excerpt_absent'])
 expect((out.candidates[1].name as any).excerpt).toBe('Harbor   Cafe')
})
it('errors when nothing is valid and never invents',()=>{
 const out=compileSelection({candidates:[c('hotel','Nowhere Hotel')]},page());expect('error' in out).toBe(true)
 expect('error' in compileSelection({},page())).toBe(true)
 expect('error' in compileSelection({candidates:[c('hotel','Harbor Inn',{source:'x'})]},page())).toBe(true)
})
it('server injection overrides whatever the file call carried and tool def pins page ids',()=>{
 expect((injectCandidates({title:'t',itinerary_candidates:[]},[{a:1}]) as any).itinerary_candidates).toEqual([{a:1}])
 expect(selectionToolDef(['src1']).function.parameters.properties.candidates.items.properties.name.properties.source.enum).toEqual(['src1'])
})
import {extractMentions} from '@/lib/files/itinerary-mentions'
import {compileMentionSelection,mentionToolDef} from '@/lib/files/itinerary-selection'
it('mentions come from the full page text, past a long nav prefix, with server-owned offsets and no auto price',()=>{
 const nav='Menu Home Contact cookies privacy terms. '.repeat(60)
 const r=new SourceRecords();r.capture('web_fetch',{url:'https://x.test/p',title:'T',content:nav+'Where to stay: The Grand Harbor Hotel, rooms from $189 per night near the pier. Dinner at Salt & Vine is a local favorite. Visit the Maritime Museum on Sunday.'},'2026-01-01T00:00:00Z')
 const menu=extractMentions(r),texts=menu.map(m=>m.text)
 expect(texts).toContain('Grand Harbor Hotel');expect(texts).toContain('Salt & Vine');expect(texts).toContain('Maritime Museum');expect(texts).not.toContain('Menu')
 const hotel=menu.find(m=>m.text==='Grand Harbor Hotel')!
 expect(r.pageText('src1')!.slice(hotel.start,hotel.end)).toBe('Grand Harbor Hotel')
 const out=compileMentionSelection({candidates:[{kind:'hotel',id:hotel.id,reason:'r',catch:'c'},{kind:'restaurant',id:'m999',reason:'r',catch:'c'},{kind:'activity',id:menu.find(m=>m.text==='Maritime Museum')!.id,reason:'r',catch:'c'}]},menu,r)
 expect('error' in out).toBe(false);if('error' in out)return
 expect(out.candidates).toHaveLength(2);expect(out.dropped).toEqual(['unknown_id'])
 expect(mentionToolDef(menu.map(m=>m.id)).function.parameters.properties.candidates.items.properties.id.enum).toEqual(menu.map(m=>m.id))
})
