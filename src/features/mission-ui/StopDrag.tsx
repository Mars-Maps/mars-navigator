import type { DragEvent } from 'react'

/**
 * The grip a stop is dragged by. Mouse only and out of the tab
 * order: the ↑ ↓ buttons are the keyboard way to reorder. `hidden` keeps
 * its width with a single stop, so the row does not shift when a second
 * is added.
 */
export function DragHandle({
  hidden,
  onDragStart,
  onDragEnd,
}: {
  hidden: boolean
  onDragStart: (e: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
}) {
  return (
    <span
      draggable={!hidden}
      aria-hidden="true"
      title={hidden ? undefined : 'Drag to reorder'}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`flex h-9 w-4 shrink-0 cursor-grab items-center justify-center text-ink-subtle transition-colors duration-(--duration-fast) hover:text-ink active:cursor-grabbing ${
        hidden ? 'invisible' : ''
      }`}
    >
      <svg viewBox="0 0 8 14" className="h-3.5 w-2" fill="currentColor">
        <circle cx="2" cy="2" r="1.2" />
        <circle cx="6" cy="2" r="1.2" />
        <circle cx="2" cy="7" r="1.2" />
        <circle cx="6" cy="7" r="1.2" />
        <circle cx="2" cy="12" r="1.2" />
        <circle cx="6" cy="12" r="1.2" />
      </svg>
    </span>
  )
}

/** Where a dragged stop would land: centred in the 8 px gap between rows. */
export function DropLine({ edge }: { edge: 'top' | 'bottom' }) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-accent ${
        edge === 'top' ? '-top-[5px]' : '-bottom-[5px]'
      }`}
    />
  )
}
