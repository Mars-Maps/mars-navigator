import { describe, expect, it } from 'vitest'
import {
  CAMERA_FOV_DEG,
  GLOBE_RADIUS,
  KM_PER_SCENE_UNIT,
  LENS_FACTOR,
  MAX_CAMERA_ALTITUDE_KM,
  MIN_CAMERA_ALTITUDE_KM,
  START_CAMERA_DISTANCE_RADII,
} from '../../src/features/mars-3d/constants'
import {
  LABEL_GAP_PX,
  drawnStepDeg,
  emptyGridLabelView,
  gridLabelText,
  gridLabels,
  labelStepDeg,
  pixelsPerDegree,
  planGridLabels,
  sameLabelledLines,
  visibleArcDeg,
  type GridLabelCamera,
} from '../../src/features/mars-3d/gridLabelPlan'
import { GRID_LEVELS } from '../../src/features/mars-3d/gridLines'

const RADIUS_KM = GLOBE_RADIUS * KM_PER_SCENE_UNIT
const JEZERO = { latitude: 18.4, longitudeEast: 77.5 }

function camera(altitudeKm: number, centre = JEZERO): GridLabelCamera {
  return { centre, distanceRadii: 1 + altitudeKm / RADIUS_KM, widthPx: 1600, heightPx: 900, fovDeg: CAMERA_FOV_DEG }
}

function plan(altitudeKm: number, centre = JEZERO) {
  const cam = camera(altitudeKm, centre)
  const view = planGridLabels(cam, emptyGridLabelView())
  return { cam, view, labels: gridLabels(view) }
}

/** Altitudes from the closest the camera comes to the farthest. */
/**
 * Close up: 200 km with the reference lens, where the grid draws 1° lines and a
 * few cross the view. The camera may go lower, where the view is a
 * fraction of a degree and may hold no whole-degree line to label.
 */
const CLOSE_KM = 200 * LENS_FACTOR
const ALTITUDES = [MIN_CAMERA_ALTITUDE_KM, CLOSE_KM, 600, 1200, 2500, 5000, 9000, 14000, 25000, MAX_CAMERA_ALTITUDE_KM]

describe('gridLabelPlan: gridLabelText', () => {
  it('writes whole degrees in the project format, south and east as suffixes', () => {
    expect(gridLabelText('latitude', 18)).toBe('18°N')
    expect(gridLabelText('latitude', -18)).toBe('18°S')
    expect(gridLabelText('latitude', 0)).toBe('0°N')
    expect(gridLabelText('longitude', 77)).toBe('77°E')
    expect(gridLabelText('longitude', 0)).toBe('0°E')
    expect(gridLabelText('longitude', 300)).toBe('300°E')
  })
})

describe('gridLabelPlan: spacing', () => {
  it('labels the drawn lines themselves when they are far enough apart', () => {
    expect(labelStepDeg(300, 1)).toBe(1)
    expect(labelStepDeg(20, 5)).toBe(5)
  })

  it('labels every Nth drawn line when every one would crowd', () => {
    expect(labelStepDeg(50, 1)).toBe(2)
    expect(labelStepDeg(10, 1)).toBe(10)
    expect(labelStepDeg(3, 10)).toBe(30)
  })

  it('never labels a line the grid does not draw', () => {
    // 2° is not a multiple of 5°, so a 5° grid goes on to 10°.
    expect(labelStepDeg(50, 5)).toBe(5)
    expect(labelStepDeg(10, 5)).toBe(10)
    expect(labelStepDeg(1000, 10)).toBe(10)
  })

  it('takes the drawn spacing from the grid levels at that altitude', () => {
    expect(drawnStepDeg(MAX_CAMERA_ALTITUDE_KM)).toBe(GRID_LEVELS[0].stepDeg)
    expect(drawnStepDeg(MIN_CAMERA_ALTITUDE_KM)).toBe(1)
    expect(drawnStepDeg(CLOSE_KM)).toBe(1)
    expect(drawnStepDeg(GRID_LEVELS[2].maxAltitudeKm)).toBe(GRID_LEVELS[2].stepDeg)
    // Fading in is not drawn yet: its lines are not labelled.
    expect(drawnStepDeg(GRID_LEVELS[3].maxAltitudeKm * 1.2)).toBe(GRID_LEVELS[2].stepDeg)
  })

  it('measures a degree on screen from the camera height', () => {
    // Twice as high, half as many pixels per degree.
    const low = pixelsPerDegree(1.1, 900, 12.5)
    const high = pixelsPerDegree(1.2, 900, 12.5)
    expect(low / high).toBeCloseTo(2, 10)
  })

  it('keeps labels at least LABEL_GAP_PX apart at every altitude, or uses the coarsest spacing', () => {
    for (const altitude of ALTITUDES) {
      const { cam, view } = plan(altitude)
      const px = pixelsPerDegree(cam.distanceRadii, cam.heightPx, cam.fovDeg / 2)
      // The plan measures at the labels' meridian, so the centre is a ceiling.
      expect(view.latStep * px >= LABEL_GAP_PX || view.latStep === 90).toBe(true)
      expect(view.lonStep).toBeGreaterThanOrEqual(view.latStep)
    }
  })
})

describe('gridLabelPlan: visibleArcDeg', () => {
  it('reaches the horizon when the whole globe is in view', () => {
    expect(visibleArcDeg(5, 12.5)).toBeCloseTo((Math.acos(1 / 5) * 180) / Math.PI, 10)
  })

  it('reaches only the edge of the view close up', () => {
    const arc = visibleArcDeg(1 + CLOSE_KM / RADIUS_KM, 12.5)
    expect(arc).toBeGreaterThan(1)
    expect(arc).toBeLessThan(3)
  })
})

describe('gridLabelPlan: planGridLabels', () => {
  it('labels the opening view every 30° or more, never at the poles', () => {
    const { view, labels } = plan((START_CAMERA_DISTANCE_RADII - 1) * RADIUS_KM)
    expect(view.latStep).toBe(30)
    const latitudes = labels.filter((l) => l.kind === 'latitude').map((l) => l.deg)
    expect(latitudes).toEqual([-60, -30, 0, 30, 60])
  })

  it('labels a handful of 1° lines around the view close up', () => {
    const { view, labels } = plan(CLOSE_KM)
    expect(view.latStep).toBe(1)
    const latitudes = labels.filter((l) => l.kind === 'latitude').map((l) => l.deg)
    expect(latitudes.length).toBeGreaterThan(0)
    expect(latitudes.length).toBeLessThan(10)
    for (const lat of latitudes) expect(Math.abs(lat - JEZERO.latitude)).toBeLessThan(5)
  })

  it('puts latitude labels west of the centre and longitude labels south of it', () => {
    const { view } = plan(2000)
    expect(view.latAnchor).toBeLessThan(JEZERO.latitude)
    expect(view.lonAnchor).toBeLessThan(JEZERO.longitudeEast)
  })

  it('labels only whole multiples of its spacing, each line once', () => {
    for (const altitude of ALTITUDES) {
      const { view, labels } = plan(altitude)
      expect(new Set(labels.map((l) => l.key)).size).toBe(labels.length)
      for (const l of labels) {
        const step = l.kind === 'latitude' ? view.latStep : view.lonStep
        expect(Math.abs(l.deg % step)).toBe(0)
        if (l.kind === 'latitude') expect(Math.abs(l.deg)).toBeLessThan(90)
        else expect(l.deg).toBeGreaterThanOrEqual(0)
        if (l.kind === 'longitude') expect(l.deg).toBeLessThan(360)
      }
      // A screen's worth, not a globe's worth.
      expect(labels.length).toBeLessThan(40)
    }
  })

  it('wraps longitudes across 0°E without a 360°E or a repeat', () => {
    const { labels } = plan(CLOSE_KM, { latitude: 0, longitudeEast: 359.6 })
    const longitudes = labels.filter((l) => l.kind === 'longitude').map((l) => l.deg)
    expect(longitudes).toContain(0)
    expect(longitudes).toContain(359)
    expect(longitudes).not.toContain(360)
  })

  it('stays a screenful near a pole, where meridians meet', () => {
    for (const altitude of ALTITUDES) {
      const { labels } = plan(altitude, { latitude: 89.5, longitudeEast: 10 })
      expect(new Set(labels.map((l) => l.key)).size).toBe(labels.length)
      expect(labels.length).toBeLessThan(40)
    }
  })
})

describe('gridLabelPlan: sameLabelledLines', () => {
  it('ignores where the labels sit, so a small pan re-renders nothing', () => {
    const a = plan(1000).view
    const b = planGridLabels(camera(1000, { latitude: 18.41, longitudeEast: 77.51 }), emptyGridLabelView())
    expect(a.lonAnchor).not.toBe(b.lonAnchor)
    expect(sameLabelledLines(a, b)).toBe(true)
  })

  it('notices when the spacing changes', () => {
    expect(sameLabelledLines(plan(CLOSE_KM).view, plan(20000).view)).toBe(false)
  })
})
