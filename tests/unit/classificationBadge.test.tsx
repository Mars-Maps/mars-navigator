import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ClassificationBadge } from '../../src/components/ClassificationBadge'
import { ClassifiedValue } from '../../src/features/mission-ui/ClassifiedValue'

// Static markup is what a screen reader and the existing panel tests see:
// the mark, the class name and the detail. The tooltip itself mounts only
// on hover or focus, in the browser (checked in headless Chrome).

describe('ClassificationBadge', () => {
  it('always carries the class name as text, never colour alone', () => {
    const html = renderToStaticMarkup(<ClassificationBadge classification="SIMULATED" />)
    expect(html).toContain('>SIMULATED<')
    expect(html).toContain('text-simulated')
    // The mark is drawn in CSS: panels take an <svg> to mean a chart was drawn.
    expect(html).not.toContain('<svg')
    expect(html).toContain('>i</span>')
  })

  it('carries the detail as text, in its own element, so a reason can be found whole', () => {
    const html = renderToStaticMarkup(
      <ClassificationBadge classification="UNAVAILABLE" detail="fixture reason" />,
    )
    expect(html).toContain('>UNAVAILABLE<')
    expect(html).toContain('>fixture reason<')
  })

  it('is a keyboard stop, so the class is reachable by focus, not only by hover', () => {
    const html = renderToStaticMarkup(<ClassificationBadge classification="DERIVED" />)
    expect(html).toContain('tabindex="0"')
  })

  it('renders no tooltip until hovered or focused', () => {
    const html = renderToStaticMarkup(
      <ClassificationBadge classification="DERIVED" detail="fixture method" />,
    )
    expect(html).not.toContain('role="tooltip"')
  })

  it('a passive mark has no tab stop, for a label the pointer can never reach', () => {
    const html = renderToStaticMarkup(<ClassificationBadge classification="DERIVED" passive />)
    expect(html).not.toContain('tabindex')
    expect(html).toContain('>DERIVED<')
  })

  it('names each class exactly once, so a count of badges is a count of the word', () => {
    for (const c of ['OFFICIAL', 'DERIVED', 'SIMULATED', 'UNAVAILABLE'] as const) {
      const html = renderToStaticMarkup(<ClassificationBadge classification={c} detail="x" />)
      expect(html.match(new RegExp(c, 'g'))).toHaveLength(1)
    }
  })
})

describe('ClassifiedValue', () => {
  it('shows the value and puts the provenance in the mark', () => {
    const html = renderToStaticMarkup(
      <ClassifiedValue
        value={{ classification: 'OFFICIAL', value: 3389.5, source: 'fixture-source-url' }}
        format={(v) => `${v} km`}
      />,
    )
    expect(html).toContain('3389.5 km')
    expect(html).toContain('>OFFICIAL<')
    expect(html).toContain('>fixture-source-url<')
  })

  it('shows a DERIVED value with its method', () => {
    const html = renderToStaticMarkup(
      <ClassifiedValue value={{ classification: 'DERIVED', value: 1, method: 'fixture method' }} />,
    )
    expect(html).toContain('>1<')
    expect(html).toContain('>fixture method<')
  })

  it('reads "unavailable" as visible text with the reason in the mark, never 0 or blank', () => {
    const html = renderToStaticMarkup(
      <ClassifiedValue value={{ classification: 'UNAVAILABLE', reason: 'fixture reason' }} />,
    )
    expect(html).toContain('>unavailable<')
    expect(html).toContain('>UNAVAILABLE<')
    expect(html).toContain('>fixture reason<')
    expect(html).not.toContain('>0<')
  })
})
