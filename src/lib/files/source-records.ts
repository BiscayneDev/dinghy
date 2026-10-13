/** Per-turn immutable values from successful public read tools. Titles are
 * source titles, not verified venue identities. Text is source-reported,
 * never a stock/access/route confirmation. No cross-turn or persistent cache. */
export type SourceField = 'title' | 'url' | 'published_date' | 'content'
export type SourceRecord = Readonly<{ id: string; title: string | null; url: string; published_date: string | null; content: string | null; checked_at: string; origin: 'search' | 'page' }>
export type SourceRef = { source: string; field: SourceField; start?: number; end?: number }
const fields: SourceField[] = ['title', 'url', 'published_date', 'content']
const urlOk = (value: unknown): value is string => {
    if (typeof value !== 'string' || /[\s<>\"|{}\[\]()\\]/.test(value)) return false
    try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password } catch { return false }
}
import { decodeEntities } from './entities'
const text = (value: unknown) => typeof value === 'string' && value.trim() ? decodeEntities(value) : null
export class SourceRecords {
    private records: SourceRecord[] = []
    capture(tool: string, data: unknown, checkedAt: string): SourceRecord[] {
        if (!['web_search', 'web_fetch'].includes(tool) || !data || typeof data !== 'object') return []
        const input = data as Record<string, unknown>
        const candidates = tool === 'web_search' ? (Array.isArray(input.results) ? input.results : []) : [input]
        const added: SourceRecord[] = []
        for (const candidate of candidates) {
            if (!candidate || typeof candidate !== 'object') continue
            const hit = candidate as Record<string, unknown>
            if (!urlOk(hit.url)) continue
            const record = Object.freeze({ id: `src${this.records.length + 1}`, url: hit.url, title: text(hit.title), content: text(hit.content), published_date: text(hit.published_date), checked_at: checkedAt, origin: tool === 'web_search' ? 'search' as const : 'page' as const })
            this.records.push(record); added.push(record)
        }
        return added
    }
    resolve(ref: unknown): { value: string; record: SourceRecord; field: SourceField } | { error: string } {
        if (!ref || typeof ref !== 'object') return { error: 'Source reference required.' }
        const r = ref as SourceRef
        const record = this.records.find(s => s.id === r.source)
        if (!record || !fields.includes(r.field)) return { error: 'Unknown source ID or field. Use IDs returned by a successful read this turn.' }
        const value = record[r.field]
        if (value === null) return { error: 'This source field is unknown. Do not invent a replacement.' }
        if (r.start === undefined && r.end === undefined) {
            if (r.field === 'content' && value.length > 500) return {error:'Select a literal source excerpt of at most 500 characters.'}
            return { value, record, field: r.field }
        }
        if (r.field !== 'content' || !Number.isInteger(r.start) || !Number.isInteger(r.end) || r.start! < 0 || r.end! <= r.start! || r.end! > value.length || r.end! - r.start! > 500) return { error: 'Invalid source excerpt offsets. Select at most 500 characters from content, without rewriting them.' }
        const cutsToken = (at: number) => at > 0 && at < value.length && (/\w/.test(value[at-1]) && /\w/.test(value[at]) || /\d/.test(value[at-1]) && /[:/\-]/.test(value[at]) || /[:/\-]/.test(value[at-1]) && /\d/.test(value[at]) || value[at] === '.' && /\d/.test(value[at-1]) && /\d/.test(value[at+1] ?? '') || value[at-1] === '.' && /\d/.test(value[at]) && /\d/.test(value[at-2] ?? ''))
        if (cutsToken(r.start!) || cutsToken(r.end!)) return {error:'Excerpt cuts a word, price, date or time. Select the complete source value.'}
        return { value: value.slice(r.start, r.end), record, field: r.field }
    }
    /** Bind exact observed URLs structurally, without trusting model-written IDs.
     * Only literal equality is accepted. This binds a link, never surrounding claims. */
    bindObservedLinks(input:unknown):{input:unknown;count:number} {
        if(!input||typeof input!=='object')return {input,count:0}
        const i=input as Record<string,unknown>
        if(typeof i.body!=='string'||i.body.includes('{{source:'))return {input,count:0}
        let count=0
        const byUrl=new Map<string,SourceRecord>()
        for(const record of this.records)byUrl.set(record.url,record)
        const body=i.body.replace(/https?:\/\/[^\s<>"|)\]]+/g,url=>{
            const r=byUrl.get(url);if(!r)return url
            count++;return `{{source:${r.id}.url}}`
        })
        return {input:{...i,body},count}
    }
    /** Exact literal selection, never fuzzy matching or repaired offsets. */
    locate(source:string,excerpt:string):{start:number;end:number}|{error:string} {
        const record=this.records.find(r=>r.id===source)
        if(!record?.content)return {error:'Unknown source ID or field. Use IDs returned by a successful read this turn.'}
        const start=record.content.indexOf(excerpt)
        if(start<0)return {error:'Candidate literal excerpt is absent from the selected page content.'}
        return {start,end:start+excerpt.length}
    }
    /** Literal page text for a successful page read, else null. */
    pageText(source:string):string|null { const r=this.records.find(x=>x.id===source&&x.origin==='page'); return r?.content??null }
    pageTitle(source:string):string|null { return this.records.find(x=>x.id===source)?.title??null }
    pageUrl(source:string):string|null { return this.records.find(x=>x.id===source)?.url??null }
    pageIds() { return this.records.filter(r=>r.origin==='page' && r.content).map(r=>r.id) }
    size() { return this.records.length }
    available() { return this.records.map(r => ({id:r.id,fields:fields.filter(f=>r[f]!==null)})) }
}

/** Metadata-only categories for failed bindings. Never log the attempted body. */
export function sourceBindingErrorCode(error:string):string {
    if(error.startsWith('Unknown source'))return 'unknown_reference'
    if(error.startsWith('This source field'))return 'unknown_field'
    if(error.startsWith('This researched'))return 'missing_binding'
    if(error.startsWith('Invalid binding')||error.startsWith('Unclosed'))return 'syntax'
    if(error.startsWith('Invalid source excerpt')||error.startsWith('Excerpt cuts')||error.startsWith('Select a literal'))return 'excerpt'
    if(error.startsWith('Source bindings cannot'))return 'code_binding'
    if(error.startsWith('Bound body'))return 'body_length'
    return 'input'
}

/** Escape source values as literal markdown/block cells. Prevent external
 * text from introducing links, HTML or block delimiters. Words remain data. */
function literal(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_{}\[\]()!#|:]/g, c => `&#${c.charCodeAt(0)};`).replace(/[\r\n]/g, ' ')
}
export const SOURCE_BINDING_NOTE = 'Never bind a null/absent field. Check available_fields in each source_record; write unknown for missing dates/titles/content. For researched itineraries omit :::sources and any sources argument; the server adds them. Source-bound file values: successful web reads return immutable source_records with IDs. In create_file title/subtitle/body use {{source:src1.title}}, {{source:src1.url}}, {{source:src1.published_date}} or {{source:src1.content:START:END}}. START/END are exact character offsets, at most 500 characters; the server inserts the original source text, never your rewritten copy. Use these bindings for names, terminals, hours, prices, dates and links when supported. Source titles are page titles, not venue names. Search content is a snippet, not a verified page. Missing values stay unknown. Do not promote a directory listing into current stock, a terminal into a verified walking route, or source-reported text into independent verification. Pick and explain separately from bound facts. A researched deliverable needs source bindings; never invent IDs or substitute guessed values. The server appends provenance for every used source.'

export function bindFileSources(input: unknown, records: SourceRecords, required = false): { input: unknown; count: number; usedSources: SourceRecord[] } | { error: string } {
    if (!input || typeof input !== 'object') return { error: 'File input required.' }
    const i = input as Record<string, unknown>
    const used = new Map<string, SourceRecord>()
    let count = 0
    let error: string | undefined
    const expand = (raw: unknown, field: string) => {
        if (typeof raw !== 'string') return raw
        if(field==='code'&&raw.includes('{{source:')){error='Source bindings cannot be used as generated code.';return ''}
        const expanded = raw.replace(/\{\{source:([^}]+)\}\}/g, (_token, spec: string) => {
            const m = spec.match(/^(src\d+)\.(title|url|published_date|content)(?::(\d+):(\d+))?$/)
            if (!m) { error = 'Invalid binding syntax. Use a returned source ID and exact field/offsets.'; return '' }
            const result = records.resolve({source:m[1],field:m[2],...(m[3] ? {start:Number(m[3]),end:Number(m[4])} : {})})
            if ('error' in result) { error = result.error; return '' }
            used.set(result.record.id,result.record); count++
            // Bound URLs remain safe URLs for markdown links/sources rows.
            // Titles/subtitles have no markdown interpretation at render time.
            return field !== 'body' || result.field === 'url' ? result.value.replace(/[\r\n]/g, ' ') : literal(result.value)
        })
        if (expanded.includes('{{source:')) error = 'Unclosed source binding. No file was published.'
        return expanded
    }
    // JSON strings need JSON escaping, not markdown entities. Parse before
    // expanding so source text cannot introduce keys, code or components.
    const body = typeof i.body === 'string' ? i.body.split(/(:::pages[^\S\r\n]*\r?\n[\s\S]*?\r?\n:::)/g).map(part=>{
        if(!part.startsWith(':::pages')) return expand(part,'body')
        try {
            const data=JSON.parse(part.replace(/^:::pages[^\S\r\n]*\r?\n/,'').replace(/\r?\n:::$/,''))
            const walk=(v:unknown,k=''):unknown=>typeof v==='string' ? expand(v,k==='code'?'code':'pages') : Array.isArray(v)?v.map(x=>walk(x)):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([key,value])=>[key,walk(value,key)])):v
            return ':::pages\n'+JSON.stringify(walk(data))+'\n:::'
        }catch{return expand(part,'body')}
    }).join('') : i.body
    const next = {...i,title:expand(i.title,'title'),subtitle:expand(i.subtitle,'subtitle'),body}
    if (error) return { error }
    if (required && !count) return { error: 'This researched deliverable needs source bindings for its source facts. Use source_records IDs, not retyped names/prices/hours or invented values.' }
    if (typeof next.body === 'string' && used.size) {
        const rows = [...used.values()].filter(r=>r.url!=='https://www.geoapify.com/places-api/').map(r => `- ${literal(r.title ?? 'Source')} (${r.origin === 'search' ? 'search snippet' : 'page text'}), checked ${literal(r.checked_at)}${r.published_date ? `, source date ${literal(r.published_date)}` : ', source date unknown'}: ${r.url}`)
        if(rows.length)next.body += '\n\n## Source provenance\nSource-reported text, not independent confirmation of current stock, access or a walking route. A listed terminal is not a verified route.\n\n'+rows.join('\n')
        else if([...used.values()].some(r=>r.url==='https://www.geoapify.com/places-api/')) {
            const attribution='Venue names, categories and addresses: Geoapify · © OpenStreetMap contributors. Provider listings do not confirm current hours, availability, prices or quality.'
            next.body=next.body.replace(attribution,'').trimEnd()+'\n\n## Source provenance\n- '+attribution+' https://www.geoapify.com/places-api/'
        }
    }
    if (typeof next.body === 'string' && next.body.length > 60_000) return {error:'Bound body is too long (max 60000 characters). Reduce source excerpts.'}
    return { input: next, count, usedSources:[...used.values()] }
}

/** Keep immutable IDs and literal content prefixes visible without duplicating
 * the full raw read. Offsets in the shown prefix still address the stored page. */
export function sourceResultEnvelope(records: SourceRecord[], maxChars=4000): string {
    const shown: unknown[]=[]
    const envelope=()=>JSON.stringify({source_records:shown,note:'Literal content prefixes only; offsets address the original source. Unknown fields stay unknown.',omitted_sources:records.length-shown.length})
    for(const r of records){
        const item={...r,available_fields:fields.filter(f=>r[f]!==null),title:r.title?.slice(0,160)??null,content:r.content?.slice(0,1000)??null,content_length:r.content?.length??0,content_truncated:Boolean(r.content&&r.content.length>1000)}
        shown.push(item)
        if(envelope().length>maxChars)shown.pop()
    }
    return envelope()
                                                       }

/** Renderer syntax comes from the registry, not model-transcribed source rows.
 * Preserve invalid explicit source URLs as a rejection, never silently hide them. */
export function compileItinerarySources(input:unknown,used:SourceRecord[],observedUrls:string[]):{input:unknown}|{error:string} {
 if(!input||typeof input!=='object')return {error:'File input required.'}
 const i=input as Record<string,unknown>
 if(typeof i.body!=='string')return {input}
 const blocks=[...i.body.matchAll(/(?:^|\n)[ \t]*:::sources[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*:::/gi)]
 for(const block of blocks){const urls=block[1].match(/https?:\/\/[^\s<>"|)\]]+/g)??[];if(urls.some(url=>!observedUrls.includes(url)))return {error:'Itinerary recommendations require observed source links in :::sources. Unknown explicit source URL; no file was published.'}}
 if(!used.length)return {error:'Itinerary recommendations require observed source links in :::sources. No source registry entries were bound.'}
 const clean=i.body.replace(/(?:^|\n)[ \t]*:::sources[ \t]*\r?\n[\s\S]*?\r?\n[ \t]*:::/gi,'')
 if(/(?:^|\n)[ \t]*:::sources\b/i.test(clean))return {error:'Itinerary recommendations require observed source links in :::sources. Malformed explicit sources block; no file was published.'}
 const rows=[...new Map(used.map(r=>[r.url,r])).values()].map(r=>`${literal(r.title??'Source').replace(/\|/g,'&#124;')} | ${r.url} | ${r.origin==='search'?'search snippet':'page text'}; checked ${literal(r.checked_at)}; source date ${literal(r.published_date??'unknown')}`)
 return {input:{...i,body:clean.trimEnd()+'\n\n:::sources\n'+rows.join('\n')+'\n:::'}}
}
