import {describe,it,expect} from 'vitest'
import {mergeChoices,mergePlan,type PlanRow} from '@/lib/spectrum/plans'
import {renderMemoryBlock} from '@/lib/spectrum/memory'
const prev:PlanRow={id:'1',title:'Alderbrook trip',kind:'trip',starts_on:null,ends_on:null,places:[],people:[],details:'Chose: Stay in Alderbrook: Linden House\nTrain arrives Friday 1:15',source:'user'}
describe('settled choices survive plan updates',()=>{
 it('keeps an earlier choice the update does not mention',()=>expect(mergeChoices(prev.details,'Chose: Friday dinner: Marrow')).toContain('Chose: Stay in Alderbrook: Linden House'))
 it('a newer line for the same slot wins',()=>{const m=mergeChoices(prev.details,'Chose: Stay in Alderbrook: Harbor Annex');expect(m).toContain('Harbor Annex');expect(m).not.toContain('Linden House')})
 it('plain detail rewrites without choice lines leave the choice in place; empty next keeps prev',()=>{expect(mergeChoices(prev.details,'Arrives Friday')).toContain('Linden House');expect(mergeChoices(prev.details,'')).toBe(prev.details)})
 it('mergePlan uses it',()=>expect(mergePlan(prev,{...prev,details:'Dinner at 8:30'}).details).toContain('Chose: Stay in Alderbrook: Linden House'))
 it('memory block shows the choice to the composer',()=>expect(renderMemoryBlock({profile:'',summaries:[],facts:[],plans:['Alderbrook trip · Chose: Stay in Alderbrook: Linden House'],files:[]})).toContain('Chose: Stay in Alderbrook'))
})
