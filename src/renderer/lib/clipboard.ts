/**
 * Copy text with a legacy fallback for Electron renderer edge cases.
 *
 * On macOS, `navigator.clipboard.writeText` can reject when the window is not
 * focused or the renderer is not considered a secure clipboard context. The
 * temporary textarea path keeps routine copy actions usable in those cases.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall back to the document copy command below.
  }

  try {
    const activeElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const textarea = document.createElement('textarea')
    try {
      textarea.value = text
      textarea.setAttribute('readonly', 'true')
      textarea.style.position = 'fixed'
      textarea.style.left = '-9999px'
      textarea.style.top = '0'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.focus()
      textarea.select()

      return document.execCommand('copy')
    } finally {
      textarea.remove()
      activeElement?.focus()
    }
  } catch {
    return false
  }
}
