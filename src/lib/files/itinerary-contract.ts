import {ITINERARY_CANDIDATE_NOTE} from './itinerary-candidates'
/** Itinerary design follows the user's requested sections, not model prose. */
export function itineraryNeedsResearch(request:string):boolean {
 return /\b(?:recommend(?:ations?)?|suggest(?:ions?)?|hotels?|restaurants?|places? to (?:stay|eat)|things to do|activities|fun things|fun to do|what to do|something to do|activity ideas|places to go)\b/i.test(request)
}
const rows=(body:string,name:string,min:number)=>[...body.matchAll(new RegExp(`(?:^|\\n)\\s*:::${name}\\s*\\n([\\s\\S]*?)\\n\\s*:::`, 'gi'))].flatMap(m=>m[1].split('\n')).filter(l=>l.split('|').filter(c=>c.trim()).length>=min).length
export const ITINERARY_DAY_HEADING_NOTE='For itinerary day/stop sections, use Markdown H2 or H3 headings starting immediately with Day followed by a number, an English weekday (Mon/Tue/Wed/Thu/Fri/Sat/Sun or its full name), a YYYY-MM-DD date already supplied, or Stop followed by a number. Literal example: ## Friday. Do not use H1, H4+, bold text, an emoji or a label before the day/stop. Never invent a calendar date; do not use route rows for an agenda.'
/** Same accepted syntax as the existing gate; diagnostics never retain text. */
export const ITINERARY_DAY_HEADING=/(?:^|\n)\s*#{2,3}\s+(?:day\s+\d|mon|tue|wed|thu|fri|sat|sun|\d{4}-\d{2}-\d{2}|stop\s+\d)/i
export function itineraryDayFormatCode(body:string):string {
 if(ITINERARY_DAY_HEADING.test(body))return 'accepted_heading'
 const heading=body.match(/(?:^|\n)[ \t]*(#{1,6})[ \t]+([^\n]*)/)
 if(heading){if(heading[1].length===1)return 'h1';if(heading[1].length>=4)return 'h4_plus';return 'unsupported_heading_prefix'}
 if(/(?:^|\n)[ \t]*\*\*[^\n]+\*\*/.test(body))return 'bold_heading'
 return 'no_markdown_heading'
}
export const ITINERARY_NOTE=ITINERARY_CANDIDATE_NOTE+' Itinerary recommendations need focused web_search and a relevant web_fetch before creating the file. Use current official sources. User-given visits/times stay fixed; preserve requested working sessions and weekend choices. Do not convert an unspecified Friday into an invented calendar date. Organize day headings and time rows; '+ITINERARY_DAY_HEADING_NOTE+' For recommendations supply the typed itinerary_candidates described above; the server constructs stay/options rows with unknown absent prices/ratings. Use :::route only for actual supported movements, not a meeting agenda; unknown duration stays unknown. Include source-bound values, explicit gaps. The server builds the :::sources block from immutable registry entries actually bound by this file. Do not transcribe a sources block or URLs; use returned source bindings for the facts/links you use. Structured cards are required for sections the user requested, not extra decorative invented facts. If external research is unavailable or blocked, provide an explicitly incomplete plan from supplied facts and mark each recommendation gap; never fill from memory.'
export function itineraryPageError(body:string,request:string,urls:string[]):string|null {
 if(!itineraryNeedsResearch(request))return null
 const sources=body.match(/(?:^|\n)\s*:::sources\s*\n([\s\S]*?)\n\s*:::/i)?.[1]??''
 const links=sources.match(/https?:\/\/[^\s<>"|)\]]+/g)??[]
 if(!links.length||links.some(u=>!urls.includes(u)))return 'Itinerary recommendations require observed source links in :::sources. Research first; no remembered hotel ratings, prices, hours or activities.'
 // Consolidated :::places venue cards (reason, source link, catch on the card) satisfy the same structured-rows requirement as :::stay/:::options.
 if(/\b(?:hotels?|places? to stay)\b/i.test(request)&&!rows(body,'stay',4)&&!rows(body,'places',4))return 'Use a supported :::stay hotel row with area/catch/source link. Leave unverified price and rating unknown, never invent them.'
 if(/\b(?:restaurants?|activities|things to do|fun things)\b/i.test(request)&&!rows(body,'options',4)&&!rows(body,'places',4))return 'Use :::options rows for requested dining/activities, with reasons, source links and catches. Do not replace these sections with plain bullets.'
 if(/\bworking sessions?\b/i.test(request)&&!/working sessions?/i.test(body))return 'Preserve the requested working sessions in the itinerary. Unspecified duration and venue remain to confirm.'
 return null
}

/** Safe finite codes only. Preserve useful diagnosis without prompts/body/errors. */
export function itineraryShapeErrorCode(error:string):string {
 if(error.startsWith('Itinerary contract:'))return 'day_sections'
 if(error.startsWith('Itinerary recommendations require'))return 'source_rows'
 if(error.startsWith('Use a supported :::stay'))return 'stay_rows'
 if(error.startsWith('Use :::options'))return 'options_rows'
 if(error.startsWith('Preserve the requested working'))return 'working_sessions'
 if(error.startsWith('The requested deliverable needs'))return 'body_missing'
 return 'other'
}
