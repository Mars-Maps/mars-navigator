import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Keeps one failed part of the page from blanking the rest. React
 * unmounts the whole tree on an uncaught render error, and a lazy chunk that
 * fails to load throws as one; only a class component can catch it.
 *
 * Retry is a reload, never a re-render: React caches a rejected `lazy()`
 * import, so rendering the same child again throws the same error.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; fallback: (error: unknown) => ReactNode },
  { error: unknown }
> {
  state: { error: unknown } = { error: null }

  static getDerivedStateFromError(error: unknown): { error: unknown } {
    // `throw null` would leave the state as "no error": hold something truthy.
    return { error: error ?? new Error('Unknown error') }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('A part of the app failed and was replaced by a message:', error, info.componentStack)
  }

  render(): ReactNode {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children
  }
}

function reload(): void {
  window.location.reload()
}

/** The whole page's fallback, past App's own boundaries: rare by design. */
export function RootFailure() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-canvas">
      <FailedPart what="Mars Explorer" />
    </div>
  )
}

/** The frame a panel's stand-in sits in, where the panel's own frame is not drawn yet. */
const PANEL_FRAME = 'rounded-panel border border-line/60 bg-surface/70 px-4 py-3 shadow-panel backdrop-blur-glass'

/**
 * What a lazily loaded panel shows while its chunk loads: a line in
 * the panel's frame, so an open panel is never blank or a bare line over the map.
 */
export function LoadingPart({ what }: { what: string }) {
  return (
    <p role="status" className={`text-body text-ink-muted ${PANEL_FRAME}`}>
      Loading {what}…
    </p>
  )
}

/** The message a failed part shows in its place, with a Reload button. */
export function FailedPart({ what, panel = false }: { what: string; panel?: boolean }) {
  return (
    <div
      role="alert"
      className={`flex items-center gap-3 text-body text-ink ${panel ? PANEL_FRAME : 'h-full w-full justify-center'}`}
    >
      <span>{what} failed to load.</span>
      <button
        type="button"
        onClick={reload}
        className="rounded-control border border-line px-3 py-1 text-ink transition-colors duration-(--duration-fast) hover:bg-surface-raised"
      >
        Reload
      </button>
    </div>
  )
}
