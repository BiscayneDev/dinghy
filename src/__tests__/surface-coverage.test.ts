import * as React from 'react'
;(globalThis as unknown as {React:unknown}).React=React
import {describe,it,expect} from 'vitest'
import {SUPPORTED_ANSWER_TYPES,SURFACE_MATRIX,surfacePlan} from '@/lib/files/surface-contract'
import {KIND_BLOCKS} from '@/lib/files/kinds'
import {splitBlocks,renderHtml,renderPdf,flattenBlocks,BLOCK_NAMES} from '@/lib/files/render'
import {renderSurfacePreview} from '@/lib/brand/surface-preview'
const rows:Record<string,string>={
 pages:JSON.stringify({version:1,components:[{id:'harbor',type:'checklist',title:'Harbor checklist',rows:[{id:'bag',label:'Harbor bag',detail:'Pack a jacket'}]}]}),markdown:'## Harbor notes\nPack a jacket.',facts:'Place | Harbor',cost:'Room | $120',
 'heads-up':'Stock unknown.',place:'name | Harbor kiosk',places:'Harbor Cafe | unknown | Hours unknown | estimate unknown | Harbor Road | | | https://venue.test |',reply:'Ask about Harbor access',options:'Harbor Inn | $120 | quiet | availability unknown',sources:'Harbor directory | https://venue.test | 2030-06-04',
 weather:'Harbor | 61° | Clear | 65° | 52° | 9 mph | 10%',scores:'Gulls | 3 | Otters | 1 | Final',media:'Night Ferry | movie | 2030 | unknown | Alex Example | Fictional | | https://media.test',stay:'Harbor Inn | $120 | unknown | Harbor | rooms unknown | | https://venue.test',route:'Harbor Inn | Harbor park | walk | unknown | access unverified',briefing:'Harbor budget vote | Harbor Gazette | date unknown | Fictional vote | https://news.test',gallery:'img/harbor.jpg | Harbor painting | Alex Example | CC BY 4.0',lead:'pick | Harbor Inn | quiet',checks:'Harbor access | unverified | |',calc:'split | 100 | Sam, Ana, Ben',chart:'bar | Fiction | 8',countdown:'Harbor Festival | 2030-06-04 | Gates 5 PM'
}
const doc=(type:string)=>({title:'Harbor '+type,subtitle:'Fictional coverage fixture',body:type==='markdown'?rows[type]:`:::${type}\n${rows[type]}\n:::`})
const png=(b:Buffer|null)=>{expect(b).not.toBeNull();expect([...b!.subarray(0,4)]).toEqual([137,80,78,71])}
describe('explicit cross-surface coverage',()=>{
 it('owns all recognized renderer blocks with no unregistered type',()=>{expect(Object.keys(rows).sort()).toEqual([...SUPPORTED_ANSWER_TYPES].sort());for(const type of SUPPORTED_ANSWER_TYPES){expect(SURFACE_MATRIX[type]).toMatchObject({page:'body',pdf:'flattened',fallback:'static_text'});if(type!=='markdown')expect(splitBlocks(doc(type).body)[0]).toMatchObject({kind:'block',name:type})}expect(BLOCK_NAMES.every(t=>t in SURFACE_MATRIX)).toBe(true);expect(KIND_BLOCKS.every(t=>t in SURFACE_MATRIX)).toBe(true)})
 it.each(SUPPORTED_ANSWER_TYPES)('%s has page, chat, OG, PDF and static routes',async type=>{
  const d=doc(type);expect(renderHtml(d)).toContain('Harbor');expect(flattenBlocks(d.body)).not.toContain(':::');expect(surfacePlan(d.body).fallback).toBe(flattenBlocks(d.body));const pdf=await renderPdf(d);expect(pdf.subarray(0,4).toString()).toBe('%PDF');const chat=await renderSurfacePreview(d,'chat');const og=await renderSurfacePreview(d,'og');png(chat.bytes);png(og.bytes);expect(og.bytes!.readUInt32BE(16)).toBe(1200);expect(og.bytes!.readUInt32BE(20)).toBe(630);expect(chat.route).toBe(SURFACE_MATRIX[type].chat);expect(og.route).toBe(SURFACE_MATRIX[type].og)
 },60000)
 it('does not silently drop unknown future blocks',async()=>{const d={title:'Harbor unknown type',body:':::future-widget\nHarbor value\n:::'};expect(surfacePlan(d.body).unknown).toEqual(['future-widget']);expect(renderHtml(d)).toContain('Harbor value');expect(surfacePlan(d.body).fallback).toContain('Harbor value');expect((await renderSurfacePreview(d,'chat')).route).toBe('content_summary')})
 it('records privacy gating and unsupported fonts while full content remains',async()=>{const d=doc('media');expect(await renderSurfacePreview(d,'chat',[],false)).toEqual({bytes:null,route:'static_link',reason:'privacy_gate'});const foreign={title:'東京',body:'## 旅行\n東京'};expect(await renderSurfacePreview(foreign,'og')).toEqual({bytes:null,route:'static_link',reason:'unsupported_font_or_empty'});expect(renderHtml(foreign)).toContain('東京');expect(surfacePlan(foreign.body).fallback).toContain('東京')})
 it('uses a content-summary recovery for an invalid specialized body',async()=>{const d={title:'Harbor empty route',body:':::route\nonly one cell\n:::'};expect((await renderSurfacePreview(d,'chat')).route).toBe('content_summary');expect((await renderSurfacePreview(d,'og')).route).toBe('content_summary')})
})
