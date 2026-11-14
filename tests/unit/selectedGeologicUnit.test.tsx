import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { readUnitAt, type UnitReader } from '../../src/app/useSelectedGeologicUnit'
import { official, unavailable, type GeologicUnit, type MarsCoordinate } from '../../src/domain'
import { PointMenuView } from '../../src/features/mission-ui/PointMenu'
import {
  NO_GEOLOGIC_UNIT_REASON,
  READING_GEOLOGIC_UNIT_REASON,
  describePoint,
} from '../../src/features/mission-ui/pointFields'

// Test fixtures only: an invented map and unit, never shown in the app.
const MAP = { id: 'SIM 0000', title: 'Fixture map', scaleDenominator: 75000, citation: 'Fixture citation, 2026' }
const UNIT: GeologicUnit = { symbol: 'Fx', name: 'Fixture floor unit', map: MAP }
const AT: MarsCoordinate = { latitude: 18.4, longitudeEast: 77.5 }

const answering =
  (answer: ReturnType<UnitReader>): UnitReader =>
  () =>
    answer

describe('readUnitAt', () => {
  it("gives the unit, OFFICIAL with its map's citation", async () => {
    const unit = await readUnitAt(AT, new AbortController().signal, answering(Promise.resolve(official(UNIT, MAP.citation))))
    expect(unit).toEqual(official(UNIT, MAP.citation))
  })

  it("passes on the adapter's reason where no map covers the point", async () => {
    const none = unavailable<GeologicUnit>('No geologic map covers this point')
    expect(await readUnitAt(AT, new AbortController().signal, answering(Promise.resolve(none)))).toEqual(none)
  })

  it('answers a failed read as UNAVAILABLE with the reason, never a unit', async () => {
    const failed = unavailable<GeologicUnit>('Geologic unit (SIM 0000) failed to load: HTTP 503')
    expect(await readUnitAt(AT, new AbortController().signal, answering(Promise.resolve(failed)))).toEqual(failed)
    const rejected = await readUnitAt(AT, new AbortController().signal, answering(Promise.reject(new Error('offline'))))
    expect(rejected).toEqual(unavailable('The geologic unit read failed: offline'))
  })

  it('writes nothing for a read abandoned by a new selection', async () => {
    const controller = new AbortController()
    let finish: (u: ReturnType<typeof official<GeologicUnit>>) => void = () => {}
    const pending = readUnitAt(AT, controller.signal, () => new Promise((resolve) => (finish = resolve)))
    controller.abort()
    finish(official(UNIT, MAP.citation))
    expect(await pending).toBeNull()
  })
})

describe("the point menu's Geologic unit row", () => {
  it('shows the read as given, and says while it is reading', () => {
    const unit = official(UNIT, MAP.citation)
    expect(describePoint(AT, null, { geologicUnit: unit }).geologicUnit).toBe(unit)
    expect(describePoint(AT, null, { geologicUnit: null }).geologicUnit).toEqual(
      unavailable(READING_GEOLOGIC_UNIT_REASON),
    )
    expect(describePoint(AT, null).geologicUnit).toEqual(unavailable(NO_GEOLOGIC_UNIT_REASON))
  })

  it('names the unit with its symbol, as the stop card does', () => {
    const html = renderToStaticMarkup(
      <PointMenuView point={AT} departure={null} pointGeologicUnit={official(UNIT, MAP.citation)} />,
    )
    expect(html).toContain('Fixture floor unit (Fx)')
  })

  it('no longer claims a per-point lookup is missing', () => {
    expect(NO_GEOLOGIC_UNIT_REASON).not.toMatch(/no per-point|will read/i)
  })
})
