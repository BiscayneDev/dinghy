import {decodeEntities} from './entities'
/**
 * Designed blocks for the page kinds people ask for most: weather, sports,
 * movies/books/games, trips and stays, and the news briefing. Same contract as
 * the other blocks in render.ts: the model writes plain pipe-separated lines,
 * this file turns them into markup. Everything is escaped, links are plain
 * http(s), and the only image allowed is one the page builder already copied
 * next to the page (img/<name>.jpg|png|webp). Remote image URLs never reach
 * the HTML, so a page cannot pull from a third-party server when it opens.
 */

export const KIND_BLOCKS = ['weather', 'scores', 'media', 'stay', 'route', 'briefing', 'gallery', 'lead', 'checks', 'calc', 'chart', 'countdown'] as const
export type KindBlock = (typeof KIND_BLOCKS)[number]

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export const cells = (line: string): string[] => line.split('|').map((c) => decodeEntities(c.trim()))
const httpUrl = (u?: string) => (u && /^https?:\/\/[^\s\u0000-\u001f]+$/i.test(u) ? u : '')
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return '' } }

/** Local copy of a photo, written by the page builder. Anything else is dropped. */
export const LOCAL_IMG = /^img\/[a-z0-9][a-z0-9-]{0,60}\.(?:jpg|jpeg|png|webp)$/i
const img = (p?: string) => (p && LOCAL_IMG.test(p) ? p : '')

/** Explicit uncertainty is body content, never a decorative price/rating. */
export const knownValue = (value?:string):string => /^(?:unknown|unverified|not (?:checked|verified|available)|n\/?a|to (?:confirm|check)|tbc|tbd)$/i.test((value??'').trim()) ? '' : value??''

/** Stable 0-359 hue from a title, so a card with no photo still gets its own colour. */
export function hue(s: string): number {
    let h = 0
    for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360
    return h
}


const CLOUD = '<path d="M17 38a9 9 0 0 1 1.6-17.9A12 12 0 0 1 41.4 22 8 8 0 0 1 41 38z" fill="#fff"/>'
const SUN = (x: number, y: number, r: number) => `<g transform="translate(${x} ${y})"><circle r="${r}" fill="#FFD27A"/>${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<path d="M0 ${-r - 4}V${-r - 9}" stroke="#FFD27A" stroke-width="3" stroke-linecap="round" transform="rotate(${a})"/>`).join('')}</g>`
/** Small inline weather icon. No emoji, so it looks the same on every phone. */
export function skyIcon(cls: string, size: number): string {
    const body: Record<string, string> = {
        clear: SUN(32, 32, 11),
        part: `${SUN(40, 22, 8)}<g transform="translate(-4 8)">${CLOUD}</g>`,
        cloud: `<g transform="translate(0 4)">${CLOUD}</g>`,
        rain: `${CLOUD}${[22, 31, 40].map((x) => `<path d="M${x} 43l-3 8" stroke="#BFD6FF" stroke-width="3" stroke-linecap="round"/>`).join('')}`,
        storm: `${CLOUD}<path d="M33 38l-6 9h5l-3 8 9-11h-5l3-6z" fill="#FFD27A"/>`,
        snow: `${CLOUD}${[22, 32, 42].map((x) => `<circle cx="${x}" cy="47" r="2.4" fill="#fff"/>`).join('')}`,
        fog: `${CLOUD}${[44, 51].map((y) => `<path d="M14 ${y}h36" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".7"/>`).join('')}`,
    }
    return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">${body[cls] ?? body.part}</svg>`
}

/** Pick a sky look from the words the model used. */
export function skyOf(sky: string): { cls: string } {
    const s = sky.toLowerCase()
    if (/thunder|storm/.test(s)) return { cls: 'storm' }
    if (/snow|sleet|flurr/.test(s)) return { cls: 'snow' }
    if (/rain|shower|drizzle/.test(s)) return { cls: 'rain' }
    if (/fog|mist|haze/.test(s)) return { cls: 'fog' }
    if (/part|mostly sunny|scatter/.test(s)) return { cls: 'part' }
    if (/cloud|overcast/.test(s)) return { cls: 'cloud' }
    if (/clear|sun|fair/.test(s)) return { cls: 'clear' }
    return { cls: 'part' }
}

export const num = (s?: string): number | null => {
    const m = (s ?? '').match(/-?\d+(?:\.\d+)?/)
    return m ? Number(m[0]) : null
}

/**
 * weather: first line "Place | now temp | sky | high | low | wind | rain chance | feels like",
 * then one "Day | high | low | sky | rain chance" line per forecast day.
 */
function renderWeather(lines: string[], opts?: { hero?: boolean }): string {
    const [place, now, sky, hi, lo, wind, rain, feels] = cells(lines[0] ?? '')
    if (!place) return ''
    const s = skyOf(sky ?? '')
    const days = lines.slice(1, 9).map(cells).filter((d) => d[0])
    const lows = days.map((d) => num(d[2])).filter((n): n is number => n !== null)
    const highs = days.map((d) => num(d[1])).filter((n): n is number => n !== null)
    const min = Math.min(...lows, ...(num(lo) !== null ? [num(lo) as number] : []))
    const max = Math.max(...highs, ...(num(hi) !== null ? [num(hi) as number] : []))
    const span = Number.isFinite(min) && Number.isFinite(max) && max > min ? max - min : 0
    const bar = (l: number | null, h: number | null) => {
        if (!span || l === null || h === null) return ''
        const a = Math.max(0, Math.min(100, ((l - min) / span) * 100))
        const b = Math.max(a + 6, Math.min(100, ((h - min) / span) * 100))
        return `<span class="wx-bar" aria-hidden="true"><i style="left:${a.toFixed(0)}%;width:${(b - a).toFixed(0)}%"></i></span>`
    }
    const facts = [
        hi || lo ? ['High / low', `${esc(hi ?? '')} / ${esc(lo ?? '')}`] : null,
        wind ? ['Wind', esc(wind)] : null,
        rain ? ['Rain', esc(rain)] : null,
        feels ? ['Feels like', esc(feels)] : null,
    ].filter((x): x is string[] => !!x)
    const rows = days.map((d) => {
        const ds = skyOf(d[3] ?? '')
        return `<div class="wx-day"><span class="wx-dn">${esc(d[0])}</span><span class="wx-dg" title="${esc(d[3] ?? '')}">${skyIcon(ds.cls, 26)}</span><span class="wx-dl">${esc(d[2] ?? '')}</span>${bar(num(d[2]), num(d[1]))}<span class="wx-dh">${esc(d[1] ?? '')}</span><span class="wx-dr">${esc(d[4] ?? '')}</span></div>`
    })
    // When the page hero already carries this block's place/temp/sky identity, the
    // card shows only what the hero cannot: the fact grid and the day rows.
    const head = opts?.hero === false ? '' : `<div class="wx-hero"><div><div class="wx-place">${esc(place)}</div><div class="wx-now">${esc(now ?? '')}</div><div class="wx-sky">${esc(sky ?? '')}</div></div><div class="wx-glyph" aria-hidden="true">${skyIcon(s.cls, 88)}</div></div>`
    return `<div class="wx wx-${s.cls}">${head}${facts.length ? `<div class="wx-facts">${facts.map(([k, v]) => `<div><span>${k}</span>${v}</div>`).join('')}</div>` : ''}${rows.length ? `<div class="wx-days">${rows.join('')}</div>` : ''}</div>`
}

/**
 * scores: "Away team | away score | Home team | home score | status | detail".
 * Status is "Final", "Live" or a start time; the higher score is bold once final or live.
 */
function renderScores(lines: string[]): string {
    const cards = lines.slice(0, 10).map((l) => {
        const [a, as, h, hs, status, detail] = cells(l)
        if (!a || !h) return ''
        const an = num(as), hn = num(hs)
        const played = an !== null && hn !== null
        const live = /live|q\d|inning|half|period|'/i.test(status ?? '') && !/final/i.test(status ?? '')
        const win = played ? (an! > hn! ? 'a' : hn! > an! ? 'h' : '') : ''
        const row = (side: 'a' | 'h', name: string, score?: string) =>
            `<div class="sc-row${win === side ? ' sc-win' : ''}"><span class="sc-mark" style="--h:${hue(name)}">${esc(name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase())}</span><span class="sc-name">${esc(name)}</span><span class="sc-n">${played ? esc(score ?? '') : ''}</span></div>`
        return `<div class="sc${live ? ' sc-live' : ''}"><div class="sc-st">${live ? '<i></i>' : ''}${esc(status ?? '')}</div>${row('a', a, as)}${row('h', h, hs)}${detail ? `<div class="sc-d">${esc(detail)}</div>` : ''}</div>`
    })
    return `<div class="scs">${cards.join('')}</div>`
}

/** media: "Title | movie/book/game | year | rating | by/with | why it is worth it | photo | link". */
function renderMedia(lines: string[]): string {
    const cards = lines.slice(0, 8).map((l) => {
        const [title, kind, year, rating, by, why, photo, link] = cells(l)
        if (!title) return ''
        const k = /book|game/i.test(kind ?? '') ? (kind as string).toLowerCase() : 'movie'
        const p = img(photo)
        const url = httpUrl(link)
        const cover = p
            ? `<div class="md-cover"><img src="${esc(p)}" alt="${esc(title)} cover" loading="lazy" decoding="async"></div>`
            : `<div class="md-cover md-blank" style="--h:${hue(title)}"><span>${esc(title.slice(0, 40))}</span><em>${esc(k)}</em></div>`
        const meta = [year, by].filter(Boolean).map((t) => esc(t as string)).join(' · ')
        return `<article class="md">${cover}<div class="md-b"><div class="md-top"><h4>${esc(title)}</h4>${rating ? `<span class="md-r">${esc(rating)}</span>` : ''}</div>${meta ? `<div class="md-m">${meta}</div>` : ''}${why ? `<p>${esc(why)}</p>` : ''}${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(host(url))}</a>` : ''}</div></article>`
    })
    return `<div class="mds">${cards.join('')}</div>`
}

/** stay: "Hotel | price per night | rating | area or distance | the catch | photo | link". */
function renderStay(lines: string[]): string {
    const cards = lines.slice(0, 6).map((l) => {
        const [name, price, rating, area, catchTxt, photo, link] = cells(l)
        if (!name) return ''
        const p = img(photo)
        const url = httpUrl(link)
        const pic = p ? `<div class="st-pic"><img src="${esc(p)}" alt="${esc(name)}" loading="lazy" decoding="async"></div>` : `<div class="st-pic st-blank" style="--h:${hue(name)}" aria-hidden="true"></div>`
        return `<article class="st">${pic}<div class="st-b"><div class="st-top"><h4>${esc(name)}</h4>${knownValue(price) ? `<span class="st-p">${esc(price)}</span>` : ''}</div><div class="st-m">${[knownValue(rating) && `★ ${esc(rating)}`, area && esc(area)].filter(Boolean).join(' · ')}</div>${catchTxt ? `<p class="st-c"><span>Catch</span>${esc(catchTxt)}</p>` : ''}${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(host(url))}</a>` : ''}</div></article>`
    })
    return `<div class="sts">${cards.join('')}</div>`
}

/** route: "From | To | mode | time | detail | directions link" per leg. Draws a vertical line with stops. Empty cells render nothing; the optional last cell is a plain http(s) link, drawn as a Directions action, so an unknown-duration leg still does something useful. */
function renderRoute(lines: string[]): string {
    const legs = lines.slice(0, 10).map(cells).filter((c) => c[0] && c[1])
    if (!legs.length) return ''
    const out: string[] = []
    let last = ''
    const stop = (name: string) => {
        if (name === last) return
        last = name
        out.push(`<div class="rt-stop"><span class="rt-dot"></span><span class="rt-name">${esc(name)}</span></div>`)
    }
    for (const leg of legs) {
        stop(leg[0])
        const dir=httpUrl(leg[5])
        out.push(`<div class="rt-leg">${leg[2] ? `<span class="rt-mode">${esc(leg[2])}</span>` : ''}${leg[3] ? `<span class="rt-time">${esc(leg[3])}</span>` : ''}${leg[4] ? `<span class="rt-det">${esc(leg[4])}</span>` : ''}${dir ? `<a class="rt-dir" href="${esc(dir)}" target="_blank" rel="noopener noreferrer">Directions</a>` : ''}</div>`)
        stop(leg[1])
    }
    return `<div class="rt">${out.join('')}</div>`
}

/** briefing: "Headline | source | when | one-line summary | https://link". */
function renderBriefing(lines: string[]): string {
    const items = lines.slice(0, 10).map((l, i) => {
        const [head, source, when, sum, link] = cells(l)
        if (!head) return ''
        const url = httpUrl(link)
        const title = url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(head)}</a>` : esc(head)
        return `<article class="br"><span class="br-n">${String(i + 1).padStart(2, '0')}</span><div><h4>${title}</h4>${sum ? `<p>${esc(sum)}</p>` : ''}<div class="br-m">${[source && esc(source), when && esc(when), url && host(url)].filter(Boolean).join(' · ')}</div></div></article>`
    })
    return `<div class="brs">${items.join('')}</div>`
}

/** gallery: "img/name.jpg | caption | credit | license | source url | license url". Only builder-copied images render. */
function renderGallery(lines: string[]): string {
    const figs = lines.slice(0, 6).map((l) => {
        const [src, caption, credit, license, sourceUrl, licenseUrl] = cells(l)
        const p = img(src)
        if (!p) return ''
        const link = (txt: string | undefined, u: string | undefined) => txt && u && /^https:\/\/[^\s"'<>]+$/.test(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(txt)}</a>` : txt ? esc(txt) : ''
        const cr = [esc(credit ?? ''), link(license, licenseUrl), sourceUrl ? link('source', sourceUrl) : ''].filter(Boolean).join(' · ')
        return `<figure><img src="${esc(p)}" alt="${esc(caption ?? '')}" loading="lazy" decoding="async" onerror="this.closest('figure')?.remove()"><figcaption>${esc(caption ?? '')}${cr ? `<small>${cr}</small>` : ''}</figcaption></figure>`
    }).filter(Boolean)
    if (!figs.length) return ''
    return `<div class="gal gal-${Math.min(figs.length, 3)}">${figs.join('')}</div>`
}

const FOCUS: Record<string, string> = { price: 'price', cost: 'price', family: 'family fit', fit: 'fit', place: 'location', location: 'location', access: 'access', time: 'timing' }

/** lead: "for | name", "focus | price", "pick | name | why", "beat | name | why it lost", "care | chip | chip". The page opens on the pick and what it was built around. */
function renderLead(lines: string[]): string {
    const rows: Record<string, string[]> = {}
    for (const l of lines.slice(0, 8)) { const [k, ...v] = cells(l); if (k && !rows[k.toLowerCase()]) rows[k.toLowerCase()] = v }
    const pick = rows.pick
    if (!pick?.[0]) return ''
    const who = rows.for?.[0]
    const focus = FOCUS[(rows.focus?.[0] ?? '').toLowerCase()]
    const beat = rows.beat
    const care = (rows.care ?? []).filter(Boolean).slice(0, 5)
    return `<section class="ld"><div class="ld-top">${who ? `<span class="ld-for">Made for ${esc(who)}</span>` : ''}${focus ? `<span class="ld-focus">Built around ${esc(focus)}</span>` : ''}</div>`
        + `<h3 class="ld-pick">${esc(pick[0])}</h3>${pick[1] ? `<p class="ld-why">${esc(pick[1])}</p>` : ''}`
        + (beat?.[0] ? `<p class="ld-beat"><span>Beat</span> ${esc(beat[0])}${beat[1] ? ` - ${esc(beat[1])}` : ''}</p>` : '')
        + (care.length ? `<div class="ld-care">${care.map((c) => `<span>${esc(c)}</span>`).join('')}</div>` : '') + '</section>'
}

/** checks: "claim | confirmed or unverified | where it came from | when". Anything not clearly confirmed shows as unverified. */
function renderChecks(lines: string[]): string {
    const rows = lines.slice(0, 8).map((l) => {
        const [claim, status, where, when] = cells(l)
        if (!claim) return ''
        const ok = /^confirmed$/i.test(status ?? '') && Boolean(where?.trim()) && Boolean(when?.trim())
        const meta = [where, when ? `checked ${when}` : ''].filter(Boolean).map(esc).join(' · ')
        return `<li class="${ok ? 'ck-ok' : 'ck-no'}"><span class="ck-tag">${ok ? 'Confirmed' : 'Unverified'}</span><span class="ck-t">${esc(claim)}${meta ? `<small>${meta}</small>` : ''}</span></li>`
    }).filter(Boolean)
    return rows.length ? `<ul class="ck">${rows.join('')}</ul>` : ''
}

const mins = (t: string): number => {
    const m = t.trim().match(/^(?:(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\s*)?(?:(\d+)\s*(?:m|min|mins|minute|minutes))?$/i)
    if (!m || (!m[1] && !m[2])) return 0
    return Math.round(Number(m[1] ?? 0) * 60) + Number(m[2] ?? 0)
}

export function routeSummary(lines: string[]): { legs: string[][]; eta: string; first: string[]; last: string[]; hidden: number } | null {
    const all = lines.map(cells).filter((c) => c[0] && c[1])
    if (!all.length) return null
    const times = all.map((l) => mins(l[3] ?? ''))
    const total = times.reduce((a, n) => a + n, 0)
    const eta = times.every((n) => n > 0) ? (total >= 60 ? `${Math.floor(total / 60)} h ${total % 60 ? `${total % 60} min` : ''}`.trim() : `${total} min`) : `${all.length} ${all.length === 1 ? 'leg' : 'legs'}`
    return { legs: all.slice(0, 4), eta, first: all[0], last: all[all.length - 1], hidden: Math.max(0, all.length - 4) }
}

type Seg = { name: string; lines: string[] }
const hsl = (h: number, s: number, l: number) => `hsl(${h} ${s}% ${l}%)`
const WX_SKY: Record<string, [string, string]> = {
    clear: ['#2F6FC4', '#F2B56B'], part: ['#3F6AB5', '#9DB8DF'], cloud: ['#5E6B85', '#A3AEC2'], rain: ['#34476B', '#6D87AE'],
    storm: ['#241F3D', '#5B4F86'], snow: ['#6F89B3', '#C9D8EC'], fog: ['#69758A', '#BCC5D2'],
}

/**
 * The top band of a page, drawn from the answer: a stay photo (or its colour card), a route line with the
 * total time, the two team colours with the score, or the sky with the temperature. Null means the page
 * keeps the sunrise band. Decorative: the same numbers sit in the page below, so it is hidden from screen readers.
 */
export function pageHero(blocks: Seg[]): string | null {
    const first = blocks.find((b) => ['stay', 'route', 'scores', 'weather', 'media', 'countdown'].includes(b.name))
    if (!first) return null
    const lead = blocks.find((b) => b.name === 'lead')
    const leadPick = (lead?.lines.map(cells).find((c) => c[0]?.toLowerCase() === 'pick')?.[1] ?? '').toLowerCase()
    if (first.name === 'weather') {
        const [place, now, sky] = cells(first.lines[0] ?? '')
        if (!place || !now) return null
        const cls = skyOf(sky ?? '').cls
        const [c1, c2] = WX_SKY[cls] ?? WX_SKY.part
        return `<div class="band hero" aria-hidden="true" style="background:linear-gradient(160deg,${c1},${c2})"><div class="hero-in"><span class="hero-k">${esc(place)}</span><span class="hero-n">${esc(now)}</span><span class="hero-s">${esc(sky ?? '')}</span></div><span class="hero-ico">${skyIcon(cls, 150)}</span></div>`
    }
    if (first.name === 'scores') {
        const g = first.lines.map(cells).find((c) => c[0] && c[2])
        if (!g) return null
        const [a, as, h, hs, status] = g
        const played = num(as) !== null && num(hs) !== null
        return `<div class="band hero" aria-hidden="true" style="background:linear-gradient(115deg,${hsl(hue(a), 45, 30)} 0 50%,${hsl(hue(h), 45, 30)} 50% 100%)"><div class="hero-in hero-mid">${played ? `<span class="hero-vs"><b>${esc(as)}</b><i>vs</i><b>${esc(hs)}</b></span>` : `<span class="hero-n hero-title">${esc(a)} vs ${esc(h)}</span>`}<span class="hero-s">${played ? `${esc(a)} · ${esc(h)}${status ? ` · ${esc(status)}` : ''}` : esc(status ?? '')}</span></div></div>`
    }
    if (first.name === 'route') {
        const r = routeSummary(first.lines)
        if (!r) return null
        const path = 'M60 250C180 235 240 150 330 144S470 175 540 90 640 52 670 46'
        const svg = `<svg viewBox="0 0 720 340" preserveAspectRatio="xMidYMid slice"><path d="${path}" stroke="rgba(240,138,104,.3)" stroke-width="16" fill="none" stroke-linecap="round"/><path d="${path}" stroke="#F08A68" stroke-width="5" fill="none" stroke-linecap="round" stroke-dasharray="1 13"/><circle cx="60" cy="250" r="12" fill="#fff"/><circle cx="60" cy="250" r="5" fill="#0E1A33"/><circle cx="670" cy="46" r="14" fill="#F08A68"/><circle cx="670" cy="46" r="5" fill="#fff"/></svg>`
        return `<div class="band hero" aria-hidden="true" style="background:linear-gradient(160deg,#16305A,#0E1A33)">${svg}<div class="hero-in"><span class="hero-k">${esc([...new Set(r.legs.map((l) => l[2]).filter(Boolean))].join(' + ') || 'Route')}</span><span class="hero-n">${esc(r.eta)}</span></div></div>`
    }
    if (first.name === 'countdown') {
        const [event, dateISO] = cells(first.lines[0] ?? '')
        const days = countdownDays(dateISO ?? '')
        if (!event || days === null) return null
        const n = Math.abs(days)
        const label = days === 0 ? '' : days > 0 ? (n === 1 ? 'day to go' : 'days to go') : (n === 1 ? 'day ago' : 'days ago')
        return `<div class="band hero" aria-hidden="true" style="background:linear-gradient(160deg,#16305A,#0E1A33)"><div class="hero-in hero-mid"><span class="hero-k">${esc(event)}</span><span class="hero-n" data-cdn-date="${esc(dateISO ?? '')}">${days === 0 ? 'Today' : n}</span><span class="hero-s" data-cdn-label>${esc([label, dateISO].filter(Boolean).join(' · '))}</span></div></div>`
    }
    if (first.name === 'media') {
        const mrows = first.lines.map(cells).filter((c) => c[0])
        const mp = mrows.find((c) => leadPick && c[0].toLowerCase() === leadPick)
        const m = mp ?? mrows[0]
        if (!m) return null
        const mk = /book|game/i.test(m[1] ?? '') ? (m[1] as string).toLowerCase() : 'movie'
        const mi = img(m[6])
        const mbg = `linear-gradient(160deg,${hsl(hue(m[0]), 26, 24)},${hsl((hue(m[0]) + 30) % 360, 30, 42)})`
        return `<div class="band hero hero-stay" style="background:${mbg}">${mi ? `<img src="${esc(mi)}" alt="" decoding="async">` : ''}<div class="hero-in" aria-hidden="true"><span class="hero-k">${esc(mp ? `Pick · ${mk}` : mk)}</span><span class="hero-n hero-title">${esc(m[0].slice(0, 60))}</span></div></div>`
    }
    const rows = first.lines.map(cells).filter((c) => c[0])
    const picked = rows.find((c) => leadPick && c[0].toLowerCase() === leadPick)
    const row = picked ?? rows[0]
    if (!row) return null
    const [name, price, , , , photo] = row
    const p = img(photo)
    const bg = `linear-gradient(160deg,${hsl(hue(name), 40, 30)},${hsl((hue(name) + 40) % 360, 45, 50)})`
    return `<div class="band hero hero-stay" style="background:${bg}">${p ? `<img src="${esc(p)}" alt="" decoding="async">` : ''}<div class="hero-in" aria-hidden="true"><span class="hero-k">${picked ? 'Pick' : 'Stay'}</span><span class="hero-n${knownValue(price) ? '' : ' hero-title'}">${esc(knownValue(price) || name)}</span></div></div>`
}

/** Days between now and a date, whole days, negative when past. Exported for tests (injectable now). */
export function countdownDays(dateISO: string, now: Date = new Date()): number | null {
    // Local-calendar days to the event: a date-only ISO like "2026-11-14" means
    // that local calendar date, not UTC midnight (UTC day boundaries shift the
    // count by one for viewers behind UTC). Math.round absorbs DST 23/25h days.
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO.trim())
    let target: Date
    if (dateOnly) {
        target = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    } else {
        const t = Date.parse(dateISO)
        if (!Number.isFinite(t)) return null
        target = new Date(t)
    }
    const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    return Math.round((dayStart(target) - dayStart(now)) / 86400000)
}

/** countdown: "Event | date | milestone; milestone". The big number can move to the page hero. */
function renderCountdown(lines: string[], opts?: { hero?: boolean }): string {
    const [event, dateISO, milestones] = cells(lines[0] ?? '')
    const days = countdownDays(dateISO ?? '')
    if (!event || days === null) return ''
    const n = Math.abs(days)
    const label = days === 0 ? 'today' : days > 0 ? (n === 1 ? 'day to go' : 'days to go') : (n === 1 ? 'day ago' : 'days ago')
    const ms = (milestones ?? '').split(';').map((m) => m.trim()).filter(Boolean).slice(0, 6)
    const head = opts?.hero === false ? '' : `<div class="cdn-n" data-cdn-date="${esc(dateISO ?? '')}">${days === 0 ? '0' : n}</div><div class="cdn-l" data-cdn-label>${esc(label)}</div>`
    return `<div class="cdn">${head}<div class="cdn-e">${esc(event)}${dateISO ? `<span class="cdn-d">${esc(dateISO)}</span>` : ''}</div>${ms.length ? `<ul class="cdn-ms">${ms.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}</div>`
}

const money = (cents: number): string => '$' + (cents / 100).toFixed(2)

/** calc: deterministic math the user can check and adjust. "split | total | Sam x2, Ana, Ben",
 * "tip | bill | percent | people", "convert | amount | from | to | rate | rate date".
 * Inputs render editable with the authored values as defaults; the page script recalculates
 * live (same rounding: last share takes the cent remainder). Unknown or malformed input
 * shows an honest note, never a wrong number. Server first paint mirrors the script exactly. */
function renderCalc(lines: string[]): string {
    // Width follows content (ch units, tabular-nums) so long totals stay visible on narrow phones.
    const inp = (f: string, v: string, wCh = 8) => `<input class="calc-in" style="width:${Math.max(wCh, v.length + 2)}ch;max-width:58vw" data-f="${f}" inputmode="decimal" value="${esc(v)}" aria-label="${f}">`
    const rowsHtml = (rows: [string, string][]) => rows.map(([n, a]) => `<div class="calc-r"><span class="calc-n">${esc(n)}</span><span class="calc-a">${esc(a)}</span></div>`).join('')
    const out: string[] = []
    for (const line of lines.slice(0, 8)) {
        const c = cells(line)
        const op = (c[0] ?? '').toLowerCase()
        if (op === 'split') {
            const total = num(c[1]), shares = (c[2] ?? '').split(',').map((p) => p.trim()).filter(Boolean).join(', ')
            if (total === null || total < 0 || !shares) return ''
            const init = calcInitialRows('split', { total: total.toFixed(2), shares }, {})
            out.push(`<div class="calc" data-calc="split"><div class="calc-t"><span>Split $${inp('total', total.toFixed(2))}</span><span data-o="count">${shares.split(',').length} people</span></div><div class="calc-ed"><label class="calc-lb">Shares <input class="calc-in calc-in-text" data-f="shares" value="${esc(shares)}" aria-label="shares, comma separated, optional xN weight"></label></div><div data-o="rows">${init ? rowsHtml(init.rows) : ''}</div><div class="calc-note" data-o="note">${esc(init?.note ?? '')}</div><button type="button" class="calc-reset" data-a="reset">Reset</button></div>`)
        } else if (op === 'tip') {
            const bill = num(c[1]), pct = num(c[2])
            if (bill === null || bill < 0 || pct === null || pct < 0) return ''
            const ppl = Math.max(1, Math.round(num(c[3]) ?? 1))
            const init = calcInitialRows('tip', { bill: bill.toFixed(2), pct: String(pct), people: String(ppl) }, {})
            out.push(`<div class="calc" data-calc="tip"><div class="calc-t"><span>Bill $${inp('bill', bill.toFixed(2))} + ${inp('pct', String(pct), 4)}% tip</span><span data-o="total">${esc(init?.total ?? '')}</span></div><div data-o="rows">${init ? rowsHtml(init.rows) : ''}</div><div class="calc-ed"><label class="calc-lb">People ${inp('people', String(ppl), 4)}</label></div><div class="calc-note" data-o="note">${esc(init?.note ?? '')}</div><button type="button" class="calc-reset" data-a="reset">Reset</button></div>`)
        } else if (op === 'convert') {
            const amt = num(c[1]), from = c[2], to = c[3], rate = num(c[4]), asof = c[5]
            if (amt === null || !from || !to) return ''
            const data = { from, to, asof: asof ?? '' }
            const init = calcInitialRows('convert', { amt: String(amt), rate: rate !== null && rate > 0 ? String(rate) : '' }, data)
            out.push(`<div class="calc" data-calc="convert" data-from="${esc(from)}" data-to="${esc(to)}" data-asof="${esc(asof ?? '')}"><div class="calc-t"><span>${inp('amt', String(amt))} ${esc(from)}</span><span data-o="total">${esc(init?.total ?? '')}</span></div><div class="calc-ed"><label class="calc-lb">Rate ${inp('rate', rate !== null && rate > 0 ? String(rate) : '', 7)} ${esc(to)} per ${esc(from)}</label></div><div class="calc-note" data-o="note">${esc(init?.note ?? '')}</div><button type="button" class="calc-reset" data-a="reset">Reset</button></div>`)
        } else return ''
    }
    return out.join('')
}

/** Server-side first paint/** Server-side first paint for calc cards: same math as the page script, so the no-JS view is complete. */
export function calcInitialRows(op: string, fields: Record<string, string>, data: Record<string, string>): { rows: [string, string][]; note: string; total?: string } | null {
    const g = (k: string) => fields[k] ?? ''
    if (op === 'split') {
        const totalC = Math.round((num(g('total')) ?? NaN) * 100)
        const shares = g('shares').split(',').map((p) => p.trim()).filter(Boolean).map((p) => {
            const m = p.match(/^(.+?)(?:\s+x(\d+(?:\.\d+)?))?$/)
            return { name: (m?.[1] ?? p).trim(), w: m?.[2] ? parseFloat(m[2]) : 1 }
        }).filter((p) => p.name && Number.isFinite(p.w) && p.w > 0)
        if (!Number.isFinite(totalC) || totalC < 0 || !shares.length) return null
        const wsum = shares.reduce((a, p) => a + p.w, 0)
        let assigned = 0
        const rows = shares.map((p, i): [string, string] => {
            const amt = i < shares.length - 1 ? Math.round((totalC * p.w) / wsum) : totalC - assigned
            assigned += amt
            return [p.name + (p.w !== 1 ? ` x${p.w}` : ''), money(amt)]
        })
        return { rows, note: (shares.some((p) => p.w !== 1) ? 'Weights applied. ' : '') + 'Cents are rounded; the last share takes the remainder.' }
    }
    if (op === 'tip') {
        const bill = num(g('bill')), pct = num(g('pct'))
        if (bill === null || bill < 0 || pct === null || pct < 0) return null
        const ppl = Math.max(1, Math.round(num(g('people')) ?? 1))
        const billC = Math.round(bill * 100), tipC = Math.round(billC * (pct / 100)), totalC = billC + tipC
        const rows: [string, string][] = [['Tip', money(tipC)]]
        if (ppl > 1) rows.push([`Per person (${ppl})`, money(Math.round(totalC / ppl))])
        return { rows, note: 'Cents are rounded.', total: money(totalC) }
    }
    if (op === 'convert') {
        const amt = num(g('amt')), rate = num(g('rate'))
        if (amt === null) return null
        if (rate === null || rate <= 0) return { rows: [], note: `Needs a quoted ${data.from} → ${data.to} rate with its date. None was given, so nothing was converted.` }
        return { rows: [], note: `1 ${data.from} = ${rate} ${data.to}${data.asof ? ` · rate as of ${data.asof}` : ' · rate date not given'}`, total: `${(amt * rate).toFixed(2)} ${data.to}` }
    }
    return null
}

/** chart:/** chart: "labels | a, b, c" then one of "line | name | v1, v2, …", "bar | label | value",
 * "donut | label | value" per row. Values must be finite numbers; anything else is dropped. */
function renderChart(lines: string[]): string {
    const rows = lines.map(cells).filter((c) => c[0])
    if (!rows.length) return ''
    const labels = rows[0][0].toLowerCase() === 'labels' ? (rows.shift()?.[1] ?? '').split(',').map((l) => l.trim()) : []
    const kind = (rows[0]?.[0] ?? '').toLowerCase()
    const escA = (t: string) => esc(t).replace(/'/g, '&#39;')
    if (kind === 'line') {
        const [, name, series] = rows[0]
        const vals = (series ?? '').split(',').map((v) => num(v.trim())).filter((v): v is number => v !== null).slice(0, 24)
        if (!name || vals.length < 2) return ''
        const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1
        const W = 360, H = 180, P = 34
        const pts = vals.map((v, i) => [P + (i * (W - P * 1.6)) / (vals.length - 1), H - P - ((v - min) / span) * (H - P * 1.8)] as const)
        const line = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
        const area = `${P},${H - P} ${line} ${pts[pts.length - 1][0].toFixed(1)},${H - P}`
        const mid = (max + min) / 2
        const yOf = (v: number) => H - P - ((v - min) / span) * (H - P * 1.8)
        const grid = [max, mid, min].map((v) => `<line x1="${P}" y1="${yOf(v).toFixed(1)}" x2="${W - 8}" y2="${yOf(v).toFixed(1)}" class="cht-grid"/><text x="${P - 6}" y="${(yOf(v) + 3).toFixed(1)}" text-anchor="end" class="cht-v">${esc(String(Number.isInteger(v) ? v : Math.round(v * 10) / 10))}</text>`).join('')
        const ticks = labels.slice(0, vals.length).filter((_, i) => i % Math.ceil(vals.length / 6) === 0 || i === vals.length - 1)
        return `<div class="cht"><div class="cht-t">${esc(name)}</div><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Line chart: ${escA(name)}, ${vals.length} points, from ${min} to ${max}">${grid}<line x1="${P}" y1="${H - P}" x2="${W - 8}" y2="${H - P}" class="cht-ax"/><polygon points="${area}" class="cht-area"/><polyline points="${line}" class="cht-line"/>${pts.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" class="cht-dot"/>`).join('')}${ticks.map((t, i) => `<text x="${(P + (i * (W - P * 1.6)) / Math.max(1, ticks.length - 1)).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="cht-x">${esc(t)}</text>`).join('')}</svg></div>`
    }
    if (kind === 'bar' || kind === 'donut') {
        const items = rows.map((c) => ({ l: c[1], v: num(c[2]) })).filter((x): x is { l: string; v: number } => !!x.l && x.v !== null && x.v >= 0).slice(0, 12)
        if (!items.length) return ''
        const total = items.reduce((a, x) => a + x.v, 0)
        if (kind === 'bar') {
            const max = Math.max(...items.map((x) => x.v)) || 1
            return `<div class="cht">${items.map((x) => `<div class="cht-b"><span class="cht-bl">${esc(x.l)}</span><span class="cht-bt"><i style="width:${((x.v / max) * 100).toFixed(1)}%"></i></span><span class="cht-bv">${esc(String(x.v))}</span></div>`).join('')}</div>`
        }
        const palette = ['#F08A68', '#5B8DD9', '#E5C55B', '#6FBF8F', '#B07FD4', '#8A97A8']
        let acc = 0
        const segs = items.map((x, i) => {
            const frac = total ? x.v / total : 0
            const seg = `<circle r="15.9155" cx="21" cy="21" fill="transparent" stroke="${palette[i % palette.length]}" stroke-width="10" stroke-dasharray="${(frac * 100).toFixed(2)} ${(100 - frac * 100).toFixed(2)}" stroke-dashoffset="${(25 - acc * 100).toFixed(2)}"/>`
            acc += frac
            return seg
        })
        return `<div class="cht cht-d"><svg viewBox="0 0 42 42" role="img" aria-label="Donut chart with ${items.length} segments">${segs.join('')}</svg><div class="cht-lg">${items.map((x, i) => `<div><i style="background:${palette[i % palette.length]}"></i>${esc(x.l)} · ${esc(String(x.v))}${total ? ` (${Math.round((x.v / total) * 100)}%)` : ''}</div>`).join('')}</div></div>`
    }
    return ''
}

export function renderKind(name: KindBlock, lines: string[], opts?: { hero?: boolean }): string {
    switch (name) {
        case 'weather': return renderWeather(lines, opts)
        case 'scores': return renderScores(lines)
        case 'media': return renderMedia(lines)
        case 'stay': return renderStay(lines)
        case 'route': return renderRoute(lines)
        case 'briefing': return renderBriefing(lines)
        case 'gallery': return renderGallery(lines)
        case 'lead': return renderLead(lines)
        case 'checks': return renderChecks(lines)
        case 'calc': return renderCalc(lines)
        case 'chart': return renderChart(lines)
        case 'countdown': return renderCountdown(lines, opts)
    }
}

/** Light styles use the page tokens (--paper, --sand, --ink, --accent); dark mode flips the tokens, so only fixed colours are overridden below. */
export const KINDS_CSS = `
.cdn{text-align:center;padding:22px 12px 14px}
.cdn-n{font-size:84px;font-weight:800;line-height:1;color:var(--accent);letter-spacing:-2px;font-variant-numeric:tabular-nums}
.cdn-l{font-size:13px;font-weight:600;letter-spacing:2.5px;text-transform:uppercase;color:var(--mute);margin-top:6px}
.cdn-e{font-size:17px;font-weight:600;margin-top:12px}
.cdn-d{display:block;font-size:13px;color:var(--mute);font-weight:400;margin-top:2px}
.cdn-ms{list-style:none;margin:14px auto 0;padding:0;max-width:320px;text-align:left}
.cdn-ms li{font-size:14px;padding:7px 2px;border-top:1px solid var(--line);color:var(--ink)}
.calc{border:1px solid var(--line);border-radius:14px;overflow:hidden;margin:6px 0}
.calc-t{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;background:var(--sand);padding:12px 16px;font-weight:700;font-size:15px}
.calc-t span:last-child{font-size:20px;color:var(--accent);font-variant-numeric:tabular-nums}
.calc-r{display:flex;justify-content:space-between;padding:10px 16px;border-top:1px solid var(--line);font-size:14.5px}
.calc-a{font-weight:600;font-variant-numeric:tabular-nums}
.calc-w{color:var(--mute);font-size:12px;font-weight:400}
.calc-note{padding:8px 16px;font-size:12px;color:var(--mute);border-top:1px solid var(--line)}
.calc-in{font:inherit;font-size:15px;font-weight:600;color:var(--ink);background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:2px 6px;text-align:right;font-variant-numeric:tabular-nums}
.calc-in:focus{outline:2px solid var(--accent);outline-offset:1px}
.calc-in-text{width:100%;text-align:left;font-weight:400;font-size:14px;margin-top:4px}
.calc-ed{padding:8px 16px;border-top:1px solid var(--line)}
.calc-lb{font-size:12px;color:var(--mute);display:block}
.calc-reset{display:block;margin:0 16px 12px;padding:4px 12px;font:inherit;font-size:12px;color:var(--accent);background:none;border:1px solid var(--line);border-radius:999px;cursor:pointer}
@media (prefers-reduced-motion:reduce){.calc-in{transition:none}}
.cht{padding:8px 4px}
.cht-t{font-weight:600;font-size:14px;margin:2px 0 8px}
.cht svg{width:100%;height:auto;display:block}
.cht-ax{stroke:var(--line);stroke-width:1}.cht-grid{stroke:var(--line);stroke-width:1;stroke-dasharray:2 5;opacity:.7}
.cht-area{fill:var(--accent);opacity:.12}
.cht-line{fill:none;stroke:var(--accent);stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round}
.cht-dot{fill:var(--accent)}
.cht-v,.cht-x{fill:var(--mute);font-size:10px}
.cht-b{display:flex;align-items:center;gap:10px;padding:5px 2px;font-size:13.5px}
.cht-bl{flex:0 0 34%;text-align:right;color:var(--mute);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cht-bt{flex:1;height:16px;background:var(--sand);border-radius:8px;overflow:hidden}
.cht-bt i{display:block;height:100%;background:var(--accent);border-radius:8px}
.cht-bv{flex:0 0 auto;font-weight:600;font-variant-numeric:tabular-nums}
.cht-d{display:flex;align-items:center;gap:18px}
.cht-d svg{flex:0 0 120px;width:120px}
.cht-lg{font-size:13px;display:grid;gap:5px}
.cht-lg i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px}
.wx,.scs,.mds,.sts,.rt,.brs,.gal{margin-block:var(--gap,24px)}
.wx{border-radius:var(--r,20px);overflow:hidden;border:1px solid var(--line);box-shadow:var(--shadow);background:var(--paper)}
.wx-hero{display:flex;justify-content:space-between;align-items:center;padding:26px 28px;color:#fff;background:linear-gradient(160deg,#3B5BA8,#7FA3DC)}
.wx-clear .wx-hero{background:linear-gradient(160deg,#2F6FC4,#F2B56B)}.wx-part .wx-hero{background:linear-gradient(160deg,#3F6AB5,#9DB8DF)}
.wx-cloud .wx-hero{background:linear-gradient(160deg,#5E6B85,#A3AEC2)}.wx-rain .wx-hero{background:linear-gradient(160deg,#34476B,#6D87AE)}
.wx-storm .wx-hero{background:linear-gradient(160deg,#241F3D,#5B4F86)}.wx-snow .wx-hero{background:linear-gradient(160deg,#6F89B3,#C9D8EC)}.wx-fog .wx-hero{background:linear-gradient(160deg,#69758A,#BCC5D2)}
.wx-place{font:500 11px/1 'DM Mono',monospace;letter-spacing:.16em;text-transform:uppercase;opacity:.9}
.wx-now{font:500 72px/1 Fraunces,Georgia,serif;letter-spacing:-.03em;margin:12px 0 6px}.wx-sky{font-size:18px}
.wx-glyph{line-height:0;filter:drop-shadow(0 6px 14px rgba(0,0,0,.25))}
.wx-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(78px,1fr));border-bottom:1px solid var(--line)}
.wx-facts div{padding:14px 18px;color:var(--ink);font-weight:600;border-right:1px solid var(--line)}.wx-facts div:last-child{border-right:0}
.wx-facts span{display:block;font:500 10px/1.6 'DM Mono',monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--mute);font-weight:400}
.wx-dg{line-height:0;filter:drop-shadow(0 1px 2px rgba(14,26,51,.35))}
.wx-dg path[fill="#fff"]{fill:#A9B7D0}
.wx-day{display:grid;grid-template-columns:54px 30px 38px 1fr 38px 52px;gap:8px;align-items:center;padding:11px 18px;border-bottom:1px solid var(--line);color:var(--ink);font-size:15px}.wx-day:last-child{border-bottom:0}
.wx-dn{font:500 12px 'DM Mono',monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}.wx-dl{color:var(--mute);text-align:right}.wx-dh{font-weight:600}.wx-dr{font-size:13px;color:var(--mute);text-align:right}
.wx-bar{position:relative;height:6px;border-radius:6px;background:var(--sand)}.wx-bar i{position:absolute;top:0;bottom:0;border-radius:6px;background:linear-gradient(90deg,#6D9BD8,#F28F6B)}
.scs{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.sc{border:1px solid var(--line);border-radius:var(--r,20px);padding:14px 18px;background:var(--paper);box-shadow:var(--shadow)}
.sc-st{display:flex;align-items:center;gap:8px;font:500 10px/1 'DM Mono',monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--mute);margin-bottom:8px}
.sc-live .sc-st{color:var(--accent)}.sc-st i{width:8px;height:8px;border-radius:50%;background:var(--accent);animation:pulse 1.6s ease-in-out infinite}
.sc-row{display:flex;align-items:center;gap:12px;padding:6px 0;color:var(--body)}.sc-win{color:var(--ink);font-weight:600}
.sc-mark{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font:500 10px/1 'DM Mono',monospace;color:#fff;background:hsl(var(--h) 45% 38%)}
.sc-name{flex:1}.sc-n{font:500 26px/1 Fraunces,Georgia,serif;color:var(--ink)}.sc-d{margin-top:8px;padding-top:8px;border-top:1px solid var(--line);font-size:13px;color:var(--mute)}
@keyframes pulse{50%{opacity:.3}}
.mds{display:grid;gap:14px}
.md,.st{display:grid;grid-template-columns:112px 1fr;gap:16px;border:1px solid var(--line);border-radius:var(--r,20px);overflow:hidden;background:var(--paper);box-shadow:var(--shadow)}
.md-cover,.st-pic{position:relative;min-height:156px;background:var(--sand)}.md-cover img,.st-pic img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.md-blank,.st-blank{display:flex;flex-direction:column;justify-content:flex-end;padding:12px;color:#fff;background:linear-gradient(155deg,hsl(var(--h) 26% 28%),hsl(calc(var(--h) + 30) 30% 42%))}
.md-blank span{font:500 17px/1.15 Fraunces,Georgia,serif}.md-blank em{font:500 9px/1 'DM Mono',monospace;letter-spacing:.16em;text-transform:uppercase;margin-top:8px;opacity:.85;font-style:normal}
.md-b,.st-b{padding:14px 18px 14px 0}.md-top,.st-top{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
h4{margin:0;font:500 21px/1.2 Fraunces,Georgia,serif;letter-spacing:-.01em;color:var(--ink)}
.md-r,.st-p{font:500 14px 'DM Mono',monospace;color:var(--accent);white-space:nowrap}.md-m,.st-m{font-size:13px;color:var(--mute);margin:4px 0}
.md-b p,.st-c{margin:8px 0;font-size:15px;color:var(--body)}.st-c span{display:inline-block;margin-right:8px;font:500 10px/1 'DM Mono',monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}
.md-b a,.st-b a,.br a{font-size:13px}
.st{grid-template-columns:150px 1fr}.st-blank{display:none}.st:has(.st-blank){grid-template-columns:1fr;border-left:4px solid var(--accent)}.st:has(.st-blank) .st-b{padding:14px 18px}
.sts{display:grid;gap:14px}
.rt{position:relative;padding-left:22px;border-left:2px solid var(--line);margin-left:7px}
.rt-stop{position:relative;padding:4px 0}.rt-dot{position:absolute;left:-30px;top:10px;width:14px;height:14px;border-radius:50%;background:var(--paper);border:3px solid var(--accent)}
.rt-name{font:600 17px/1.3 Schibsted,sans-serif;color:var(--ink)}
.rt-leg{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;margin:2px 0 14px;font-size:14px;color:var(--mute)}.rt-mode{padding:3px 10px;border-radius:999px;background:var(--sand);color:var(--ink);font:500 11px 'DM Mono',monospace;letter-spacing:.08em;text-transform:uppercase}.rt-time{color:var(--ink);font-weight:600}.rt-dir{color:var(--accent);font-weight:600;text-decoration:none}.rt-dir:hover{text-decoration:underline;text-underline-offset:3px}
.brs{display:grid;gap:0}.br{display:grid;grid-template-columns:44px 1fr;gap:12px;padding:16px 0;border-bottom:1px solid var(--line)}.br:last-child{border-bottom:0}
.br-n{font:500 13px/1.9 'DM Mono',monospace;color:var(--accent)}.br h4{font-size:20px}.br h4 a{color:var(--ink);text-decoration:none;font-size:inherit}.br h4 a:hover{text-decoration:underline;text-underline-offset:4px}
.br p{margin:6px 0;font-size:15px}.br-m{font:500 11px/1.5 'DM Mono',monospace;letter-spacing:.06em;color:var(--mute);text-transform:uppercase}
.gal{display:grid;gap:10px}.gal-1{grid-template-columns:1fr}.gal-2{grid-template-columns:1fr 1fr}.gal-3{grid-template-columns:2fr 1fr 1fr}
.gal figure{margin:0;position:relative;border-radius:var(--r,20px);overflow:hidden;background:var(--sand);min-height:160px}.gal img{display:block;width:100%;height:100%;min-height:200px;max-height:360px;object-fit:cover}
.gal figcaption{position:absolute;left:0;right:0;bottom:0;padding:26px 14px 10px;color:#fff;font-size:13px;background:linear-gradient(transparent,rgba(8,15,30,.78))}.gal small{display:block;opacity:.75;font-size:10px;margin-top:2px}
@media (max-width:600px){.wx-now{font-size:60px}.wx-hero{padding:22px}.wx-day{grid-template-columns:44px 26px 32px 1fr 32px 0}.wx-dr{display:none}.md{grid-template-columns:92px 1fr}.st{grid-template-columns:1fr}.st-pic{min-height:170px}.st-b{padding:0 16px 14px}.gal-2,.gal-3{grid-template-columns:1fr}}
@media (prefers-color-scheme:dark){.wx-dg path[fill="#fff"]{fill:#fff}.sc,.wx,.md,.st{box-shadow:var(--shadow)}.wx-hero,.md-blank,.st-blank{filter:brightness(.92)}}
.ld,.ck{margin:20px 0}
.ld{border:1px solid var(--line);border-radius:var(--r,20px);padding:24px 26px;background:var(--paper);box-shadow:var(--shadow)}
.ld-top{display:flex;flex-wrap:wrap;gap:8px 14px;font:500 12px/1 'DM Mono',monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--mute)}.ld-focus{color:var(--accent)}
.ld-pick{margin:14px 0 6px;font:500 32px/1.12 Fraunces,Georgia,serif;letter-spacing:-.015em;color:var(--ink)}
.ld-why{margin:0 0 12px;font-size:17px;line-height:1.5;color:var(--body)}
.ld-beat{margin:0 0 14px;font-size:14px;color:var(--mute)}.ld-beat span{font:500 11px/1 'DM Mono',monospace;letter-spacing:.12em;text-transform:uppercase;margin-right:6px}
.ld-care{display:flex;flex-wrap:wrap;gap:8px}.ld-care span{padding:5px 12px;border-radius:999px;background:var(--sand);color:var(--ink);font-size:13px}
.ck{list-style:none;margin:0;padding:0;border:1px solid var(--line);border-radius:var(--r,20px);overflow:hidden;background:var(--paper)}
.ck li{display:flex;gap:14px;align-items:flex-start;padding:12px 18px;border-bottom:1px solid var(--line);color:var(--ink);font-size:15px}.ck li:last-child{border-bottom:0}
.ck-tag{flex:none;padding:3px 10px;border-radius:999px;font:500 11px/1.5 'DM Mono',monospace;letter-spacing:.08em;text-transform:uppercase;background:var(--sand);color:var(--mute)}
.ck-ok .ck-tag{background:#DDF1E4;color:#14532D}.ck-no .ck-tag{background:#FBE9D0;color:#7A3E00}
.ck small{display:block;margin-top:2px;color:var(--mute);font-size:12px}
@media (prefers-color-scheme:dark){.ck-ok .ck-tag{background:#17402A;color:#BFEBCF}.ck-no .ck-tag{background:#4A3210;color:#F5D7A1}}
/* page hero: reuses .band sizing; the card overlaps its bottom 72px, so text sits above that */
.hero{color:#fff}.hero:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(8,15,30,.15),rgba(8,15,30,0) 40%,rgba(8,15,30,.45));pointer-events:none}
.hero>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.hero>svg{position:absolute;inset:0;width:100%;height:100%}.hero-in{text-shadow:0 2px 18px rgba(8,15,30,.45)}
.hero-in{position:absolute;z-index:2;left:max(24px,calc(50% - 360px + 24px));right:24px;bottom:96px;display:flex;flex-direction:column;gap:6px}
.hero-k{font:500 12px/1 'DM Mono',monospace;letter-spacing:.16em;text-transform:uppercase;opacity:.85;overflow-wrap:anywhere}
.hero-n{font:500 76px/.95 Fraunces,Georgia,serif;letter-spacing:-.03em;overflow-wrap:anywhere}.hero-s{font-size:17px;opacity:.9}
.hero-mid{align-items:center;text-align:center;left:24px;bottom:100px}.hero-vs{display:flex;gap:26px;align-items:center;font:500 84px/1 Fraunces,Georgia,serif}.hero-vs i{font:500 14px 'DM Mono',monospace;letter-spacing:.2em;opacity:.7;text-transform:uppercase}.hero-vs b:last-child{opacity:.75}
.hero .hero-ico svg{position:static;width:150px;height:150px}.hero-ico{position:absolute;z-index:2;right:max(24px,calc(50% - 360px + 24px));bottom:100px}
.hero-title{font-size:32px;line-height:1.08}
@media (max-width:600px){.band.hero{height:300px}.hero-in,.hero-ico{bottom:92px}.hero-n{font-size:60px}.hero-title{font-size:28px}.hero-vs{font-size:64px}.hero .hero-ico svg{width:100px;height:100px}}
@media (prefers-reduced-motion:no-preference){.ld{animation:glow 1.4s ease-out .5s 1 both}@keyframes glow{0%{box-shadow:var(--shadow)}35%{box-shadow:0 0 0 4px rgba(200,88,58,.28),var(--shadow)}100%{box-shadow:var(--shadow)}}}
@media print{.hero{display:none}.ld,.ck{box-shadow:none;break-inside:avoid}.wx,.sc,.md,.st{box-shadow:none;break-inside:avoid}}
`
