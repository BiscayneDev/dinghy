import { describe, expect, it } from 'vitest'
import { flattenBlocks, placeLinks, renderHtml, renderPdf, splitBlocks } from '@/lib/files/render'

const body = [
    '> Pick: Lodge on the lake',
    '',
    ':::facts',
    'When: Aug 12-16',
    'Where: Lake Champlain',
    ':::',
    '',
    ':::cost',
    'Room, 4 nights: $1,200',
    'Taxes and fees: $180',
    'Total: $1,380 (taxes included)',
    ':::',
    '',
    ':::heads-up',
    'Free cancellation ends Aug 5.',
    ':::',
    '',
    ':::place',
    'Name: Lakeside Lodge',
    'Address: 1 Lake Rd, Burlington VT',
    'Phone: (802) 555-0100',
    ':::',
    '',
    '### Sat Aug 12',
    '- 10:00 Check in',
    '',
    '## Pack',
    '- [ ] Sunscreen',
    '- [x] Charger',
].join('\n')

describe('page components', () => {
    const html = renderHtml({ title: 'Trip', body })
    it('draws facts, cost, heads-up, place, checklist and day header', () => {
        expect(html).toContain('class="facts"')
        expect(html).toContain('Lake Champlain')
        expect(html).toContain('ctotal')
        expect(html).toContain('class="heads"')
        expect(html).toContain('https://maps.apple.com/?q=1%20Lake%20Rd%2C%20Burlington%20VT')
        expect(html).toContain('href="tel:8025550100"')
        expect(html).toContain('class="checklist"')
        expect(html).toContain('type="checkbox"')
        expect(html).toContain('checked')
        expect(html).toContain('<h3 class="day">')
        expect(html).not.toContain(':::')
    })
    it('flags a cost block with no total', () => {
        expect(renderHtml({ title: 'x', body: ':::cost\nRoom: $100\n:::' })).toContain('No total given')
    })
    it('escapes HTML inside blocks', () => {
        const h = renderHtml({ title: 'x', body: ':::facts\nWhen: <script>alert(1)</script>\n:::' })
        expect(h).not.toContain('<script>alert')
    })
    it('leaves unknown or unclosed blocks as text', () => {
        expect(splitBlocks(':::weird\na\n:::').every((s) => s.kind === 'md')).toBe(true)
        expect(splitBlocks(':::facts\nWhen: x').every((s) => s.kind === 'md')).toBe(true)
    })
    it('rejects bad phone numbers and flattens for pdf', () => {
        expect(placeLinks('', 'call me').tel).toBeNull()
        const flat = flattenBlocks(body)
        expect(flat).not.toContain(':::')
        expect(flat).toContain('> Heads up: Free cancellation ends Aug 5.')
        expect(flat).toContain('- Total: $1,380 (taxes included)')
    })
    it('still renders a pdf', async () => {
        const pdf = await renderPdf({ title: 'Trip', body })
        expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
    })
})

it('a timed plan renders as a timeline with anchors, buffers and quiet honesty notes, while plain agendas keep rows', () => {
    const plan = renderHtml({ title: 'Itinerary for Harbor, FL', body: '## Day 1\n- 12:30pm (est): Harbor Museum — about 120 min (stated on the venue page; hours not verified)\n- 2:30pm (est): lunch at Harbor Cafe — about 60 min (estimate; provider-reported hours Mo-Sa 09:00-17:00)\n- 3:30pm (est): reserved buffer before 4pm wedding — travel and get-ready time; travel time and the venue are not verified\n- 4pm: wedding' })
    expect(plan).toContain('class="tl"')
    expect(plan).toContain('class="tl-stop tl-anchor"')
    expect(plan).toContain('class="tl-stop tl-buffer"')
    expect(plan).toContain('<span class="tl-n">Harbor Museum</span>')
    expect(plan).toContain('about 120 min · stated on the venue page · hours not verified')
    expect(plan).toContain('travel time and the venue are not verified')
    expect(plan).not.toContain('class="rows"')
    expect(plan).not.toContain('(est):')
    // A plain agenda without estimated stops is untouched.
    const agenda = renderHtml({ title: 'Trip', body: '## Friday\n- 10:00 Office visit.\n- 2:00 Flight home.' })
    expect(agenda).toContain('class="rows"')
    expect(agenda).not.toContain('class="tl"')
})
