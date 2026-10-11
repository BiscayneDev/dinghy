import { renderKindCard, renderHeroOg } from './kind-card'
import { renderDocumentOg } from './document-og'
import { surfacePlan } from '@/lib/files/surface-contract'
type Doc = {title:string;subtitle?:string;body:string}
type Photos = Parameters<typeof renderKindCard>[1]
export type PreviewResult = { bytes: Buffer | null; route:'specialized'|'content_summary'|'static_link'; reason?:'privacy_gate'|'unsupported_font_or_empty'|'renderer_error' }
/** Image failure must never remove the source body or claim a rich preview. */
export async function renderSurfacePreview(doc:Doc, surface:'chat'|'og', photos:Photos=[], allowed=true):Promise<PreviewResult> {
    if(!allowed)return {bytes:null,route:'static_link',reason:'privacy_gate'}
    const plan=surfacePlan(doc.body)
    let failed=false
    if(plan[surface]==='specialized'){
        try{const bytes=surface==='chat'?await renderKindCard(doc,photos):await renderHeroOg(doc,photos);if(bytes)return {bytes,route:'specialized'}}catch{failed=true}
    }
    try{const bytes=await renderDocumentOg(doc,true);if(bytes)return {bytes,route:'content_summary'}}catch{failed=true}
    return {bytes:null,route:'static_link',reason:failed?'renderer_error':'unsupported_font_or_empty'}
}
