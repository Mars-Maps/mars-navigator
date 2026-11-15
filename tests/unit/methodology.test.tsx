import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { InfoMark } from '../../src/components/ClassificationBadge'
import { Methodology, MethodologyItem } from '../../src/components/Methodology'
import { derived, unavailable } from '../../src/domain'
import { SteepSlopeWarning } from '../../src/features/mission-ui/SteepSlopeWarning'
import { SLOPE_WARNING_TEXT } from '../../src/features/route-analysis/slopeHazard'
import { methodologyText, visibleText } from './methodology.helpers'

describe('Methodology', () => {
  const html = renderToStaticMarkup(
    <p>
      A figure
      <Methodology title="How the figure was obtained">
        <MethodologyItem heading="Source">Fixture source.</MethodologyItem>
        <MethodologyItem>Fixture caveat.</MethodologyItem>
      </Methodology>
    </p>,
  )

  it('shows only a small button until it is pressed', () => {
    expect(visibleText(html)).toBe('A figureMethodology')
    expect(html).toMatch(/<button[^>]*type="button"[^>]*aria-haspopup="dialog"[^>]*aria-expanded="false"/)
    // No card in the page while it is closed.
    expect(html).not.toContain('role="dialog"')
  })

  it('keeps the explanation in the markup, hidden, under its title', () => {
    expect(html).toContain('<span hidden="" data-methodology-text="">')
    expect(methodologyText(html)).toBe('How the figure was obtainedSourceFixture source.Fixture caveat.')
  })

  it('is phrasing content, so it can sit inside a paragraph', () => {
    const inside = html.slice('<p>'.length, -'</p>'.length)
    expect(inside).not.toMatch(/<(div|p|ul|ol|li|section)\b/)
  })

  it('takes another word for a card that is not about a method', () => {
    const about = renderToStaticMarkup(
      <Methodology title="About the site" label="About">
        <MethodologyItem>Fixture.</MethodologyItem>
      </Methodology>,
    )
    expect(visibleText(about)).toBe('About')
  })
})

describe('InfoMark', () => {
  it('is the "i" with its words for assistive tech and no class name', () => {
    const html = renderToStaticMarkup(<InfoMark detail="Fixture help." />)
    expect(html).toContain('<span class="sr-only">Fixture help.</span>')
    expect(html).not.toMatch(/OFFICIAL|DERIVED|SIMULATED|UNAVAILABLE/)
    expect(html).not.toContain('<svg')
  })
})

describe('SteepSlopeWarning', () => {
  const render = (deg: number) => renderToStaticMarkup(<SteepSlopeWarning slope={derived(deg, 'fixture slope')} />)

  it('says nothing on gentle and moderate ground, or while the slope is unknown', () => {
    expect(render(3)).toBe('')
    expect(render(14.9)).toBe('')
    expect(renderToStaticMarkup(<SteepSlopeWarning slope={unavailable('fixture')} />)).toBe('')
  })

  it('warns from 15° in a few words, with a glyph as well as the colour', () => {
    const html = render(17)
    expect(html).toContain('data-slope-warning="steep"')
    expect(html.match(/<svg/g)).toHaveLength(1)
    expect(visibleText(html)).toBe(`${SLOPE_WARNING_TEXT.steep}Methodology`)
  })

  it('says over the suited limit past 20°, and cites the limit in its methodology', () => {
    const html = render(23.4)
    expect(html).toContain('data-slope-warning="over-limit"')
    expect(html).toContain('text-danger')
    expect(visibleText(html)).toBe(`${SLOPE_WARNING_TEXT['over-limit']}Methodology`)
    expect(methodologyText(html)).toContain('EVA-EXP-0075')
    expect(methodologyText(html)).toContain("the project's own band")
  })
})

describe('Methodology buttons can be told apart', () => {
  it('names each button by what its card explains', () => {
    const html = renderToStaticMarkup(
      <Methodology title="How the hazards were scanned">
        <MethodologyItem>Fixture.</MethodologyItem>
      </Methodology>,
    )
    expect(html).toContain('aria-label="Methodology: How the hazards were scanned"')
  })
})
