import type { ReactNode } from 'react'

const SURFACES = {
  /** Default. Opaque; use for anything dense with data. */
  solid: 'bg-surface border-line',
  /** Translucent; only for panels floating over the 3D view. */
  glass: 'bg-surface/70 border-line/60 backdrop-blur-glass',
} as const

/** The base surface every panel is built on. */
export function Panel({
  surface = 'solid',
  compact = false,
  className = '',
  children,
}: {
  surface?: keyof typeof SURFACES
  /** Tighter padding, for panels that share a column, as in navigation. */
  compact?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <section
      className={`rounded-panel border shadow-panel ${compact ? 'p-4' : 'p-6'} ${SURFACES[surface]} ${className}`}
    >
      {children}
    </section>
  )
}
