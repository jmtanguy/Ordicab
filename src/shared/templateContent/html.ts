import { buildTagToken, extractTagPath, normalizeTagPath } from './tagPaths'

export const RAW_TAG_PATTERN = /\{\{\s*([^}]+?)\s*\}\}/g
export const TAG_SPAN_PATTERN =
  /<span\b[^>]*data-template-tag-path=(["'])(.*?)\1[^>]*>[\s\S]*?<\/span>/gi

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeAttribute(value: string): string {
  return escapeHtml(value)
}

export function renderSmartTagSpan(path: string): string {
  const normalizedPath = normalizeTagPath(extractTagPath(path))
  const token = buildTagToken(normalizedPath)

  return `<span data-template-tag-path="${escapeAttribute(normalizedPath)}" contenteditable="false">${escapeHtml(token)}</span>`
}

export function isHtmlContent(content: string): boolean {
  const trimmed = content.trim()
  return /<\/?[a-z][\s\S]*>/i.test(trimmed) || trimmed.includes('data-template-tag-path=')
}

function paragraphsFromPlainText(content: string): string[] {
  return content
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

export function plainTextToHtml(content: string): string {
  const paragraphs = paragraphsFromPlainText(content)

  if (paragraphs.length === 0) {
    return '<p></p>'
  }

  return paragraphs
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br />')}</p>`)
    .join('')
}

export function ensureTemplateHtml(content: string): string {
  return isHtmlContent(content) ? content.trim() : plainTextToHtml(content)
}

export function replaceRawTagsWithSpans(content: string): string {
  return ensureTemplateHtml(content).replace(RAW_TAG_PATTERN, (_match, rawPath: string) =>
    renderSmartTagSpan(rawPath.trim())
  )
}

export function getTemplateEditorHtml(content: string): string {
  return replaceRawTagsWithSpans(content)
}
