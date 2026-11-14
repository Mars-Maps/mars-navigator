import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  loadLayerLegend,
  parseArcgisLegend,
  type CategoriesLegend,
  type LegendIo,
} from '../../src/data/adapters/LayerAdapter'
import { LAYER_SOURCES } from '../../src/data/layers/layerSources'
import { official, unavailable, type MapLayer, type MapLayerLegend } from '../../src/domain'
import { LayerMenuView } from '../../src/features/mission-ui/LayerMenu'

describe('layer legends', () => {
  const legends = Object.values(LAYER_SOURCES).map((s) => s?.layer.legend)

  it('every source has a legend, or a stated reason for none', () => {
    for (const legend of legends) {
      expect(legend).toBeDefined()
      if (legend?.kind === 'none') expect(legend.reason.trim()).not.toBe('')
    }
  })

  it('a scale runs low to high with every mark inside it, and is cited', () => {
    for (const legend of legends.filter((l) => l?.kind === 'scale')) {
      expect(legend.min).toBeLessThan(legend.max)
      for (const mark of legend.marks) {
        expect(mark.value).toBeGreaterThanOrEqual(legend.min)
        expect(mark.value).toBeLessThanOrEqual(legend.max)
        expect(mark.label.trim()).not.toBe('')
      }
      expect(legend.quantity.trim()).not.toBe('')
      expect(legend.source.trim()).not.toBe('')
      expect(legend.imageUrl).toMatch(/^https:\/\//)
    }
  })

  it('the geology map reads its named units from the producer’s legend service, cited to USGS', () => {
    const legend = LAYER_SOURCES.geology?.layer.legend
    expect(legend?.kind).toBe('categories')
    if (legend?.kind !== 'categories') return
    expect(legend.legendUrl).toMatch(/^https:\/\/trek\.nasa\.gov\/.*SIM3292_Global_Geology\/MapServer\/legend\?f=json$/)
    expect(legend.publicationUrl).toBe('https://pubs.usgs.gov/sim/3292/')
    expect(legend.source).toMatch(/10\.3133\/sim3292/)
    expect(legend.quantity.trim()).not.toBe('')
  })

  it('satellite, elevation and thermal publish no scale', () => {
    for (const id of ['satellite', 'elevation', 'thermal'] as const) {
      expect(LAYER_SOURCES[id]?.layer.legend.kind).toBe('none')
    }
  })
})

describe('loadLayerLegend', () => {
  // Test fixture only: an invented legend, never shown in the app.
  const legend: CategoriesLegend = {
    kind: 'categories',
    quantity: 'Fixture quantity',
    legendUrl: 'https://example.test/legend?f=json',
    publicationUrl: 'https://example.test/pub',
    source: 'fixture-legend-source',
  }
  const entry = (label: string) => ({ label, imageData: 'AAAA', contentType: 'image/png' })
  const body = (items: unknown[]) => ({ layers: [{ layerId: 0, legend: items }] })
  const io = (answer: () => Promise<unknown>): LegendIo & { urls: string[] } => {
    const urls: string[] = []
    return {
      urls,
      fetchJson(url) {
        urls.push(url)
        return answer()
      },
    }
  }
  const live = () => new AbortController().signal

  it('reads every entry as a name and the producer’s swatch, OFFICIAL with the legend’s citation', async () => {
    const f = io(async () => body([entry('Unit A'), entry('Unit B')]))
    const result = await loadLayerLegend(legend, live(), f)
    expect(f.urls).toEqual(['https://example.test/legend?f=json'])
    expect(result).toEqual(
      official(
        [
          { label: 'Unit A', swatchUrl: 'data:image/png;base64,AAAA' },
          { label: 'Unit B', swatchUrl: 'data:image/png;base64,AAAA' },
        ],
        'fixture-legend-source',
      ),
    )
  })

  it('is UNAVAILABLE with the reason when the service fails, and never a partial legend', async () => {
    const failed = await loadLayerLegend(legend, live(), io(async () => Promise.reject(new Error('offline'))))
    expect(failed).toEqual(unavailable('Official legend failed to load: offline'))
    const half = await loadLayerLegend(legend, live(), io(async () => body([entry('Unit A'), { label: 'Unit B' }])))
    expect(half.classification).toBe('UNAVAILABLE')
    if (half.classification === 'UNAVAILABLE') expect(half.reason).toMatch(/"Unit B" has no swatch image/)
  })

  it('rejects bodies that are not an ArcGIS legend, with what is missing', () => {
    expect(parseArcgisLegend(null)).toBe('no "layers" list')
    expect(parseArcgisLegend({ layers: [] })).toBe('the first layer has no "legend" list')
    expect(parseArcgisLegend(body([]))).toBe('the legend is empty')
    expect(parseArcgisLegend(body([{ imageData: 'AAAA', contentType: 'image/png' }]))).toBe('an entry has no label')
    expect(parseArcgisLegend(body([{ label: 'X', imageData: 'AAAA', contentType: 'text/html' }]))).toBe(
      '"X" has a swatch that is not an image',
    )
    expect(parseArcgisLegend(body([{ label: 'X', imageData: 'not base64!', contentType: 'image/png' }]))).toBe(
      '"X" has a swatch that is not base64',
    )
    expect(parseArcgisLegend(body([{ label: 'X', imageData: 'AAA', contentType: 'image/png' }]))).toBe(
      '"X" has a swatch that is not base64',
    )
    expect(parseArcgisLegend(body([{ label: 'X', imageData: 'iVBORw0KGgo=', contentType: 'image/png' }]))).toEqual([
      { label: 'X', swatchUrl: 'data:image/png;base64,iVBORw0KGgo=' },
    ])
  })

  it('answers Cancelled without asking the service when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const f = io(async () => body([entry('Unit A')]))
    expect(await loadLayerLegend(legend, controller.signal, f)).toEqual(unavailable('Cancelled'))
    expect(f.urls).toEqual([])
  })
})

describe('LayerMenuView legend', () => {
  // Test fixtures only: invented provenance, never shown in the app.
  const layer = (legend: MapLayerLegend): MapLayer => ({
    id: 'geology',
    label: 'Fixture geology',
    classification: 'OFFICIAL',
    source: 'fixture-source',
    provider: 'fixture provider',
    licence: 'fixture-licence',
    caveat: null,
    previewUrl: null,
    legend,
  })
  const render = (legend: MapLayerLegend, entries?: Parameters<typeof LayerMenuView>[0]['legendEntries']) =>
    renderToStaticMarkup(
      <LayerMenuView
        layers={[layer(legend)]}
        activeLayerId="geology"
        legendEntries={entries}
        onSelect={() => {}}
      />,
    )
  const categories: MapLayerLegend = {
    kind: 'categories',
    quantity: 'Fixture quantity',
    legendUrl: 'https://example.test/legend?f=json',
    publicationUrl: 'https://example.test/pub',
    source: 'fixture-legend-source',
  }

  it('shows a scale as words with its marks, source and a link to the official bar', () => {
    const html = render({
      kind: 'scale',
      min: 0,
      max: 0.2,
      marks: [{ value: 0.1, label: 'Fixture limit' }],
      quantity: 'Fixture quantity',
      imageUrl: 'https://example.test/bar.png',
      source: 'fixture-legend-source',
    })
    expect(html).toContain('Fixture quantity')
    expect(html).toContain('0 to 0.2')
    expect(html).toContain('0.1: Fixture limit')
    expect(html).toContain('OFFICIAL')
    expect(html).toContain('fixture-legend-source')
    expect(html).toContain('href="https://example.test/bar.png"')
    // Linked, never drawn: no image of the bar and no sampled colour.
    expect(html).not.toContain('src="https://example.test/bar.png"')
  })

  it('lists the named classes with the producer’s swatches, cited, and links the map sheet', () => {
    const html = render(
      categories,
      official(
        [
          { label: 'Fixture unit A', swatchUrl: 'data:image/png;base64,AAAA' },
          { label: 'Fixture unit B', swatchUrl: 'data:image/png;base64,BBBB' },
        ],
        'fixture-legend-source',
      ),
    )
    expect(html).toContain('Fixture quantity')
    expect(html).toContain('OFFICIAL')
    expect(html).toContain('fixture-legend-source')
    expect(html).toContain('Fixture unit A')
    expect(html).toContain('src="data:image/png;base64,BBBB"')
    expect(html).toContain('href="https://example.test/pub"')
    expect(html).toContain('data-legend-entries')
    expect(html).not.toContain('Reading the official legend')
  })

  it('keeps both rows when the producer repeats a label', () => {
    const html = render(
      categories,
      official(
        [
          { label: 'Fixture unit', swatchUrl: 'data:image/png;base64,AAAA' },
          { label: 'Fixture unit', swatchUrl: 'data:image/png;base64,BBBB' },
        ],
        'fixture-legend-source',
      ),
    )
    expect(html.match(/Fixture unit/g)).toHaveLength(2)
    expect(html).toContain('base64,AAAA')
    expect(html).toContain('base64,BBBB')
  })

  it('says the legend is being read, or why it is unavailable, and invents no entry', () => {
    const reading = render(categories)
    expect(reading).toContain('Reading the official legend')
    expect(reading).not.toContain('data-legend-entries')
    const failed = render(categories, unavailable('fixture reason'))
    expect(failed).toContain('Official legend unavailable')
    expect(failed).toContain('fixture reason')
    expect(failed).toContain('UNAVAILABLE')
    expect(failed).not.toContain('data-legend-entries')
  })

  it('says there is no official legend and why', () => {
    const html = render({ kind: 'none', reason: 'fixture reason' })
    expect(html).toContain('No official legend')
    expect(html).toContain('fixture reason')
    expect(html).not.toContain('<a ')
  })
})
