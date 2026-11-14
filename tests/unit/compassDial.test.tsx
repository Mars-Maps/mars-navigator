import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { derived, unavailable, type Classified } from '../../src/domain'
import { Compass, CompassDial } from '../../src/features/mission-ui/CompassDial'

// Test fixtures only — invented headings, never shown in the app.
const METHOD = 'fixture-method'

const render = (heading: Classified<number>) =>
  renderToStaticMarkup(<CompassDial heading={heading} />)

/** The markup outside the dial's <title> and the mark's hidden detail: what is on screen. */
const visibleText = (html: string) =>
  html
    .replace(/<title>.*?<\/title>/g, '')
    .replace(/<span class="sr-only">.*?<\/span>/g, '')
    .replace(/<[^>]+>/g, '')

describe('CompassDial', () => {
  it('rotates the needle to an available heading; the heading and method are its name and the mark', () => {
    const html = render(derived(25, METHOD))
    expect(html).toContain('data-needle')
    expect(html).toContain('rotate(25)')
    expect(html).toContain('<title>Compass. North is 25° right of up. fixture-method</title>')
    expect(html).toContain('DERIVED')
    expect(html).not.toContain('Heading unavailable')
  })

  it('shows no words on screen, only the dial\'s N and the classification mark\'s i', () => {
    expect(visibleText(render(derived(25, METHOD))).trim()).toBe('Ni')
    expect(visibleText(render(unavailable('fixture-reason'))).trim()).toBe('i')
  })

  it('wraps the heading before drawing it', () => {
    expect(render(derived(-90, METHOD))).toContain('rotate(270)')
  })

  it('draws no needle at all for an UNAVAILABLE heading, and names the reason', () => {
    const html = render(unavailable('fixture-reason'))
    expect(html).not.toContain('data-needle')
    expect(html).not.toContain('rotate(')
    expect(html).not.toContain('North is')
    expect(html).toContain('Heading unavailable: fixture-reason')
    expect(html).toContain('UNAVAILABLE')
  })

  it.each([NaN, Infinity])('treats a %s heading as unavailable, never drawn', (value) => {
    const html = render(derived(value, METHOD))
    expect(html).not.toContain('data-needle')
    expect(html).toContain('Heading unavailable')
    expect(html).not.toContain('DERIVED')
  })

  it('keeps the same dial in both states, so it keeps its shape', () => {
    const dial = (html: string) => html.match(/<svg[^>]*class="([^"]*)"/)?.[1]
    const available = render(derived(25, METHOD))
    const missing = render(unavailable('fixture-reason'))
    expect(dial(available)).toBeDefined()
    expect(dial(available)).toBe(dial(missing))
  })
})

describe('Compass, the slot content', () => {
  it('renders nothing while the compass button is off, so the slot stays empty', () => {
    // The store starts with every side panel closed.
    expect(renderToStaticMarkup(<Compass />)).toBe('')
  })
})

describe('CompassDial, turn north up', () => {
  const noop = () => {}

  it('is a button over the globe, named for what a click does and what the dial shows', () => {
    const html = renderToStaticMarkup(<CompassDial heading={derived(25, METHOD)} onTurnNorthUp={noop} />)
    expect(html).toContain('<button type="button"')
    expect(html).toContain('<title>Compass. Turn north up. North is 25° right of up. fixture-method</title>')
  })

  it('stays a picture with no heading, since there is no north to turn to', () => {
    const html = renderToStaticMarkup(<CompassDial heading={unavailable('fixture-reason')} onTurnNorthUp={noop} />)
    expect(html).not.toContain('<button')
    expect(html).not.toContain('Turn north up')
  })

  it('stays a picture without a click handler, as on the surface', () => {
    expect(render(derived(25, METHOD))).not.toContain('<button')
  })
})
