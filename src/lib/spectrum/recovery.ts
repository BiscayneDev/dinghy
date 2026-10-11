import {isRetailAvailability} from '@/lib/places/intent'
type Line={role:string;content:string}
const NAV=/\b(?:gate\s*\d+[a-z]?|terminal\s*\d+[a-z]?|where (?:should|do|can) i (?:go|find|get)|how (?:do|can) i (?:get|reach)|which (?:way|terminal|shop)|directions?|where is it)\b/i
const VENUE=/\b(?:airport|terminal|gate|shops?|stores?|retailer|pharmacy|nicotine|pouches|charger|museum|station)\b/i
/** User requests establish intent. Prior assistant text is only a venue lead. */
export function researchFollowup(history:Line[]):boolean{
 const users=history.filter(m=>m.role==='user').slice(-2),current=users.at(-1)?.content??''
 if(/\b(?:cancel|never mind|just chat|no need|don't search|do not search)\b/i.test(current))return false
 if(isRetailAvailability(current))return true
 if(!NAV.test(current))return false
 if(/\bwhere (?:should|do|can) i (?:go|find|get)\b/i.test(current)&&/\b(?:coffee|eat|dinner|lunch|restaurant|cafe|food)\b/i.test(current)&&!isRetailAvailability(current))return false
 return VENUE.test(current)||VENUE.test(users.at(-2)?.content??'')||history.slice(-4).some(m=>m.role==='assistant'&&VENUE.test(m.content))
}
export function prematureResearchReply(reply:string):boolean{
 return /\b(?:let me know|want me to|would you like me to|i can (?:search|check|look)|how (?:you'd|you would) like to proceed|tool (?:limit|budget)|out of (?:tool|search)|can't (?:search|check)|cannot (?:search|check))\b/i.test(reply)
}
export const RESEARCH_RECOVERY_NOTE='The current user already asked for the location/result. Do the focused research now; do not ask permission to search or how to proceed. Resolve a short gate/terminal follow-up from the prior user destination and venue context. A newly named destination overrides older context. Prior assistant claims and links are leads, not verification. Read the airport/operator/venue official directory or map where available before giving up. Distinguish verified listing/location from stock, access and walking route. No guessed gates, paths, distances or stock. If a terminal/access detail still blocks the answer after research, ask only that detail. If evidence runs out, return what the sources actually support, the exact unknown gap and observed source links; no promised search or unsupported completion.'
export function inputSchemaError(input:unknown,schema:unknown):string|null{
 const s=schema as {type?:string;required?:string[];properties?:Record<string,{type?:string;enum?:unknown[]}>}
 if(s?.type!=='object')return null
 if(!input||typeof input!=='object'||Array.isArray(input))return 'arguments_object'
 const o=input as Record<string,unknown>
 for(const key of s.required??[])if(!(key in o))return 'required_field'
 for(const [key,v]of Object.entries(o)){
  const p=s.properties?.[key];if(!p)continue
  if(p.type==='array'&&!Array.isArray(v))return 'field_type'
  if(['string','boolean','number','object'].includes(p.type??'')&&(typeof v!==p.type||v===null))return 'field_type'
  if(p.enum&&!p.enum.includes(v))return 'field_enum'
 }
 return null
}

export function stripPermissionOffer(reply:string):string{
 return reply.split(/(?<=[.!?])\s+|\n/).filter(line=>!prematureResearchReply(line)).join(' ').trim()
}
