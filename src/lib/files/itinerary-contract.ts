/** Itinerary design follows the user's requested sections, not model prose. */
export function itineraryNeedsResearch(request:string):boolean {
 return /\b(?:recommend(?:ations?)?|suggest(?:ions?)?|hotels?|restaurants?|places? to (?:stay|eat)|things to do|activities|fun things)\b/i.test(request)
}
const rows=(body:string,name:string,min:number)=>[...body.matchAll(new RegExp(`(?:^|\\n)\\s*:::${name}\\s*\\n([\\s\\S]*?)\\n\\s*:::`, 'gi'))].flatMap(m=>m[1].split('\n')).filter(l=>l.split('|').filter(c=>c.trim()).length>=min).length
export const ITINERARY_NOTE='Itinerary recommendations need focused web_search and a relevant web_fetch before creating the file. Use current official sources. User-given visits/times stay fixed; preserve requested working sessions and weekend choices. Do not convert an unspecified Friday into an invented calendar date. Organize day headings and time rows; for hotel recommendations use :::stay rows with unknown prices/ratings when unverified, restaurants and activities use :::options rows with source links and catches. Use :::route only for actual supported movements, not a meeting agenda; unknown duration stays unknown. Include source-bound values, a named :::sources block using returned URLs and explicit gaps. Structured cards are required for sections the user requested, not extra decorative invented facts. If external research is unavailable or blocked, provide an explicitly incomplete plan from supplied facts and mark each recommendation gap; never fill from memory.'
export function itineraryPageError(body:string,request:string,urls:string[]):string|null {
 if(!itineraryNeedsResearch(request))return null
 const sources=body.match(/(?:^|\n)\s*:::sources\s*\n([\s\S]*?)\n\s*:::/i)?.[1]??''
 const links=sources.match(/https?:\/\/[^\s<>"|)\]]+/g)??[]
 if(!links.length||links.some(u=>!urls.includes(u)))return 'Itinerary recommendations require observed source links in :::sources. Research first; no remembered hotel ratings, prices, hours or activities.'
 if(/\b(?:hotels?|places? to stay)\b/i.test(request)&&!rows(body,'stay',4))return 'Use a supported :::stay hotel row with area/catch/source link. Leave unverified price and rating unknown, never invent them.'
 if(/\b(?:restaurants?|activities|things to do|fun things)\b/i.test(request)&&!rows(body,'options',4))return 'Use :::options rows for requested dining/activities, with reasons, source links and catches. Do not replace these sections with plain bullets.'
 if(/\bworking sessions?\b/i.test(request)&&!/working sessions?/i.test(body))return 'Preserve the requested working sessions in the itinerary. Unspecified duration and venue remain to confirm.'
 return null
}
