import { describe, expect, it } from 'vitest'
import { flattenBlocks, renderHtml, splitBlocks } from '@/lib/files/render'

const page = (body: string) => renderHtml({ title: 'Test page', body })

describe('page kinds', () => {
    it('weather: hero, facts and a forecast row per day, with a sky class', () => {
        const html = page(':::weather\nPort Marlow | 61° | Light rain | 64° | 52° | 9 mph NW | 70% | 57°\nSat | 64° | 52° | Showers | 70%\nSun | 66° | 50° | Sunny | 5%\n:::')
        expect(html).toContain('wx wx-rain')
        expect(html).toContain('Port Marlow')
        expect(html.match(/class="wx-day"/g)).toHaveLength(2)
        expect(html).toContain('Feels like')
        expect(html).toContain('<svg viewBox="0 0 64 64"')
    })

    it('weather: unknown sky text falls back, a missing place renders nothing', () => {
        expect(page(':::weather\nTown | 50° | Strange | 55° | 45°\n:::')).toContain('wx wx-part')
        expect(page(':::weather\n | 50°\n:::')).not.toContain('class="wx')
    })

    it('scores: winner is marked, live games pulse, upcoming games show no score', () => {
        const html = page(':::scores\nGulls | 3 | Otters | 1 | Final | Late goal\nHawks | 10 | Owls | 7 | Q3 4:00\nFoxes | | Bears | | Sat 7:00 PM\n:::')
        expect(html).toContain('sc-row sc-win')
        expect(html).toContain('sc sc-live')
        expect(html.match(/class="sc-n"><\/span>/g)).toHaveLength(2)
    })

    it('media: covers only render from a local img/ path; a remote URL becomes a colour card', () => {
        const html = page(':::media\nThe Salt Road | book | 2019 | 4.4 | A. Writer | Slow and warm. | img/salt-road.jpg | https://example.test/b\nNight Ferry | movie | 2021 | 7.8 | J. Director | Tight and tense. | https://cdn.example.test/p.jpg\n:::')
        expect(html).toContain('<img src="img/salt-road.jpg"')
        expect(html).not.toContain('cdn.example.test')
        expect(html).toContain('md-blank')
        expect(html).toContain('example.test</a>')
    })

    it('stay and route render; the route repeats no stop and keeps each leg', () => {
        const html = page(':::stay\nHarbor Inn | $120/night | 8.8 | Old town | Thin walls | | https://example.test/inn\n:::\n\n:::route\nHome | Airport | Drive | 25 min | Toll road\nAirport | Harbor Inn | Taxi | 15 min | Flat fare\n:::')
        expect(html).toContain('class="st"')
        expect(html).not.toContain('<img')
        expect(html.match(/class="rt-stop"/g)).toHaveLength(3)
        expect(html.match(/class="rt-leg"/g)).toHaveLength(2)
    })

    it('briefing numbers items and links only plain http(s)', () => {
        const html = page(':::briefing\nPort budget passes | Daily Gull | 7:00 AM | A vote of 5 to 2. | https://news.example.test/a\nStorm watch | Harbor Radio | 6:00 AM | Clear by noon. | javascript:alert(1)\n:::')
        expect(html).toContain('>01<')
        expect(html).toContain('href="https://news.example.test/a"')
        expect(html).not.toContain('javascript:')
    })

    it('gallery: remote or odd paths never render an image', () => {
        const ok = page(':::gallery\nimg/dock.jpg | The dock | Someone | CC BY 4.0\n:::')
        expect(ok).toContain('<img src="img/dock.jpg"')
        expect(ok).toContain('CC BY 4.0')
        for (const bad of ['https://example.test/x.jpg', '../x.jpg', 'img/../x.jpg', 'img/x.svg', 'img/x.jpg"onerror="1']) {
            expect(page(`:::gallery\n${bad} | cap\n:::`)).not.toContain('<img')
        }
    })

    it('escapes everything and stays one block per fence', () => {
        const html = page(':::briefing\n<script>x</script> | <b>src</b> | now | <i>s</i> | https://news.example.test/a\n:::')
        expect(html).not.toContain('<script>x')
        expect(html).toContain('&lt;script&gt;')
        expect(splitBlocks(':::weather\nA | 1\n:::\n:::scores\nA | 1 | B | 2\n:::').filter((s) => s.kind === 'block')).toHaveLength(2)
    })

    it('flattens to plain lines for PDF and DOCX without local image paths', () => {
        const md = flattenBlocks(':::media\nThe Salt Road | book | 2019 | 4.4 | A. Writer | Slow. | img/salt-road.jpg\n:::')
        expect(md).toContain('The Salt Road - book')
        expect(md).not.toContain('img/')
        expect(md).not.toContain('|')
    })
})

describe('lead and checks blocks', () => {
    const md = ':::lead\nfor | Alex\nfocus | family\npick | Harbor Inn | Step-free, two rooms, $2,680\nbeat | Pine Lodge | farther from town\ncare | walker access | under $3,200\n:::\n\n:::checks\nStep-free route | confirmed | hotel policy page | Oct 10\nConnecting rooms | maybe | | \nPool <b>hours</b> | Confirmed | front desk |\n:::'
    it('renders the pick, focus, beaten option and care chips', () => {
        const h = page(md)
        expect(h).toContain('Made for Alex')
        expect(h).toContain('Built around family fit')
        expect(h).toContain('Harbor Inn')
        expect(h).toContain('Pine Lodge')
        expect(h).toContain('walker access')
    })
    it('shows only an exact "confirmed" as confirmed and escapes text', () => {
        const h = page(md)
        expect(h.match(/class="ck-ok"/g)?.length).toBe(1)
        expect(h).toContain('ck-no')
        expect(h).toContain('checked Oct 10')
        expect(h).not.toContain('<b>hours</b>')
    })
    it('drops a lead with no pick', () => {
        expect(page(':::lead\nfor | Alex\n:::')).not.toContain('class="ld"')
    })
})

 it('confirmation requires both source and date', () => {
    const h = page(':::checks\nA | confirmed | source | date\nB | confirmed | | date\nC | confirmed | source |\n:::')
    expect(h.match(/class="ck-ok"/g)).toHaveLength(1)
    expect(h.match(/class="ck-no"/g)).toHaveLength(2)
 })

describe('page hero', () => {
    const lead = ':::lead\nfor | Alex\npick | Harbor Inn | ok\n:::\n\n'
    it('stay: uses the picked row photo, and keeps the sunrise band without a kind block', () => {
        const h = page(lead + ':::stay\nPine Lodge | $2,150 | 4 | x | y | img/p-aaa.jpg\nHarbor Inn | $2,680 | 4.6 | x | y | img/p-bbb.jpg\n:::')
        expect(h).toContain('hero hero-stay')
        expect(h).toContain('src="img/p-bbb.jpg"')
        expect(h).toContain('$2,680')
        expect(h).not.toContain('Photo credit at the bottom')
        expect(page('Just text.')).not.toContain('class="band hero')
        expect(page('Just text.')).toContain('class="band"')
    })
    it('stay without a photo gets a colour hero and no credit note', () => {
        const h = page(':::stay\nHarbor Inn | $2,680 | 4.6 | x | y |\n:::')
        expect(h).toContain('hero hero-stay')
        expect(h).not.toContain('Photo credit')
        expect(h).not.toContain('<img src="img/')
    })
    it('route shows the total time; scores show the score; weather shows the temp; all escaped', () => {
        expect(page(':::route\nA | B | walk | 9 min | x\nB | C | walk | 5 min | y\n:::')).toContain('14 min')
        expect(page(':::scores\nGulls | 3 | Otters | 1 | Final\n:::')).toMatch(/hero-vs"><b>3<\/b><i>vs<\/i><b>1<\/b>/)
        expect(page(':::weather\nPort Marlow | 61° | Light rain | 64° | 52° | 9 mph | 70%\n:::')).toContain('hero-n">61°')
        expect(page(':::weather\n<b>X</b> | 61° | Light rain | 64° | 52° | 9 mph | 70%\n:::')).not.toContain('<b>X</b>')
    })
    it('ambiguous route times fall back to a leg count, never a made-up total', () => {
        expect(page(':::route\nA | B | walk | about 9 | x\n:::')).toContain('1 leg')
    })
    it('the hero is hidden from screen readers when decorative and never uses a remote image', () => {
        const h = page(':::weather\nPort Marlow | 61° | Light rain | 64° | 52° | 9 mph | 70%\n:::')
        expect(h).toContain('class="band hero" aria-hidden="true"')
        expect(page(':::stay\nHarbor Inn | $1 | 4 | x | y | https://evil.test/a.jpg\n:::')).not.toContain('evil.test')
    })
})


 it('hero does not call an unselected first stay a pick or invent a credit notice', () => {
  const h = page(':::stay\nHarbor Inn | | 4.6 | x | y | img/local.jpg\n:::')
  expect(h).toContain('hero-k">Stay<');expect(h).toContain('hero-n hero-title">Harbor Inn<');expect(h).not.toContain('Photo credit at the bottom')
 })
