import { buildTagToken } from './tagPaths'
import { ensureTemplateHtml, RAW_TAG_PATTERN, TAG_SPAN_PATTERN } from './html'

function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
}

export function getPlainTextPreviewFromTemplate(content: string): string {
  const withTokens = ensureTemplateHtml(content).replace(
    TAG_SPAN_PATTERN,
    (_match, _quote: string, rawPath: string) => buildTagToken(rawPath)
  )

  return decodeHtmlEntities(
    withTokens
      .replace(/<(br|\/p)\s*\/?>/gi, '\n')
      .replace(/<\/(div|h[1-6]|li|ul|ol|blockquote)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim()
  )
}

export function isBlankTemplateContent(content: string): boolean {
  return getPlainTextPreviewFromTemplate(content).trim().length === 0
}

export function extractSmartTagPaths(content: string): string[] {
  const paths = new Set<string>()
  const html = ensureTemplateHtml(content)

  for (const match of html.matchAll(TAG_SPAN_PATTERN)) {
    const rawPath = match[2]?.trim()
    if (rawPath) {
      paths.add(rawPath)
    }
  }

  for (const match of html.matchAll(RAW_TAG_PATTERN)) {
    const rawPath = match[1]?.trim()
    if (rawPath) {
      paths.add(rawPath)
    }
  }

  return [...paths]
}
