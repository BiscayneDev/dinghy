const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', eacute: 'é', egrave: 'è', aacute: 'á', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', ccedil: 'ç', uuml: 'ü', ouml: 'ö', auml: 'ä', copy: '©', reg: '®', middot: '·' }
/** Decode named and numeric entities, repeatedly, so double-encoded text like &amp;amp; ends up as a single &. */
export function decodeEntities(input: string): string {
  let out = input
  for (let i = 0; i < 6; i++) {
    const next = out.replace(/&(?:#(\d{1,6})(?![\d;])|#(\d{1,6});|#[xX]([0-9a-fA-F]{1,5});|([a-zA-Z]{2,8});)/g, (m, dec0, dec, hex, name) => {
      if (dec0 || dec || hex) { const n = (dec0 || dec) ? parseInt((dec0 || dec) as string, 10) : parseInt(hex, 16); return n > 0 && n < 0x110000 && !(n >= 0xd800 && n < 0xe000) ? String.fromCodePoint(n) : m }
      return NAMED_ENTITIES[name] ?? NAMED_ENTITIES[name.toLowerCase()] ?? m
    })
    if (next === out) break
    out = next
  }
  return out
}
