/**
 * The profile while its heights are being read: UNAVAILABLE, never a blank
 * or a flat line. The shell's `useProfile` answers with it; it lives in the
 * feature so the frame can say "loading" rather than "unavailable" for it,
 * since a feature may not import from `src/app/`. In its own file, apart
 * from the panel: the shell reads it at start-up, and importing it from the
 * panel put the whole panel in the first load.
 */
export const SAMPLING_REASON = 'Sampling the terrain along the path…'
