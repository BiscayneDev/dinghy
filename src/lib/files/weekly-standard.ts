/** Time-bound rankings need visible evidence, not an evergreen reading list. */
export function weeklyListRequest(text: string): boolean {
    return /\b(?:top|best|popular|trending|bestsell(?:ing|ers)|chart|rank(?:ed|ing))\b/i.test(text)
        && /\b(?:this week|today|latest|currently|right now)\b/i.test(text)
}
export function weeklyPageError(input: unknown, request: string, observedUrls: string[]): string | null {
    if (!weeklyListRequest(request)) return null
    const body = typeof (input as {body?:unknown})?.body === 'string' ? (input as {body:string}).body : ''
    const block = body.match(/(?:^|\n)\s*:::sources\s*\n([\s\S]*?)\n\s*:::/i)?.[1]
    const lines = (block ?? '').split('\n').filter(s => s.trim())
    if (!lines.length) return 'A current top list needs a :::sources block naming the source, linking the observed evidence, and showing its publication/list date plus date checked. Do not invent a ranking; if no current chart exists label dated editorial picks instead.'
    for (const line of lines) {
        const [name, url, date] = line.split('|').map(s => s.trim())
        if (!name || !url || !observedUrls.includes(url) || !date || !/\b\d{4}-\d{2}-\d{2}\b/.test(date) || !/(?:published|list date|date unavailable)/i.test(date) || !/checked/i.test(date)) return 'Every source row must use a named source, an exact URL returned by research this turn, and a visible YYYY-MM-DD list/publication date (or explicitly date unavailable) plus date checked. Use current evidence; do not fill unknown dates.'
    }
    if (/\b(?:books?|novels?|movies?|films?|games?)\b/i.test(request) && !/(?:^|\n)\s*:::media\s*\n/i.test(body)) return 'Use :::media rows for this book/movie/game list so the page and share image show the media, not a plain text list. Keep the named dated :::sources block.'
    return null
}
