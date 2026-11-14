/**
 * The screens of the app:
 *
 *   welcome    — whole globe, intro panel, nothing selected yet
 *   close-up   — zoomed onto the surface; inspect and plan
 *   navigation — following a planned route
 *   surface    — standing on the ground at one spot
 */
export type ViewMode = 'welcome' | 'close-up' | 'navigation' | 'surface'

/**
 * Allowed moves. The shell decides when (src/app/viewModeTriggers.ts):
 * a click anywhere or a wheel over the scene leaves
 * welcome; a zoom out to a whole-globe view followed by ten idle seconds
 * returns to it. Navigation is entered from and exits to close-up, so the
 * surface stays in view on both sides of a route. Surface is entered by
 * dropping the walker on the globe, from welcome, close-up or navigation,
 * and leaves to where it was entered from: close-up ("Back to
 * orbit"), or navigation with the route still followed;
 * the store remembers which. Altitude alone never changes the mode.
 */
const TRANSITIONS: Record<ViewMode, readonly ViewMode[]> = {
  welcome: ['close-up', 'surface'],
  'close-up': ['welcome', 'navigation', 'surface'],
  navigation: ['close-up', 'surface'],
  surface: ['close-up', 'navigation'],
}

export function canTransition(from: ViewMode, to: ViewMode): boolean {
  return from === to || TRANSITIONS[from].includes(to)
}
