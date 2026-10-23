/** Build-only panel. Fixed typography over moving coast artwork, no private data. */
import React from 'react'
import { writeFileSync } from 'node:fs'
import { ImageResponse } from 'next/og'
import { MARK_PNG } from '../src/lib/brand/card-art'
import { dmMono500, frauncesDisplay, frauncesItalic } from '../src/lib/brand/static-fonts'
const data = (b64:string) => { const b=Buffer.from(b64,'base64');return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength) as ArrayBuffer }
async function main() {
 const image = new ImageResponse(
  <div style={{display:'flex',width:1200,height:630,background:'transparent'}}>
   <div style={{display:'flex',position:'absolute',left:48,top:48,width:600,height:534,background:'#FBF6EE',borderRadius:32,padding:'46px 50px',flexDirection:'column'}}>
    <div style={{display:'flex',alignItems:'center',gap:14}}>
     <img src={MARK_PNG} width={40} height={40} alt="" style={{borderRadius:9}} />
     <span style={{fontFamily:'DM Mono',fontSize:15,letterSpacing:'0.16em',color:'#5B6270'}}>DINGHY</span>
    </div>
    <div style={{display:'flex',marginTop:'auto',fontFamily:'Fraunces',fontSize:60,lineHeight:1.04,letterSpacing:'-0.02em',color:'#0E1A33'}}>Your first mate,</div>
    <div style={{display:'flex',fontFamily:'Fraunces Italic',fontStyle:'italic',fontSize:60,lineHeight:1.04,letterSpacing:'-0.02em',color:'#C8583A'}}>one text away</div>
    <div style={{display:'flex',marginTop:'auto',fontFamily:'DM Mono',fontSize:15,letterSpacing:'0.16em',color:'#5B6270'}}>GETDINGHY.SH</div>
   </div>
  </div>,{width:1200,height:630,fonts:[{name:'Fraunces',data:data(frauncesDisplay),weight:500},{name:'Fraunces Italic',data:data(frauncesItalic),weight:400,style:'italic'},{name:'DM Mono',data:data(dmMono500),weight:500}]})
 writeFileSync(process.argv[2],Buffer.from(await image.arrayBuffer()))
}
main().catch(e=>{console.error(e);process.exit(1)})
