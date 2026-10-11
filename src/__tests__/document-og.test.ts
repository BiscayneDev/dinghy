import * as React from 'react'
;(globalThis as unknown as {React:unknown}).React=React
import {describe,it,expect} from 'vitest'
import {documentOgContent,renderDocumentOg} from '@/lib/brand/document-og'
const doc={title:'Electronics at Harbor Airport',subtitle:'Directory notes, not stock confirmation',body:'## Shops\n### East Electronics\nStock unknown.\n### Terminal Supplies\nTerminal 4.\n## Sources\nhttps://airport.test/shops'}
describe('plain document share image',()=>{
 it('uses actual section headings only, removes duplicate title and markdown links',()=>{expect(documentOgContent({...doc,body:'# Electronics at Harbor Airport\n## [East Electronics](https://airport.test/a)\n## East Electronics\n## Access'})).toEqual({title:doc.title,subtitle:doc.subtitle,headings:['East Electronics','Access']})})
 it('draws a 1200x630 PNG without photos or network retrieval',async()=>{const b=await renderDocumentOg(doc);expect([...b!.subarray(0,4)]).toEqual([137,80,78,71]);expect(b!.readUInt32BE(16)).toBe(1200);expect(b!.readUInt32BE(20)).toBe(630)},60000)
 it('leaves structured cards and unsupported scripts to their existing renderers',()=>{for(const kind of ['weather','scores','stay','route','media','briefing'])expect(documentOgContent({...doc,body:`:::${kind}\nExample | row\n:::`})).toBeNull();expect(documentOgContent({...doc,title:'旅行'})).toBeNull()})
 it('works with no headings and bounds long text',()=>{expect(documentOgContent({...doc,body:'Plain notes'} )!.headings).toEqual([]);expect(documentOgContent({...doc,title:'word '.repeat(90)})!.title.length).toBeLessThanOrEqual(100)})
})
