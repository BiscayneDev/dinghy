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
