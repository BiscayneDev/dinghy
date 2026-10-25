import { it, expect, describe } from 'vitest'
import { renderKind, countdownDays, pageHero, calcInitialRows } from '@/lib/files/kinds'
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

describe('countdown renderer', () => {
    const now = new Date(Date.UTC(2026, 9, 24, 12)) // Oct 24 2026, fictional anchor
    it('counts whole days with an injectable now', () => {
        expect(countdownDays('2026-11-03', now)).toBe(10)
        expect(countdownDays('2026-10-24', now)).toBe(0)
        expect(countdownDays('2026-10-20', now)).toBe(-4)
        expect(countdownDays('not-a-date', now)).toBeNull()
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
