import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { QuickPlanButton, SearchBar } from '../../src/features/mission-ui/SearchBar'
import type { RouteRequest } from '../../src/domain'

describe('SearchBar scrolling', () => {
  // Collapsed on first render, but the body is in the markup, hidden.
  const html = renderToStaticMarkup(<SearchBar onPlan={() => {}} />)
  const classOf = (marker: string) => {
    const tag = html.slice(html.lastIndexOf('<', html.indexOf(marker)), html.indexOf('>', html.indexOf(marker)))
    return tag.match(/class="([^"]*)"/)![1].split(/\s+/)
  }

  it('lets the panel shrink inside its slot, a column with a fixed summary line', () => {
    const root = html.slice(0, html.indexOf('>')).match(/class="([^"]*)"/)![1].split(/\s+/)
    expect(root).toEqual(expect.arrayContaining(['flex', 'flex-col', 'min-h-0', 'max-h-full']))
    expect(classOf('aria-expanded=')).toContain('shrink-0')
  })

  it('has one aria-expanded, its toggle, which the slot reads to let it shrink', () => {
    expect(html.match(/aria-expanded=/g)).toHaveLength(1)
    expect(html.slice(html.lastIndexOf('<', html.indexOf('aria-expanded=')))).toMatch(/^<button/)
  })

  it('scrolls the whole body, capped at about one stop', () => {
    const body = classOf('hidden=""')
    expect(body).toEqual(expect.arrayContaining(['overflow-y-auto', 'min-h-0', 'max-h-[23rem]']))
  })
})

describe('Plan route on the closed search bar', () => {
  // Test fixture only: an invented route request.
  const REQUEST: RouteRequest = {
    departure: { latitude: 18.36, longitudeEast: 77.76 },
    stops: [],
    destination: { latitude: 18.07, longitudeEast: 77.56 },
  }
  const render = (request: RouteRequest | null, closeUp: boolean) =>
    renderToStaticMarkup(<QuickPlanButton request={request} closeUp={closeUp} onPlan={() => {}} />)

  it('shows a highlighted Plan route once the route is ready, in close-up', () => {
    const html = render(REQUEST, true)
    expect(html).toMatch(/^<button type="button"[^>]*>Plan route<\/button>$/)
    for (const c of ['bg-accent/15', 'text-accent', 'font-medium']) expect(html).toContain(c)
  })

  it('shows nothing without a ready route, or outside close-up, as the open bar does', () => {
    expect(render(null, true)).toBe('')
    expect(render(REQUEST, false)).toBe('')
  })

  it('sits beside the summary toggle, not inside it, so the bar keeps one aria-expanded and no nested button', () => {
    const html = renderToStaticMarkup(<SearchBar onPlan={() => {}} />)
    expect(html.match(/aria-expanded=/g)).toHaveLength(1)
    const toggle = html.slice(html.indexOf('<button'), html.indexOf('</button>'))
    expect(toggle.slice('<button'.length)).not.toContain('<button')
  })
})
