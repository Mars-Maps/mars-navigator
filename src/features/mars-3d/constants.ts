import { MARS_MEAN_RADIUS_KM } from '../../domain'

/**
 * Physical constants for the globe. OFFICIAL — NASA Mars Fact Sheet:
 * https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html
 * (mean radius comes from the domain, same source).
 */
export const MARS_FACT_SHEET_URL =
  'https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html'

/** Obliquity to orbit, degrees. */
export const MARS_AXIAL_TILT_DEG = 25.19

/**
 * Sidereal rotation period, hours. Rotation is prograde: counter-clockwise
 * seen from above the north pole, the same sense as Earth.
 */
export const MARS_SIDEREAL_DAY_HOURS = 24.6229

/** Scene scale: one scene unit is 1000 km, so the globe has radius 3.3895. */
export const KM_PER_SCENE_UNIT = 1000
export const GLOBE_RADIUS = MARS_MEAN_RADIUS_KM / KM_PER_SCENE_UNIT

/**
 * SIMULATED: a demonstration spin of one turn every two minutes, so the
 * globe is visibly alive. Real-time rotation (24.6 h per turn) reads as
 * static. The sun model replaces this with TimeState-driven rotation.
 * Labelled as such in the UI by MarsGlobe.
 */
export const DEMO_SPIN_PERIOD_S = 120
export const DEMO_SPIN_RAD_PER_S = (2 * Math.PI) / DEMO_SPIN_PERIOD_S

export const DEG_TO_RAD = Math.PI / 180

/**
 * Vertical field of view of the scene camera, degrees. One value for the
 * camera itself, the detail-tile zoom and the scale bar, which all turn
 * altitude into ground metres per pixel with it.
 *
 * 25°: a telephoto lens. Close-up read as a ball
 * with the 45° lens because the screen edge saw the ground 24° off its
 * normal at the floor and 46° at a 1,400 km span, and the limb entered the
 * screen corners from about 1,900–2,100 km up; at 25° those are 14° and
 * 32°, and the limb enters the corners at about 1.4× the ground span it
 * did before (from 4,800–5,400 km up, 2,600–2,900 km in 45° terms). The
 * sphere, the nadir camera and every system on them are unchanged.
 */
export const CAMERA_FOV_DEG = 25

/** The lens the altitudes below were tuned for. */
export const REFERENCE_FOV_DEG = 45

/**
 * How much farther the camera must be with CAMERA_FOV_DEG to show the same
 * ground as with REFERENCE_FOV_DEG: tan(45° / 2) / tan(25° / 2) ≈ 1.87.
 * Every altitude below is its reference-lens value times this, so the
 * ground scale, the tile zoom and the scale bar at each view are what they
 * were, and only the perspective changes.
 */
export const LENS_FACTOR =
  Math.tan((REFERENCE_FOV_DEG / 2) * DEG_TO_RAD) / Math.tan((CAMERA_FOV_DEG / 2) * DEG_TO_RAD)

/**
 * Camera altitude limits, km above the mean radius: 20 km and
 * 25,000 km with the reference lens. The ceiling keeps the camera well
 * inside the starfield. The floor was once 200 km: the Viking base
 * (about 230 m/px) went soft below it. The global CTX mosaic (zoom 11,
 * 512 px tiles, about 10 m per tile pixel) now draws under the satellite
 * layer below the layer's own finest tiles, and at 20 km with the reference
 * lens a screen pixel is about that size, so the ground stays sharp to the
 * floor. Data layers keep their own picture, magnified, as their data is.
 * The view modes' thresholds are unaffected.
 */
export const MIN_CAMERA_ALTITUDE_KM = 20 * LENS_FACTOR

/**
 * The lowest a flight to a site or a searched place frames it:
 * the old floor, 200 km with the reference lens, so "Go to Jezero" opens on
 * the crater with its surroundings as before (the lower floor changed only how far the
 * user may zoom in from there).
 */
export const FRAME_MIN_ALTITUDE_KM = 200 * LENS_FACTOR

/**
 * The global CTX ground is drawn only below this: a little under the
 * lowest a flight frames, since a flight up to that altitude settles within
 * a tenth of a kilometre below it and must still show the colour picture.
 */
export const GROUND_BELOW_ALTITUDE_KM = FRAME_MIN_ALTITUDE_KM * 0.98
export const MAX_CAMERA_ALTITUDE_KM = 25000 * LENS_FACTOR

/**
 * Where the camera starts: 2.2 radii above the surface with the reference
 * lens (3.2 from the centre), the whole globe in view with room around it.
 * From here up the shell counts the view as the whole planet, which is
 * where the welcome screen may return.
 */
export const START_CAMERA_DISTANCE_RADII = 1 + 2.2 * LENS_FACTOR
export const START_CAMERA_ALTITUDE_KM = MARS_MEAN_RADIUS_KM * (START_CAMERA_DISTANCE_RADII - 1)
