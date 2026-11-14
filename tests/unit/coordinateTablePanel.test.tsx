import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MarsCoordinate } from '../../src/domain'
import {
  CoordinateTable,
  CoordinateTablePanel,
} from '../../src/features/mission-ui/CoordinateTablePanel'
import { tableShows } from '../../src/features/mission-ui/coordinateTable'
import { copyText } from '../../src/lib/clipboard'

const render = (latitude: number, longitudeEast: number, source: 'pick' | 'typed' = 'pick') =>
  renderToStaticMarkup(
    <CoordinateTablePanel
      coordinate={{ latitude, longitudeEast }}
      source={source}
      onClose={() => undefined}
    />,
  )

describe('CoordinateTablePanel', () => {
  it('shows latitude, both longitudes and the copyable form', () => {
    const html = render(-4.58712, 350.44149)
    expect(html).toContain('Latitude (planetocentric)')
    expect(html).toContain('4.587°S')
    expect(html).toContain('350.441°E')
    expect(html).toContain('9.559°W')
    expect(html).toContain('4.587°S 350.441°E')
  })

  it('badges every row DERIVED and states the method and the precision', () => {
    const html = render(0, 0)
    expect(html.match(/DERIVED/g)?.length).toBe(3)
    expect(html).toContain('from the pick ray')
    expect(html).toContain('a few screen pixels at the closest zoom')
  })

  it('puts the method in each DERIVED mark, not in a title beside it', () => {
    const html = render(0, 0)
    expect(html.match(/from the pick ray/g)?.length).toBeGreaterThanOrEqual(4)
    expect(html).not.toContain('title="Surface point')
  })

  it("shows a typed point as the user's own entry: no DERIVED mark, no pick method, no precision note", () => {
    const html = render(-4.58712, 350.44149, 'typed')
    expect(html).toContain('4.587°S 350.441°E')
    expect(html).toContain('Entered in the right-click menu')
    expect(html).not.toContain('DERIVED')
    expect(html).not.toContain('from the pick ray')
    expect(html).not.toContain('a few screen pixels at the closest zoom')
  })

  it('has a labelled close button and a Copy button, with no copy message yet', () => {
    const html = render(0, 0)
    expect(html).toContain('aria-label="Close Coordinate table"')
    expect(html).toContain('>Copy</button>')
    expect(html).not.toContain('Copied')
    expect(html).not.toContain('Copy failed')
  })
})

describe('the slot and the menu item', () => {
  const picked: MarsCoordinate = { latitude: -4.6, longitudeEast: 137.4 }

  it('renders nothing in the slot while closed, so the slot hides', () => {
    // A server render reads the store's initial state, where the table is closed.
    expect(renderToStaticMarkup(<CoordinateTable />)).toBe('')
  })

  it('offers Collapse only for the point and source the table shows', () => {
    const table = { point: picked, source: 'pick' as const }
    expect(tableShows(table, { ...picked }, 'pick')).toBe(true)
    expect(tableShows(table, { latitude: 18.4, longitudeEast: 137.4 }, 'pick')).toBe(false)
    expect(tableShows(table, { latitude: -4.6, longitudeEast: 77.5 }, 'pick')).toBe(false)
  })

  it('offers Expand for the same numbers typed over a picked table, so the label switches', () => {
    expect(tableShows({ point: picked, source: 'pick' }, { ...picked }, 'typed')).toBe(false)
    expect(tableShows({ point: picked, source: 'typed' }, { ...picked }, 'typed')).toBe(true)
  })

  it('offers Expand while the table is closed', () => {
    expect(tableShows(null, picked, 'pick')).toBe(false)
  })
})

describe('copyText', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves true once the clipboard has the text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await expect(copyText('4.587°S 350.441°E')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('4.587°S 350.441°E')
  })

  it('resolves false when there is no Clipboard API', async () => {
    vi.stubGlobal('navigator', {})
    await expect(copyText('x')).resolves.toBe(false)
  })

  it('resolves false, never throws, when the browser refuses', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    await expect(copyText('x')).resolves.toBe(false)
  })
})
