import type { Classified } from './classification'
import type { MarsCoordinate } from './mars'

/** The rovers whose paths and photos the app reads. */
export type RoverId = 'perseverance' | 'curiosity'

/**
 * The rover's motion counter: `site` increases when the rover starts a new
 * local frame, `drive` counts moves within it. NASA writes it "site_drive"
 * (RMC). It is the key that ties a photo to where the rover stood.
 */
export interface RoverMotionCounter {
  site: number
  drive: number
}

/**
 * One point where a rover stopped, from NASA's published traverse.
 * Positions are planetocentric and east-positive on the Mars 2000 sphere
 * (Mars 2020 PLACES SIS §3.9); the adapter normalises longitude to 0–360°E.
 */
export interface TraversePoint {
  coordinate: MarsCoordinate
  sol: number
  rmc: RoverMotionCounter
  /**
   * Metres above the MOLA areoid, the datum our DEMs share.
   * The feed's -9999 becomes UNAVAILABLE, never a height.
   */
  elevationMeters: Classified<number>
  /** The rover's tilt from level, in degrees, where the feed gives it. */
  tiltDegrees: Classified<number>
}

/** A rover's path as published, oldest point first. */
export interface RoverTraverse {
  rover: RoverId
  /** The feed the points were read from. */
  source: string
  /** When it was read, ms since 1970-01-01T00:00:00Z: the feed is live. */
  retrievedUtcMs: number
  points: TraversePoint[]
}
