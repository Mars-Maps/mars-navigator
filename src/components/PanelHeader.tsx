import type { ReactNode } from 'react'

/**
 * A window's title bar: the window's own heading on the left, its
 * controls in the top-right corner. Every window can be minimised to this
 * bar and opened again; a window that can also be closed here passes
 * `onClose`. Windows opened by a button elsewhere (the layer menu, the tool
 * panels) take no ×: that button closes them.
 *
 * Presentational: the window keeps `minimized` (`useMinimized`) and hides
 * its own body, the element named by `bodyId`, so the button can say what
 * it controls while it shows. The button says "Restore", not "Expand": the
 * context menu's "Expand coordinate table" already means "open".
 */
export function PanelHeader({
  title,
  minimized,
  onToggleMinimized,
  bodyId,
  onClose,
  spacing = '',
  className = '',
  children,
}: {
  /** The window's heading, for the buttons' labels: "Minimise Hazards". */
  title: string
  minimized: boolean
  onToggleMinimized: () => void
  /** The id of the body this bar hides. */
  bodyId: string
  /** Closes the window. Omit for a window opened and closed from elsewhere. */
  onClose?: () => void
  /** The gap below the bar while the body shows, e.g. `mb-3`; none when minimised. */
  spacing?: string
  className?: string
  /** The heading, and anything that stays on the bar's line while minimised. */
  children: ReactNode
}) {
  return (
    <div className={`flex items-start justify-between gap-2 ${minimized ? '' : spacing} ${className}`}>
      {/* Grows, so a heading row's own right-hand control (End navigation)
          stays in the corner beside these. */}
      <div className="min-w-0 flex-1">{children}</div>
      <div className="-mr-1 -mt-0.5 flex shrink-0 items-center">
        <ControlButton
          label={`${minimized ? 'Restore' : 'Minimise'} ${title}`}
          expanded={!minimized}
          // Only while the body is there to name, as IconPanel does.
          controls={minimized ? undefined : bodyId}
          onClick={onToggleMinimized}
        >
          {minimized ? <path d="M12 6v12M6 12h12" /> : <path d="M6 12h12" />}
        </ControlButton>
        {onClose && (
          <ControlButton label={`Close ${title}`} onClick={onClose}>
            <path d="m7 7 10 10M17 7 7 17" />
          </ControlButton>
        )}
      </div>
    </div>
  )
}

function ControlButton({
  label,
  expanded,
  controls,
  onClick,
  children,
}: {
  label: string
  expanded?: boolean
  controls?: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onClick}
      className="flex size-6 items-center justify-center rounded-control text-ink-subtle transition-colors duration-(--duration-fast) hover:bg-surface-raised hover:text-ink focus-visible:text-ink"
    >
      <svg
        viewBox="0 0 24 24"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        aria-hidden="true"
      >
        {children}
      </svg>
    </button>
  )
}
