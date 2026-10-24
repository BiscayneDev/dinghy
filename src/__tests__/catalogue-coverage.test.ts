import { describe, expect, it } from 'vitest'
import { UI_CATALOGUE, decodeUiDecision, catalogueOutputError } from '@/lib/pages/catalogue'
import { renderHtml } from '@/lib/files/render'
import { renderKind } from '@/lib/files/kinds'

const answer = (choice: string) => ({ provider: 'jev', model: 'm', answers: { ui: { type: 'choice', choice, confidence: 0.9, probabilities: { [choice]: 0.9 } } } })
const pages = (type: string) => ':::pages\n' + JSON.stringify({ version: 1, components: [{ id: 'c1', type, title: 'Fictional', rows: [{ id: 'a', label: 'Fictional A', detail: 'Fictional', ...(type === 'map' ? { lat: 38.4, lon: -122.7 } : {}) }] }] }) + '\n:::'

const MATCH: Record<string, string> = {
    weather: ':::weather\nFictional Harbor | 61 | Clear\n:::',
    scores: ':::scores\nFictional FC | 2 | Example United | 1 | Final\n:::',
    media: ':::media\nFictional Film | movie | 2024 | 8.1\n:::',
    stay: ':::stay\nFictional Inn | $180 | 4.6 | Old Town | Small rooms\n:::',
    route: ':::route\nFictional Harbor | Example Bay | Ferry | 25 min\n:::',
    briefing: ':::briefing\nFictional vote | Fictional Gazette | today | Fictional summary\n:::',
    places: ':::places\nFictional Cafe | 4.5 | cafe | cozy | 12 Main St\n:::',
    options: ':::options\nFictional Inn | $180 | fictional why | fictional catch\n:::',
    facts: ':::facts\nfictional key: fictional value\n:::',
    gallery: ':::gallery\nimg/fictional.jpg | fictional caption\n:::',
    comparison: pages('comparison'),
    filter: pages('filter'),
    checklist: pages('checklist'),
    map: pages('map'),
}

describe('catalogue coverage', () => {
    it.each(Object.keys(UI_CATALOGUE))('Jev can select %s and a matching output satisfies the validator', (id) => {
        expect(decodeUiDecision(answer(id))).toEqual({ route: 'catalogue', component: id })
        expect(catalogueOutputError({ route: 'catalogue', component: id as keyof typeof UI_CATALOGUE }, MATCH[id])).toBeNull()
    })
    it.each(Object.keys(UI_CATALOGUE))('%s selection rejects output without the component', (id) => {
        expect(catalogueOutputError({ route: 'catalogue', component: id as keyof typeof UI_CATALOGUE }, 'plain fictional prose with no components')).toBeTruthy()
    })
    it('validator aliases: facts family, route day plan, comparison table/options, checklist markdown', () => {
        for (const b of [':::cost\na | $1\n:::', ':::heads-up\nfictional\n:::', ':::checks\nsource | fictional | confirmed 2026-10-24\n:::'])
            expect(catalogueOutputError({ route: 'catalogue', component: 'facts' }, b)).toBeNull()
        expect(catalogueOutputError({ route: 'catalogue', component: 'route' }, '### Day 1\nfictional plan')).toBeNull()
        expect(catalogueOutputError({ route: 'catalogue', component: 'comparison' }, ':::options\nA | $1 | why | catch\n:::')).toBeNull()
        expect(catalogueOutputError({ route: 'catalogue', component: 'checklist' }, '- [x] fictional task')).toBeNull()
    })
})

describe('weather identity lives in the page hero once', () => {
    const wx = ':::weather\nPort Marlow | 61° | Clear | 64° | 52° | 9 mph | 70% | 57°\nSat | 64° | 52° | Showers | 70%\n:::'
    it('a hero-consumed weather block renders compact: facts and days, no repeated header', () => {
        const html = renderHtml({ title: 'Test', body: wx })
        expect(html).toContain('hero-n">61°')
        expect(html).not.toContain('<div class="wx-hero">')
        expect(html.match(/Port Marlow/g)).toHaveLength(1)
        expect(html).toContain('Feels like')
        expect(html.match(/class="wx-day"/g)).toHaveLength(1)
    })
    it('a second weather block keeps its own header', () => {
        const html = renderHtml({ title: 'Test', body: wx + '\n:::weather\nFictional Bay | 55° | Rain | 60° | 50°\n:::' })
        expect(html.match(/<div class="wx-hero">/g)).toHaveLength(1)
        expect(html).toContain('Fictional Bay')
    })
    it('renderKind without options keeps the full weather card (brand previews unchanged)', () => {
        expect(renderKind('weather', ['Port Marlow | 61° | Clear | 64° | 52°'])).toContain('<div class="wx-hero">')
    })
})

describe('gallery with vetted local images', () => {
    it('renders the figure, caption, credit and source/license links', () => {
        const html = renderKind('gallery', ['img/fictional-harbor.jpg | Fictional dusk | Fictional Photographer | CC BY | https://example.com/source | https://example.com/license'])
        expect(html).toContain('<img src="img/fictional-harbor.jpg"')
        expect(html).toContain('Fictional dusk')
        expect(html).toContain('Fictional Photographer')
        expect(html).toContain('href="https://example.com/source"')
        expect(html).toContain('href="https://example.com/license"')
    })
})

describe('interactive runtime theming', () => {
    it('follows the page theme in dark mode and keeps the static fallback', () => {
        const html = renderHtml({ title: 'Test', body: pages('filter') })
        expect(html).toContain('prefers-color-scheme:dark')
        expect(html).toContain('var(--line,#D9D2C5)')
        expect(html).toContain('Static view')
    })
})
