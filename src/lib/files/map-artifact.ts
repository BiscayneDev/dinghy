/** Map deliverables are files, not fresh food discovery. Resolve short retries
 * only against the immediately preceding request, never unrelated older work. */
type ChatLine = { role: string; content: string }
export function wantsMapArtifact(text: string): boolean {
    return /\b(?:make|create|build|draw|send|show|give|put)\b[^.!?\n]{0,90}\bmap\b|\bmap\s+(?:these|those|the shops|the venues|them)\b/i.test(text)
        && !/\b(?:mind map|roadmap|site ?map|map of (?:ideas|concepts))\b/i.test(text)
}
export function mapArtifactTurn(history: ChatLine[]): boolean {
    const users = history.filter(m => m.role === 'user').slice(-2)
    const current = users.at(-1)?.content ?? ''
    return wantsMapArtifact(current) || (/\b(?:make|create|send|do|try)\b[^.!?\n]{0,50}\b(?:one|it|again)\b/i.test(current) && wantsMapArtifact(users.at(-2)?.content ?? ''))
}
export function mapSourceUrls(history: ChatLine[]): string[] {
    // Assistant answers can carry evidence, not authority. Their URLs are leads,
    // not proof of stock, access, indoor position or a current source check.
    const current = history.filter(m => m.role === 'user').at(-1)?.content ?? ''
    // A newly named target needs fresh research, not an unrelated prior citation.
    if (/\bmap\s+(?:of|for|at|in)\b/i.test(current) && !/\b(?:those|these|them|the (?:shops|venues|places))\b/i.test(current)) return []
    const answer = [...history.slice(-6)].reverse().find(m => m.role === 'assistant'
        && /\b(?:shops?|stores?|terminal|airport|restaurants?|cafes?|hotels?|venues?|address|street|museum)\b/i.test(m.content)
        && /https?:\/\//.test(m.content))
    return [...new Set(answer?.content.match(/https?:\/\/[^\s<>"|)\]]+/g) ?? [])]
        .filter(url => { try { const u = new URL(url); return !u.username && !u.password && !u.hostname.endsWith('.here.now') } catch { return false } })
}
export const MAP_ARTIFACT_NOTE = 'The user asked for a map deliverable, or is retrying that request. Resolve the places from the recent conversation. This is NOT fresh food discovery: do not call find_places. Use create_file to deliver a real page. With established places and source links, make a clearly labeled shop/venue locator from those names and links now. A locator is not a drawn floor map: label it "Locator, not a floor map" and state that indoor positions and walking routes are unverified. Include the sources as links. Preserve uncertainty in the prior answer; a shop listing does not confirm current stock or access. Only include an official terminal/floor map or precise indoor position when a source actually supports it. Never invent coordinates, gates, paths, distances, access or stock. Without source links, research with web_search and read relevant source pages first, then create_file. Do not refuse merely because the food finder cannot locate these venues. No file claim without a successful create_file.'
export function mapPageError(input: unknown, urls: string[]): string | null {
    const body = typeof (input as {body?:unknown})?.body === 'string' ? (input as {body:string}).body : ''
    const block = body.match(/(?:^|\n)\s*:::sources\s*\n([\s\S]*?)\n\s*:::/i)?.[1] ?? ''
    const links = block.match(/https?:\/\/[^\s<>"|)\]]+/g) ?? []
    if (!links.length || links.some(u => !urls.includes(u))) return 'A map/locator page needs a :::sources block using exact source URLs from this conversation or research. Do not invent a map URL or venue position.'
    if (!/locator, not a floor map/i.test(body) || !/indoor positions[^\n]{0,80}unverified/i.test(body)) return 'Label this source-linked locator "Locator, not a floor map" and explicitly state indoor positions and walking routes are unverified. Link an official map when found; never draw unsourced positions.'
    return null
}
