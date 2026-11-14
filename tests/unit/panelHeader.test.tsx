import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PanelHeader } from '../../src/components/PanelHeader'
import { CoordinateTablePanel } from '../../src/features/mission-ui/CoordinateTablePanel'
import { LayerMenuView } from '../../src/features/mission-ui/LayerMenu'
import { DestinationBar } from '../../src/features/mission-ui/navigation/DestinationBar'
import { HazardsPanel } from '../../src/features/mission-ui/navigation/HazardsPanel'
import { ProgressTracker } from '../../src/features/mission-ui/navigation/ProgressTracker'
import { PointMenuView } from '../../src/features/mission-ui/PointMenu'
import { MarkedPointsView } from '../../src/features/mission-ui/tools/MarkedPoints'
import { MeasurePanelView } from '../../src/features/mission-ui/tools/MeasurePanel'
import { SearchGoToView } from '../../src/features/mission-ui/search/SearchGoTo'
import { PlaceholderPanel } from '../../src/features/mission-ui/tools/PlaceholderPanels'
import { TerrainProfileView } from '../../src/features/mission-ui/tools/TerrainProfile'
import { ElevationProfileView } from '../../src/features/mission-ui/navigation/ElevationProfilePanel'

const noop = () => {}

const header = (minimized: boolean, onClose?: () => void) =>
  renderToStaticMarkup(
    <PanelHeader
      title="Fixture"
      minimized={minimized}
      onToggleMinimized={noop}
      bodyId="fixture-body"
      onClose={onClose}
      spacing="mb-3"
    >
      <h2>Fixture</h2>
    </PanelHeader>,
  )

describe('PanelHeader', () => {
  it('offers Minimise while open, naming the body it hides', () => {
    const html = header(false)
    expect(html).toContain('aria-label="Minimise Fixture"')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('aria-controls="fixture-body"')
    expect(html).toContain('<h2>Fixture</h2>')
  })

  it('offers Restore while minimised, and keeps the heading on the bar', () => {
    const html = header(true)
    // Not "Expand": the context menu's "Expand coordinate table" opens it.
    expect(html).toContain('aria-label="Restore Fixture"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('<h2>Fixture</h2>')
    // The body is gone, so nothing is named that is not there (as IconPanel).
    expect(html).not.toContain('aria-controls')
  })

  it('keeps the gap below only while the body shows', () => {
    expect(header(false)).toContain('mb-3')
    expect(header(true)).not.toContain('mb-3')
  })

  it('shows × only for a window that closes from here', () => {
    expect(header(false)).not.toContain('Close Fixture')
    const html = header(false, noop)
    expect(html).toContain('aria-label="Close Fixture"')
    // The close button opens nothing, so it says nothing about expansion.
    expect(html.match(/aria-expanded=/g)).toHaveLength(1)
  })
})

/**
 * Every panel window opens expanded with its Minimise button, and that
 * button names a body that is in the markup. Server rendering reads only the
 * initial state, so the minimised form is covered by the header tests above.
 */
describe('every window has a title bar', () => {
  const POINT = { latitude: 4.5, longitudeEast: 137.4 }
  const windows: [string, ReactElement][] = [
    ['Point', <PointMenuView key="Point" point={POINT} departure={null} />],
    ['Marked points', <MarkedPointsView key="Marked points" markers={[]} onGoTo={noop} />],
    [
      'Terrain Profile',
      <TerrainProfileView key="Terrain Profile" points={[]} profile={null} />,
    ],
    ['Search & Go To', <SearchGoToView key="Search & Go To" names={{ kind: 'loading' }} markers={[]} onGoTo={noop} />],
    ['Not built', <PlaceholderPanel key="Not built" title="Not built" note="not scheduled" />],
    ['Measure', <MeasurePanelView key="Measure" points={[]} onClear={noop} />],
    ['Destination', <DestinationBar key="Destination" route={null} onEnd={noop} />],
    ['Hazards', <HazardsPanel key="Hazards" route={null} />],
    ['Elevation profile', <ElevationProfileView key="Elevation profile" profile={null} />],
    ['Progress', <ProgressTracker key="Progress" route={null} />],
    ['Coordinate table', <CoordinateTablePanel key="Coordinate table" coordinate={POINT} source="pick" onClose={noop} />],
    ['Layers', <LayerMenuView key="Layers" layers={[]} activeLayerId="satellite" onSelect={noop} />],
  ]

  it.each(windows)('%s: Minimise names a body that is there', (title, element) => {
    const html = renderToStaticMarkup(element)
    // As the markup escapes it: "Search &amp; Go To".
    expect(html).toContain(`aria-label="Minimise ${title.replace('&', '&amp;')}"`)
    const controls = html.match(/aria-controls="([^"]+)"/)?.[1]
    expect(controls).toBeDefined()
    expect(html).toContain(`id="${controls}"`)
  })

  // The intro keeps its own ×: any click leaves welcome and hides it, so it
  // has nothing to minimise to.
  it('only the coordinate table closes from its bar', () => {
    const closable = windows
      .filter(([, element]) => renderToStaticMarkup(element).includes('aria-label="Close '))
      .map(([title]) => title)
    expect(closable).toEqual(['Coordinate table'])
  })

  it('folds the elevation chart with its bar, the UNAVAILABLE frame inside the body', () => {
    const html = renderToStaticMarkup(
      <ElevationProfileView profile={{ classification: 'UNAVAILABLE', reason: 'fixture' }} />,
    )
    const controls = html.match(/aria-controls="([^"]+)"/)?.[1]
    const body = html.slice(html.indexOf(`id="${controls}"`))
    expect(body).toContain('Elevation unavailable')
  })

  it('keeps End navigation on the destination bar, the only way out', () => {
    const html = renderToStaticMarkup(<DestinationBar route={null} onEnd={noop} />)
    const bar = html.slice(0, html.indexOf('aria-label="Minimise Destination"'))
    expect(bar).toContain('End navigation')
  })
})
