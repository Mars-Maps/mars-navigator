import { createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MapCaption } from '../../src/features/mars-3d/surfaceView/MapCaption'
import { NO_WALK, type WalkOnMap } from '../../src/features/mars-3d/surfaceView/mapOverlay'

const stop = { latitude: 18, longitudeEast: 77 }
const caption = (walk: WalkOnMap) =>
  renderToStaticMarkup(
    <MapCaption
      width={200}
      expanded={false}
      layerLabel="Fixture layer"
      hasImagery
      spanRef={createRef()}
      hoverRef={createRef()}
      pins={[]}
      line={false}
      walk={walk}
    />,
  )

describe('MapCaption: the planned walk', () => {
  it('says nothing of a walk with no plan', () => {
    expect(caption(NO_WALK)).not.toContain('planned walk')
    expect(caption(NO_WALK)).not.toContain('white dots')
  })

  it('names the line and its method, with no pins on the map', () => {
    const html = caption({ paths: [[stop, stop]], stops: [stop], mark: { classification: 'DERIVED', detail: 'fixture method' } })
    expect(html).toContain('the planned walk, straight between its stops, not routed around anything')
    expect(html).toContain('fixture method')
  })

  it('never calls a simulated walk a plan', () => {
    const html = caption({ paths: [[stop, stop]], stops: [stop], mark: { classification: 'SIMULATED', detail: 'fixture source' } })
    expect(html).toContain('the sample walk, invented, not a plan')
    expect(html).not.toContain('planned walk')
  })

  it('does not claim a line when none was drawn', () => {
    const html = caption({ paths: [], stops: [stop], mark: null })
    expect(html).toContain('no line between them was planned')
    expect(html).not.toContain('dashed line')
  })
})
