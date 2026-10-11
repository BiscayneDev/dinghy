import { ImageResponse } from 'next/og'
import { MARK_PNG } from './card-art'
import { dmMono500, frauncesDisplay, schibsted400 } from './static-fonts'
import { splitBlocks } from '@/lib/files/render'

type Doc = { title: string; subtitle?: string; body: string }
const supportedCard = ['weather', 'scores', 'stay', 'route', 'media', 'briefing']
const clean = (s: string) => s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`<>]/g, '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim()
const clip = (s: string, n: number) => { const t = clean(s); return t.length > n ? `${t.slice(0, n - 3).trim()}...` : t }
/** Plain pages only. Structured content keeps its own renderer, including the
 * media hero work. Read section names, never generate claims or stock photos. */
export function documentOgContent(doc: Doc): { title: string; subtitle: string; headings: string[] } | null {
    if (splitBlocks(doc.body).some(s => s.kind === 'block' && supportedCard.includes(s.name))) return null
    const headings = [...new Set(doc.body.split('\n').filter(line => /^#{1,3}\s/.test(line)).map(line => clean(line.replace(/^#{1,3}\s+/, ''))).filter(s => s && s !== clean(doc.title)))]
    const content = { title: clip(doc.title, 100), subtitle: clip(doc.subtitle ?? '', 130), headings: headings.slice(0, 3).map(s => clip(s, 75)) }
    // Bundled fonts only. Unsupported scripts keep the existing fallback, no
    // network font lookup carrying page text to another service.
    if (/[^\u0000-\u024F\u2010-\u2027\u20AC\u2122]/u.test([content.title, content.subtitle, ...content.headings].join(' '))) return null
    return content.title ? content : null
}
const data = (base64: string): ArrayBuffer => { const b = Buffer.from(base64, 'base64'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer }
export async function renderDocumentOg(doc: Doc): Promise<Buffer | null> {
    const c = documentOgContent(doc)
    if (!c) return null
    const res = new ImageResponse(
        <div style={{display:'flex',width:1200,height:630,background:'#FBF6EE',color:'#0E1A33',padding:'46px 62px',flexDirection:'column'}}>
            <div style={{display:'flex',alignItems:'center',fontFamily:'DM Mono',fontSize:18,letterSpacing:'0.14em'}}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={MARK_PNG} width={42} height={42} alt="" style={{borderRadius:9,marginRight:16}} />DINGHY / PAGE
            </div>
            <div style={{display:'flex',fontFamily:'Fraunces',fontSize:c.title.length>65?52:64,lineHeight:1.06,marginTop:30,letterSpacing:'-0.02em'}}>{c.title}</div>
            {c.subtitle ? <div style={{display:'flex',fontFamily:'Schibsted',fontSize:24,lineHeight:1.3,marginTop:16,color:'#5B6270'}}>{c.subtitle}</div> : null}
            <div style={{display:'flex',flexDirection:'column',marginTop:28,fontFamily:'Schibsted',fontSize:25,lineHeight:1.2}}>
                {c.headings.map((h,i)=><div key={i} style={{display:'flex',padding:'13px 0',borderTop:'1px solid #D9D2C5'}}><span style={{display:'flex',fontFamily:'DM Mono',fontSize:18,color:'#C8583A',width:52}}>{String(i+1).padStart(2,'0')}</span>{h}</div>)}
            </div>
            <div style={{display:'flex',marginTop:'auto',fontFamily:'DM Mono',fontSize:15,letterSpacing:'0.12em',color:'#5B6270'}}>OPEN THE PAGE FOR THE DETAILS</div>
        </div>,
        {width:1200,height:630,fonts:[{name:'Fraunces',data:data(frauncesDisplay),weight:500,style:'normal'},{name:'Schibsted',data:data(schibsted400),weight:400,style:'normal'},{name:'DM Mono',data:data(dmMono500),weight:500,style:'normal'}]}
    )
    return Buffer.from(await res.arrayBuffer())
}
