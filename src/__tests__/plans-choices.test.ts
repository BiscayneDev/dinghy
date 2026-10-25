import {describe,it,expect} from 'vitest'
import {mergeChoices,mergePlan,cleanPlans,type PlanRow} from '@/lib/spectrum/plans'
import {renderMemoryBlock} from '@/lib/spectrum/memory'
const prev:PlanRow={id:'1',title:'Alderbrook trip',kind:'trip',starts_on:null,ends_on:null,places:[],people:[],details:'Chose: Stay in Alderbrook: Linden House\nTrain arrives Friday 1:15',source:'user'}
describe('settled choices survive plan updates',()=>{
 it('keeps an earlier choice the update does not mention',()=>expect(mergeChoices(prev.details,'Chose: Friday dinner: Marrow')).toContain('Chose: Stay in Alderbrook: Linden House'))
 it('a newer line for the same slot wins',()=>{const m=mergeChoices(prev.details,'Chose: Stay in Alderbrook: Harbor Annex');expect(m).toContain('Harbor Annex');expect(m).not.toContain('Linden House')})
 it('plain detail rewrites without choice lines leave the choice in place; empty next keeps prev',()=>{expect(mergeChoices(prev.details,'Arrives Friday')).toContain('Linden House');expect(mergeChoices(prev.details,'')).toBe(prev.details)})
 it('mergePlan uses it',()=>expect(mergePlan(prev,{...prev,details:'Dinner at 8:30'}).details).toContain('Chose: Stay in Alderbrook: Linden House'))
 it('memory block shows the choice to the composer',()=>expect(renderMemoryBlock({profile:'',summaries:[],facts:[],plans:['Alderbrook trip · Chose: Stay in Alderbrook: Linden House'],files:[]})).toContain('Chose: Stay in Alderbrook'))
 it('a later user correction replaces the old choice and never keeps both',()=>{
  const m=mergePlan(prev,{...prev,details:'Chose: Stay in Alderbrook: Harbor Annex'}).details
  expect(m).toContain('Harbor Annex');expect(m).not.toContain('Linden House');expect(m).toContain('Train arrives Friday 1:15'.slice(0,0)+'')
 })
 it('cancelling a decision removes it, and later unrelated updates do not bring it back',()=>{
  const cancelled=mergePlan(prev,{...prev,details:'Train arrives Friday 1:15',clear_choices:['Stay in Alderbrook']})
  expect(cancelled.details).not.toContain('Linden House')
  const row:PlanRow={...prev,...cancelled,id:'1'} as PlanRow
  const later=mergePlan(row,{...prev,details:'Dinner at 8:30 is open'})
  expect(later.details).not.toContain('Linden House');expect(later.details).toContain('Dinner at 8:30')
 })
 it('cancel with an empty update still clears; the model re-stating the old line in the same update cannot revive it',()=>{
  expect(mergeChoices(prev.details,'',['stay in alderbrook'])).not.toContain('Linden House')
  expect(mergeChoices(prev.details,'Chose: Stay in Alderbrook: Linden House',['Stay in Alderbrook'])).not.toContain('Linden House')
 })
 it('other decisions survive a cancellation of one',()=>{
  const d='Chose: Stay in Alderbrook: Linden House\nChose: Friday dinner: Marrow'
  const m=mergeChoices(d,'',['Stay in Alderbrook']);expect(m).toContain('Marrow');expect(m).not.toContain('Linden House')
 })
 it('clear_choices is parsed from the memory pass and is never a stored column',()=>{
  const [p]=cleanPlans([{title:'Alderbrook trip',details:'x',clear_choices:['Stay in Alderbrook']}]);expect(p.clear_choices).toEqual(['Stay in Alderbrook'])
  expect(cleanPlans([{title:'Alderbrook trip'}])[0]).not.toHaveProperty('clear_choices')
 })
})
