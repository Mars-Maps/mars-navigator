import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PlannedRoute } from '../../src/features/mission-ui/SearchBar'
import { EMPTY_ROUTE } from '../../src/state'

describe('the search bar while navigating', () => {
  const draft = {
    ...EMPTY_ROUTE,
    departure: { latitude: -4.6, longitudeEast: 137.4 },
    stops: [{ latitude: -4.8, longitudeEast: 137.7 }],
    destination: { latitude: -5, longitudeEast: 138 },
  }
  const html = renderToStaticMarkup(<PlannedRoute draft={draft} />)

  it('names the route being followed, with its stops', () => {
    expect(html).toContain('4.6°S 137.4°E → 5.0°S 138.0°E · 1 stop')
  })

  it('is read-only: no fields, buttons or toggle', () => {
    expect(html).not.toMatch(/<input|<button|aria-expanded/)
  })

  it('says how to change the route, to assistive tech as well', () => {
    expect(html).toContain('End navigation to change the route')
    expect(html).toMatch(/class="sr-only">End navigation to change the route</)
  })
})
