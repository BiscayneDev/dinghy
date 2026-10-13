import {it,expect} from 'vitest'
import {captureItineraryDiagnostic,withItineraryDiagnostic} from '@/lib/spectrum/itinerary-diagnostic'
it('captures only within private invocation and isolates parallel scopes',async()=>{
 captureItineraryDiagnostic('outside',{value:'not captured'})
 const [a,b]=await Promise.all([withItineraryDiagnostic(async()=>{await Promise.resolve();captureItineraryDiagnostic('a',{value:1});return 1}),withItineraryDiagnostic(async()=>{captureItineraryDiagnostic('b',{value:2});return 2})])
 expect(a).toEqual({result:1,diagnostic:[{kind:'a',data:{value:1}}]})
 expect(b).toEqual({result:2,diagnostic:[{kind:'b',data:{value:2}}]})
 expect((await withItineraryDiagnostic(async()=>3)).diagnostic).toEqual([])
})
