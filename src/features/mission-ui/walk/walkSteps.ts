/**
 * The steps of Plan a walk: the landing site, then the mission
 * settings, then the planned walks. Pure, so the panel and the shell agree
 * on which step is open without either holding the rule.
 */
export type WalkStep = 'landing' | 'settings' | 'walks'

export const WALK_STEPS: readonly { id: WalkStep; label: string }[] = [
  { id: 'landing', label: 'Landing site' },
  { id: 'settings', label: 'Mission settings' },
  { id: 'walks', label: 'Walks' },
]

/** What the steps depend on: a landing site a walk can start from, and a plan to show. */
export interface WalkProgress {
  /** A landing site is set and nothing is wrong with it. */
  landingReady: boolean
  hasPlan: boolean
}

/** Whether `step` can be opened: the settings need a landing site, the walks need a plan. */
export function stepOpen(step: WalkStep, progress: WalkProgress): boolean {
  if (step === 'settings') return progress.landingReady
  if (step === 'walks') return progress.hasPlan
  return true
}

/**
 * The step on show when `wanted` was asked for: `wanted` if it can be
 * opened, else the nearest earlier step that can. The landing site is
 * always open, so there is always an answer.
 */
export function shownStep(wanted: WalkStep, progress: WalkProgress): WalkStep {
  if (stepOpen(wanted, progress)) return wanted
  return wanted === 'walks' && stepOpen('settings', progress) ? 'settings' : 'landing'
}

/** Where the tool opens: on the walks when there is a plan (this panel's or the sample walk's), else at the start. */
export function firstStep(progress: WalkProgress): WalkStep {
  return progress.hasPlan ? 'walks' : 'landing'
}

/**
 * The method to show beside the one-line legend of the minimised panel, or
 * null for no line: the landing colours stay on the map while the panel is
 * minimised on the landing step, so what they are stays on show with them.
 */
export function minimisedLegendMethod(
  minimized: boolean,
  step: WalkStep,
  colours: { status: 'loading' } | { status: 'failed' } | { status: 'ready'; method: string } | undefined,
): string | null {
  return minimized && step === 'landing' && colours?.status === 'ready' ? colours.method : null
}
