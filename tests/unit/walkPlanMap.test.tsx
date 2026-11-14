import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SAMPLE_WALK_PLAN } from '../../src/data/mock/sampleWalkPlan'
import { derived, unavailable, type Hazard, type MarsCoordinate, type WalkPlan } from '../../src/domain'
import { WalkPlanMap } from '../../src/features/mission-ui/walk/WalkPlanMap'

const FROM = { latitude: 18, longitudeEast: 77 }
const TO = { latitude: 18.05, longitudeEast: 77.05 }

const slopeFlag = (id: string, coordinate: MarsCoordinate): Hazard =>
  ({ id, kind: 'slope', unit: 'deg', coordinate, magnitude: derived(25, 'test') }) as Hazard
const obstacle = (id: string, coordinate: MarsCoordinate): Hazard =>
  ({ id, kind: 'mapped-obstacle', unit: 'Ridge crest', coordinate, magnitude: unavailable('no size') }) as Hazard

const plan = (hazards: Hazard[], over: Partial<WalkPlan['legs'][number]> = {}): WalkPlan => ({
  ...SAMPLE_WALK_PLAN,
  stops: [
    { ...SAMPLE_WALK_PLAN.stops[0], id: 'a', coordinate: FROM },
    { ...SAMPLE_WALK_PLAN.stops[0], id: 'b', coordinate: TO },
  ],
  legs: [
    {
      ...SAMPLE_WALK_PLAN.legs[0],
      fromStopId: 'a',
      toStopId: 'b',
      path: derived([FROM, TO], 'straight, test'),
      steepestSlopeDeg: derived(10, 'test'),
      hazards: derived(hazards, 'test'),
      ...over,
    },
  ],
})
const render = (p: WalkPlan) => renderToStaticMarkup(<WalkPlanMap plan={p} />)
const countOf = (html: string, needle: string) => html.split(needle).length - 1

describe('WalkPlanMap', () => {
  it('marks the start S and numbers the stops after it from 1, as the panel names them, and draws the leg', () => {
    const html = render(plan([]))
    expect(html.indexOf('>S</text>')).toBeGreaterThan(-1)
    expect(html.indexOf('>1</text>')).toBeGreaterThan(html.indexOf('>S</text>'))
    expect(html).not.toContain('>2</text>')
    // The spoken label counts the same way as the marks.
    expect(html).toContain('north up: the start and 1 stop')
    expect(countOf(html, '<polyline')).toBe(1)
  })

  it('draws a mark per flag, one kind each, over the stops', () => {
    const at = { latitude: 18.02, longitudeEast: 77.02 }
    const html = render(plan([slopeFlag('s', at), obstacle('o', at)]))
    const drawing = html.slice(0, html.indexOf('</svg>'))
    expect(countOf(drawing, 'fill-danger')).toBe(1)
    expect(countOf(drawing, 'stroke-accent')).toBe(1)
    expect(drawing.indexOf('fill-danger')).toBeGreaterThan(drawing.lastIndexOf('fill-ink"'))
  })

  it('says the counts in words, singular and plural', () => {
    const at = { latitude: 18.02, longitudeEast: 77.02 }
    const one = render(plan([slopeFlag('s', at), obstacle('o', at)]))
    // Start plus one stop: 'the start and 1 stop'.
    expect(one).toContain('the start and 1 stop, 1 slope flag, 1 mapped obstacle.')
    const two = render(plan([slopeFlag('s', at), slopeFlag('t', at)]))
    expect(two).toContain('2 slope flags, 0 mapped obstacles.')
  })

  it('draws a checked leg solid, with no not-checked legend', () => {
    const html = render(plan([]))
    expect(html).not.toContain('stroke-dasharray')
    expect(html).not.toContain('Not fully checked')
    expect(html).not.toContain('not fully checked')
  })

  it('draws a leg not read dashed and muted, and says so in the legend and the label', () => {
    const html = render(plan([], { hazards: unavailable('not read') }))
    const line = html.slice(html.indexOf('<polyline'), html.indexOf('/>', html.indexOf('<polyline')))
    expect(line).toContain('stroke-dasharray')
    expect(line).toContain('stroke-ink-muted')
    expect(html).toContain('Not fully checked')
    expect(html).toContain('1 leg not fully checked')
  })

  it('says it is a diagram, not imagery, and carries the classification of the path', () => {
    expect(render(plan([]))).toContain('Diagram, no imagery')
    expect(render(SAMPLE_WALK_PLAN)).toContain('SIMULATED')
  })
})
