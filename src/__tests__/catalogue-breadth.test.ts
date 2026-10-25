import { it, expect, describe } from 'vitest'
import { renderKind, countdownDays, pageHero, calcInitialRows, toCents } from '@/lib/files/kinds'
import { renderHtml, flattenBlocks } from '@/lib/files/render'
import { UI_CATALOGUE, UI_REGISTRY, catalogueOutputError, type CatalogueId } from '@/lib/pages/catalogue'

// All fixtures are fictional: invented people, events and numbers. No real data.

describe('calc renderer', () => {
    it('splits a shared cost evenly, cents rounded with the last share taking the remainder', () => {
        const html = renderKind('calc', ['split | 100 | Sam, Ana, Ben'])
        expect(html).toContain('data-calc="split"')
        expect(html).toContain('value="100.00"')
        expect(html).toContain('3 people')
        expect(html).toContain('$33.34')
        expect(html.match(/\$33\.33/g)?.length).toBe(2)
        expect(html).toContain('last share takes the remainder')
        expect(html).toContain('data-a="reset"')
    })
    it('server first paint mirrors the script math (no-JS view complete)', () => {
        const init = calcInitialRows('split', { total: '90.00', shares: 'Sam x2, Ana' }, {})
        expect(init?.rows).toEqual([['Sam x2', '$60.00'], ['Ana', '$30.00']])
        expect(calcInitialRows('tip', { bill: '80.00', pct: '20', people: '2' }, {})?.total).toBe('$96.00')
        expect(calcInitialRows('convert', { amt: '100', rate: '' }, { from: 'USD', to: 'EUR', asof: '' })?.note).toContain('Needs a quoted')
        expect(calcInitialRows('split', { total: '-5', shares: 'Sam' }, {})).toBeNull()
    })
    it('applies share weights', () => {
        const html = renderKind('calc', ['split | 90 | Sam x2, Ana'])
        expect(html).toContain('Weights applied')
        expect(html).toContain('$60.00')
        expect(html).toContain('$30.00')
    })
    it('computes tip, total and per-person', () => {
        const html = renderKind('calc', ['tip | 80 | 20 | 2'])
        expect(html).toContain('$96.00')
        expect(html).toContain('Tip')
        expect(html).toContain('$16.00')
        expect(html).toContain('Per person (2)')
        expect(html).toContain('$48.00')
    })
    it('converts only with an explicit quoted rate and shows its date', () => {
        const html = renderKind('calc', ['convert | 100 | USD | EUR | 0.92 | 2026-10-20'])
        expect(html).toContain('92.00 EUR')
        expect(html).toContain('value="0.92"')
        expect(html).toContain('rate as of 2026-10-20')
    })
    it('never invents a rate: missing rate renders an honest note, not a number', () => {
        const html = renderKind('calc', ['convert | 100 | USD | EUR'])
        expect(html).toContain('Needs a quoted USD → EUR rate')
        expect(html).not.toContain('92')
    })
    it('renders nothing for malformed or unknown operations', () => {
        expect(renderKind('calc', ['split | | Sam'])).toBe('')
        expect(renderKind('calc', ['wat | 1 | 2'])).toBe('')
        expect(renderKind('calc', [])).toBe('')
    })
})

describe('chart renderer', () => {
    it('draws an accessible line chart from explicit values', () => {
        const html = renderKind('chart', ['labels | Jan, Feb, Mar', 'line | Steps | 10, 14, 12'])
        expect(html).toContain('<svg')
        expect(html).toContain('role="img"')
        expect(html).toContain('aria-label="Line chart: Steps, 3 points, from 10 to 14"')
        expect(html).toContain('<polyline')
    })
    it('draws bars with proportional widths', () => {
        const html = renderKind('chart', ['bar | Fiction | 8', 'bar | Essays | 4'])
        expect(html).toContain('width:100.0%')
        expect(html).toContain('width:50.0%')
    })
    it('draws a donut with legend percentages', () => {
        const html = renderKind('chart', ['donut | Fictional Rent | 60', 'donut | Fictional Food | 40'])
        expect(html).toContain('stroke-dasharray')
        expect(html).toContain('Fictional Rent · 60 (60%)')
    })
    it('drops non-numeric values and renders nothing when nothing is usable', () => {
        expect(renderKind('chart', ['line | Steps | a, b'])).toBe('')
        expect(renderKind('chart', [])).toBe('')
    })
})

describe('calc cents handling', () => {
    it('parses decimal text to integer cents with an explicit half-up rule, no float decisions', () => {
        // Decimal-string rule: third fraction digit >= 5 rounds the cent up. Engine-independent.
        expect(toCents('10.005')).toBe(1001) // float toFixed gives 1001 here by accident of representation
        expect(toCents('1.005')).toBe(101)   // float toFixed would give 100 - the case that proves the rule
        expect(toCents('2.675')).toBe(268)   // float toFixed would give 267
        expect(toCents('0.125')).toBe(13)
        expect(toCents('0.124')).toBe(12)
        expect(toCents('0.001')).toBe(0)
        expect(toCents('19.999')).toBe(2000)
        expect(toCents('0.01')).toBe(1)
        expect(toCents('0')).toBe(0)
        expect(toCents('-5')).toBe(-500)
        expect(toCents('-0.005')).toBe(-1)
        // bounds and junk
        expect(toCents('abc')).toBeNull()
        expect(toCents('')).toBeNull()
        expect(toCents('Infinity')).toBeNull()
        expect(toCents('9999999999999.99')).toBe(999999999999999)  // 13-digit dollars: safe
        expect(toCents('99999999999999.99')).toBeNull()            // 14 digits: could overflow 2^53, refused
        // carry boundary: the +1 rounds up through whole dollars and stays a safe integer
        expect(toCents('0.999')).toBe(100)
        expect(toCents('9999999999999.999')).toBe(1000000000000000)
        // leading zeros are not magnitude
        expect(toCents('00012.50')).toBe(1250)
        expect(toCents('007')).toBe(700)
    })
    it('view-time script c2 is exact parity with server toCents on the edge values', () => {
        const html = renderHtml({ title: 'Fictional', subtitle: '', body: ':::calc\nsplit | 100 | Sam, Ana\n:::\n' } as never)
        const m = html.match(/c2=v=>\{([^}]+)\}/)
        expect(m, 'emitted c2 function found').toBeTruthy()
        const c2 = new Function('v', m![1]) as (v: string) => number | null
        const edges = ['10.005', '1.005', '2.675', '0.125', '0.124', '0.001', '19.999', '0.01', '0', '-5', '-0.005', 'abc', '', 'Infinity', '9999999999999.99', '99999999999999.99', '9999999999999.999', '0.999', '00012.50', '007', '$1,234.56', ' 7.50 ']
        for (const e of edges) expect(c2(e), e).toEqual(toCents(e))
    })
    it('half-cent totals split deterministically and the shares sum to the normalized total', () => {
        const r = calcInitialRows('split', { total: '10.005', shares: 'Sam, Ana, Ben' }, {})
        expect(r?.rows).toEqual([['Sam', '$3.34'], ['Ana', '$3.34'], ['Ben', '$3.33']]) // sums $10.01, the normalized total
    })
    it('formats money with thousands grouping, weighted remainder included', () => {
        const r = calcInitialRows('split', { total: '1234567.89', shares: 'Sam x2, Ana, Ben' }, {})
        expect(r?.rows).toEqual([['Sam x2', '$617,283.95'], ['Ana', '$308,641.97'], ['Ben', '$308,641.97']])
        const tip = calcInitialRows('tip', { bill: '1234.56', pct: '20', people: '1' }, {})
        expect(tip?.total).toBe('$1,481.47')
        const conv = calcInitialRows('convert', { amt: '1000000', rate: '0.92' }, { from: 'USD', to: 'EUR', asof: '2026-10-20' })
        expect(conv?.total).toBe('920,000.00 EUR')
    })
})

describe('countdown renderer', () => {
    const now = new Date(Date.UTC(2026, 9, 24, 12)) // Oct 24 2026, fictional anchor
    it('counts whole days with an injectable now', () => {
        expect(countdownDays('2026-11-03', now)).toBe(10)
        expect(countdownDays('2026-10-24', now)).toBe(0)
        expect(countdownDays('2026-10-20', now)).toBe(-4)
        expect(countdownDays('not-a-date', now)).toBeNull()
    })
    it('date-only targets mean local calendar days, not UTC-midnight arithmetic', () => {
        // Bug class: a date-only ISO parsed as UTC midnight counted 20 days from
        // Oct 24 (America/New_York evening) to Nov 14; local-calendar diff is 21.
        const evening = new Date(2026, 9, 24, 21, 30) // local components, any zone
        expect(countdownDays('2026-11-14', evening)).toBe(21)
        const earlyMorning = new Date(2026, 9, 24, 1, 0)
        expect(countdownDays('2026-11-14', earlyMorning)).toBe(21)
        // Nov 1 from Oct 24 local is 8 calendar days; Nov 14 is 21 regardless of clock time
        expect(countdownDays('2026-11-01', new Date(2026, 9, 24, 23, 59))).toBe(8)
    })
    it('spans the US fall DST boundary without drift (25h day rounds, never off-by-one)', () => {
        // America/New_York falls back Nov 1 2026; local-day math must absorb the 25h day.
        const before = new Date(2026, 9, 31, 12, 0)
        expect(countdownDays('2026-11-02', before)).toBe(2)
        const after = new Date(2026, 10, 1, 12, 0)
        expect(countdownDays('2026-11-02', after)).toBe(1)
        // full span across the boundary: Oct 24 -> Nov 14 = 21 local days
        expect(countdownDays('2026-11-14', new Date(2026, 9, 24, 12, 0))).toBe(21)
    })
    it('today, past and future targets label correctly at local day granularity', () => {
        const evening = new Date(2026, 9, 24, 22, 0)
        expect(countdownDays('2026-10-24', evening)).toBe(0)
        expect(countdownDays('2026-10-25', evening)).toBe(1)
        expect(countdownDays('2026-10-23', evening)).toBe(-1)
        // timestamps with a time component still parse (absolute instant, local day of that instant)
        expect(countdownDays('2026-10-24T23:00:00', evening)).toBe(0)
    })
    it('renders the big number, label, event and milestones', () => {
        const html = renderKind('countdown', ['Harbor Festival | 2026-11-03 | Lineup drops Friday; Gates 5 PM'])
        expect(html).toContain('cdn-n')
        expect(html).toContain('cdn-l')
        expect(html).toContain('Harbor Festival')
        expect(html).toContain('Lineup drops Friday')
    })
    it('renders a compact card without the number when the hero consumed it', () => {
        const html = renderKind('countdown', ['Harbor Festival | 2026-11-03 | Lineup drops Friday'], { hero: false })
        expect(html).not.toContain('cdn-n')
        expect(html).toContain('Harbor Festival')
        expect(html).toContain('Lineup drops Friday')
    })
    it('renders nothing without an event or a parseable date', () => {
        expect(renderKind('countdown', ['| 2026-11-03'])).toBe('')
        expect(renderKind('countdown', ['Party | whenever'])).toBe('')
    })
    it('moves the number into the page hero and keeps the body card compact', () => {
        const doc = { title: 'Trip countdown', subtitle: '', body: ':::countdown\nHarbor Festival | 2026-11-03 | Lineup drops Friday\n:::\n' }
        const html = renderHtml(doc as never)
        expect(html).toContain('band hero')
        expect((html.match(/class="cdn-n"/g) ?? []).length).toBe(0) // no duplicate big number in the body (CSS rule aside)
        expect(html).toContain('Harbor Festival')
    })
    it('pageHero renders the countdown hero', () => {
        const hero = pageHero([{ name: 'countdown', lines: ['Harbor Festival | 2026-11-03'] }])
        expect(hero).toContain('Harbor Festival')
        expect(hero).toContain('hero-n')
    })
})

describe('catalogue registry', () => {
    it('UI_CATALOGUE is derived from UI_REGISTRY with identical keys and descriptions', () => {
        expect(Object.keys(UI_CATALOGUE).sort()).toEqual(Object.keys(UI_REGISTRY).sort())
        for (const [id, entry] of Object.entries(UI_REGISTRY)) {
            expect(UI_CATALOGUE[id as CatalogueId]).toBe(entry.description)
            expect(entry.description.length).toBeGreaterThan(20)
            expect(['none', 'research', 'calendar']).toContain(entry.data)
            expect(entry.renders.length).toBeGreaterThan(3)
        }
    })
    it('keeps the original fourteen ids (backwards compatibility)', () => {
        for (const id of ['weather', 'scores', 'media', 'stay', 'route', 'briefing', 'places', 'options', 'facts', 'gallery', 'comparison', 'filter', 'checklist', 'map']) {
            expect(UI_REGISTRY[id], id).toBeDefined()
        }
    })
    it('adds the seven new grounded capabilities', () => {
        for (const id of ['calc', 'chart', 'countdown', 'standings', 'events', 'agenda', 'recipe']) {
            expect(UI_REGISTRY[id], id).toBeDefined()
        }
        expect(Object.keys(UI_REGISTRY)).toHaveLength(21)
    })
})

describe('output validation for the new components', () => {
    const err = (component: CatalogueId, body: string) => catalogueOutputError({ route: 'catalogue', component }, body)
    it('calc requires a :::calc block', () => {
        expect(err('calc', ':::calc\nsplit | 100 | Sam, Ana, Ben\n:::')).toBeNull()
        expect(err('calc', 'The split is $33 each.')).toMatch(/calc/)
    })
    it('chart requires a :::chart block', () => {
        expect(err('chart', ':::chart\nbar | A | 1\n:::')).toBeNull()
        expect(err('chart', 'Sales went up.')).toMatch(/chart/)
    })
    it('countdown requires a :::countdown block', () => {
        expect(err('countdown', ':::countdown\nHarbor Festival | 2026-11-03\n:::')).toBeNull()
        expect(err('countdown', 'Ten days left.')).toMatch(/countdown/)
    })
    it('standings renders as a markdown table', () => {
        expect(err('standings', '| Team | W | L |\n|---|---|---|\n| Fictional Gulls | 9 | 4 |')).toBeNull()
        expect(err('standings', 'The Gulls lead.')).toMatch(/standings/)
    })
    it('events renders as a :::briefing block (composition)', () => {
        expect(err('events', ':::briefing\nHarbor Nights | Example Venue | Oct 30 | Doors 8 PM | https://example.com\n:::')).toBeNull()
        expect(err('events', 'There is a show Friday.')).toMatch(/events/)
    })
    it('agenda renders as a timed list', () => {
        expect(err('agenda', '- 9:00 AM Fictional standup\n- 12:30 PM Lunch')).toBeNull()
        expect(err('agenda', 'A busy day.')).toMatch(/agenda/)
    })
    it('recipe renders as numbered steps plus facts or a checklist (composition)', () => {
        const steps = '1. Mix flour and water.\n2. Bake 30 minutes.'
        expect(err('recipe', steps + '\n- [ ] 2 cups flour')).toBeNull()
        expect(err('recipe', steps + '\n:::facts\nYield: 4 servings\n:::')).toBeNull()
        expect(err('recipe', 'Bake something nice.')).toMatch(/recipe/)
        expect(err('recipe', steps)).toMatch(/recipe/)
    })
})

describe('view-time script', () => {
    it('emitted script keeps regex escapes (weights survive the template literal)', () => {
        const html = renderHtml({ title: 'Fictional', subtitle: '', body: ':::calc\nsplit | 186.40 | Sam x2, Ana, Ben\n:::\n' } as never)
        expect(html).toContain(String.raw`(?:\s+x(\d+`)
    })
    it('calc inputs size to their content so long totals stay visible', () => {
        const html = renderKind('calc', ['split | 1234567.89 | Sam, Ana, Ben'])
        expect(html).toContain('width:12ch')
        expect(html).toContain('max-width:58vw')
        const small = renderKind('calc', ['split | 9.99 | Sam, Ana'])
        expect(small).toContain('width:8ch')
    })
    it('emitted script keeps the countdown date-only regex escapes', () => {
        const html = renderHtml({ title: 'Fictional', subtitle: '', body: ':::countdown\nHarbor Festival | 2026-11-14\n:::\n' } as never)
        expect(html).toContain(String.raw`/^(\d{4})-(\d{2})-(\d{2})$/`)
    })
    it('is injected only when a countdown or calc block is present', () => {
        const withCalc = renderHtml({ title: 'Fictional', subtitle: '', body: ':::calc\nsplit | 100 | Sam, Ana\n:::\n' } as never)
        expect(withCalc).toContain('data-cdn-date')
        expect(withCalc).toContain('<script>')
        const plain = renderHtml({ title: 'Fictional', subtitle: '', body: 'Just notes.\n' } as never)
        expect(plain).not.toContain('<script>')
    })
    it('countdown number carries its date for deterministic view-time recompute', () => {
        const html = renderHtml({ title: 'Fictional', subtitle: '', body: ':::countdown\nHarbor Festival | 2026-11-03\n:::\n' } as never)
        expect(html).toContain('data-cdn-date="2026-11-03"')
    })
})

describe('existing blocks still flatten for PDF/DOCX', () => {
    it('flattenBlocks keeps new block contents as readable text', () => {
        const flat = flattenBlocks(':::calc\nsplit | 100 | Sam, Ana, Ben\n:::')
        expect(flat).toContain('split')
        expect(flat).toContain('Sam')
    })
})
