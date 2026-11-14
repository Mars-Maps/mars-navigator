import {
  simulated,
  unavailable,
  type ExplorationRoute,
  type MarsDataset,
  type RoutePoint,
} from '../../domain'
import { SIMULATED_TRAVERSE, type SimulatedTraverseRecord } from '../mock/simulatedTraverse'
import { toMarsCoordinate } from './coordinates'
import { AdapterValidationError, type DataAdapter } from './DataAdapter'

const ADAPTER_ID = 'mock'

function toRoutePoint(record: SimulatedTraverseRecord): RoutePoint {
  // The source writes longitude ±180 east; converted to 0..360 east.
  // Validate at the boundary: reject, never wrap.
  const result = toMarsCoordinate(record.lat_deg, record.lon_deg, 'east-180')
  if (!result.ok) {
    throw new AdapterValidationError(
      ADAPTER_ID,
      `Point ${record.point_id} has an invalid coordinate (${result.reason}): ` +
        `lat=${record.lat_deg}, lon=${record.lon_deg}`,
    )
  }

  return {
    id: record.point_id,
    coordinate: result.coordinate,
    // null elevation becomes UNAVAILABLE — never 0, never interpolated.
    elevationMeters:
      record.elev_m === null
        ? unavailable('Not present in the source record')
        : simulated(record.elev_m, 'Simulated traverse dataset'),
    label: record.note,
  }
}

/**
 * Produces a clearly simulated dataset through the same interface the real
 * NASA adapter will use. Its purpose is to exercise the pipeline, not to look
 * authentic.
 */
export class MockDataAdapter implements DataAdapter {
  readonly id = ADAPTER_ID
  readonly label = 'Simulated data (no official dataset yet)'

  async load(): Promise<MarsDataset> {
    const points = SIMULATED_TRAVERSE.map(toRoutePoint)

    if (points.length < 2) {
      throw new AdapterValidationError(
        ADAPTER_ID,
        `A route needs at least 2 points, got ${points.length}`,
      )
    }

    const route: ExplorationRoute = {
      id: 'sim-route-01',
      name: 'Simulated Traverse 01',
      classification: 'SIMULATED',
      points,
    }

    return {
      id: 'sim-dataset-01',
      name: 'Development Dataset',
      source: 'Generated locally for development — not a real mission',
      isSimulated: true,
      routes: [route],
    }
  }
}
