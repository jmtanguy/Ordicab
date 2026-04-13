const DIACRITIC_VARIANTS: Record<string, string> = {
  a: 'aàáâãäåāăąǎǟǡ',
  c: 'cçćĉċč',
  d: 'dďđ',
  e: 'eèéêëēĕėęěȅȇ',
  g: 'gĝğġģ',
  h: 'hĥħ',
  i: 'iìíîïĩīĭįıǐȉȋ',
  j: 'jĵ',
  k: 'kķ',
  l: 'lĺļľł',
  n: 'nñńņňŉŋ',
  o: 'oòóôõöøōŏőǒȍȏ',
  r: 'rŕŗř',
  s: 'sśŝşš',
  t: 'tţťŧ',
  u: 'uùúûüũūŭůűųǔȕȗ',
  w: 'wŵ',
  y: 'yýÿŷ',
  z: 'zźżž'
}

function escapeForCharClass(value: string): string {
  return value.replace(/[\\\]-]/g, '\\$&')
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function normalizeMatchKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildDiacriticInsensitivePattern(value: string): string {
  return Array.from(value.normalize('NFC'))
    .map((char) => {
      const lower = char.toLocaleLowerCase()
      const base = normalizeMatchKey(char)
      const variants = DIACRITIC_VARIANTS[base]
      if (variants) {
        return `[${escapeForCharClass(variants)}]\\p{M}*`
      }
      if (base.length === 1 && base !== lower) {
        return `[${escapeForCharClass(`${base}${lower}`)}]\\p{M}*`
      }
      return escapeRegex(char)
    })
    .join('')
}
