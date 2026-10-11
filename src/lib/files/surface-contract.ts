import { splitBlocks, flattenBlocks, BASE_BLOCKS } from './render'
import { KIND_BLOCKS } from './kinds'
export const SUPPORTED_ANSWER_TYPES = ['markdown',...BASE_BLOCKS,...KIND_BLOCKS] as const
export type AnswerType = typeof SUPPORTED_ANSWER_TYPES[number]
export type ImageRoute = 'specialized' | 'content_summary'
export type SurfaceContract = { page: 'body'; chat: ImageRoute; og: ImageRoute; pdf: 'flattened'; fallback: 'static_text' }
const chatSpecialized = new Set(['weather','scores','stay','route','media','briefing'])
const ogSpecialized = new Set(['weather','scores','stay','route'])
/** Every supported body type has a deliberate route, never an implicit null. */
export const SURFACE_MATRIX = Object.fromEntries(SUPPORTED_ANSWER_TYPES.map(type=>[type,{page:'body',chat:chatSpecialized.has(type)?'specialized':'content_summary',og:ogSpecialized.has(type)?'specialized':'content_summary',pdf:'flattened',fallback:'static_text'}])) as Record<AnswerType,SurfaceContract>
export function surfacePlan(body: string) {
    const segments = splitBlocks(body)
    const types = [...new Set(segments.map(s=>s.kind==='block'?s.name:'markdown'))] as AnswerType[]
    if (!types.length) types.push('markdown')
    const unknown = [...new Set([...body.matchAll(/^\s*:::([a-z][a-z-]*)\s*$/gim)].map(m=>m[1].toLowerCase()).filter(n=>!(SUPPORTED_ANSWER_TYPES as readonly string[]).includes(n)))]
    return {types,unknown,chat:types.some(t=>SURFACE_MATRIX[t].chat==='specialized')?'specialized' as const:'content_summary' as const,og:types.some(t=>SURFACE_MATRIX[t].og==='specialized')?'specialized' as const:'content_summary' as const,fallback:flattenBlocks(body)}
}
