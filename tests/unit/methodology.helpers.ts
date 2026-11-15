/**
 * For tests that render to markup: a closed Methodology button keeps its
 * explanation in a `hidden` span. These split a panel's markup into what is
 * on show without a click and what is behind the buttons.
 */
const OPEN = '<span hidden="" data-methodology-text="">'

/** The markup with every hidden methodology span cut out, and the spans' own markup. */
function split(html: string): { shown: string; hidden: string[] } {
  let shown = ''
  const hidden: string[] = []
  let at = 0
  for (;;) {
    const start = html.indexOf(OPEN, at)
    if (start === -1) break
    shown += html.slice(at, start)
    // The matching close: spans nest inside the explanation.
    let depth = 1
    let i = start + OPEN.length
    while (depth > 0) {
      const open = html.indexOf('<span', i)
      const close = html.indexOf('</span>', i)
      if (close === -1) throw new Error('Unclosed methodology span')
      if (open !== -1 && open < close) {
        depth++
        i = open + 5
      } else {
        depth--
        i = close + 7
      }
    }
    hidden.push(html.slice(start + OPEN.length, i - 7))
    at = i
  }
  return { shown: shown + html.slice(at), hidden }
}

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')

/** The markup on show without a click: no hidden methodology. */
export const shownMarkup = (html: string) => split(html).shown

/** The words on show without a click: no hidden methodology, no screen-reader-only marks. */
export const visibleText = (html: string) => text(split(html).shown.replace(/<span class="sr-only">.*?<\/span>/g, ''))

/** The words behind the Methodology buttons, all of them, in order. */
export const methodologyText = (html: string) => text(split(html).hidden.join(' '))
