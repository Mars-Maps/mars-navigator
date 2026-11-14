/**
 * Puts text on the clipboard. Resolves false, never throws, when the
 * Clipboard API is missing (an insecure context) or the browser refuses,
 * so a caller can say "Copy failed" instead of pretending it worked.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) return false
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
