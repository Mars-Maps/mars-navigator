import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Panel } from '../../../components/Panel'
import { PanelHeader } from '../../../components/PanelHeader'
import { useMinimized } from '../../../components/useMinimized'
import { formatMarsCoordinate, type MarsCoordinate, type SurfacePoint } from '../../../domain'
import { MARKER_DESCRIPTION_MAX, useMissionStore } from '../../../state'
import { cancelOnEscape } from './cancelOnEscape'
import { rightClickUnmarks } from './markerRightClick'

/** The list as the Marked points tool's panel, wired to the store. */
export function MarkedPoints() {
  const markers = useMissionStore((s) => s.markers)
  const requestCenter = useMissionStore((s) => s.requestCenter)
  const unmarkPoint = useMissionStore((s) => s.unmarkPoint)
  const describePoint = useMissionStore((s) => s.describePoint)
  const setPoint = useMissionStore((s) => s.setPoint)
  return (
    <MarkedPointsView
      markers={markers}
      onGoTo={requestCenter}
      onSetPoint={setPoint}
      onUnmark={unmarkPoint}
      onDescribe={describePoint}
    />
  )
}

/**
 * The marked-points list: every point flagged with "Mark point", in
 * the order it was marked. Go to centres the view on it, Set point selects
 * it as the right-click menu's Set point does (into the route, and its
 * details in the point menu), Unmark (or a
 * right-click on the row, outside its controls) removes it and its pin,
 * Edit changes its description. Set point, Unmark and Edit show only when their
 * handler is given. The
 * description is the user's own text, shown as text and never as data.
 */
export function MarkedPointsView({
  markers,
  onGoTo,
  onSetPoint,
  onUnmark,
  onDescribe,
}: {
  markers: readonly SurfacePoint[]
  onGoTo: (coordinate: MarsCoordinate) => void
  /** `anchor` is where a Start here / End here chooser opens: under the button. */
  onSetPoint?: (coordinate: MarsCoordinate, anchor: { x: number; y: number }) => void
  onUnmark?: (id: string) => void
  onDescribe?: (id: string, description: string) => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const list = useRef<HTMLUListElement>(null)
  const lastEditedId = useRef<string | null>(null)
  const { minimized, toggle, bodyId } = useMinimized()

  // Leaving the editor, by Save, Cancel or Escape, returns focus to the
  // row's Edit, as the context menu returns it to Mark point; the
  // editor unmounts with focus in it, which would drop focus to the page.
  // A row unmarked meanwhile has no Edit, and focus is left alone.
  useEffect(() => {
    const ended = editingId === null ? lastEditedId.current : null
    lastEditedId.current = editingId
    if (ended === null) return
    list.current
      ?.querySelector<HTMLElement>(`[data-marker="${CSS.escape(ended)}"] [data-focus="edit-description"]`)
      ?.focus()
  }, [editingId])

  return (
    <Panel
      surface="glass"
      compact={minimized}
      className="max-h-[calc(100vh-10rem)] w-full overflow-y-auto"
    >
      {/* The count stays on the bar while the list is minimised. */}
      {/* Minimising ends an open edit, as Cancel does: the editor would
          otherwise drop the typed text unseen and take focus on restore. */}
      <PanelHeader
        title="Marked points"
        minimized={minimized}
        onToggleMinimized={() => {
          if (!minimized) setEditingId(null)
          toggle()
        }}
        bodyId={bodyId}
        spacing="mb-3"
      >
        <h2 className="text-heading font-semibold text-ink">
          Marked points{markers.length > 0 && <span className="text-ink-subtle"> · {markers.length}</span>}
        </h2>
      </PanelHeader>
      {minimized ? null : markers.length === 0 ? (
        <p id={bodyId} className="text-caption text-ink-subtle">
          No marked points. Right-click the surface and choose Mark point.
        </p>
      ) : (
        <ul id={bodyId} ref={list} className="flex flex-col gap-2">
          {markers.map((m) => (
            <li
              key={m.id}
              data-marker={m.id}
              onContextMenu={
                onUnmark &&
                ((e) => {
                  const target = e.target instanceof Element ? e.target : null
                  if (!rightClickUnmarks(target, editingId === m.id)) return
                  e.preventDefault()
                  onUnmark(m.id)
                })
              }
              className="rounded-control border border-line/60 px-3 py-2"
            >
              {onDescribe && editingId === m.id ? (
                <DescriptionEditor
                  initial={m.label ?? ''}
                  onSave={(text) => {
                    onDescribe(m.id, text)
                    setEditingId(null)
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <MarkerRow
                  marker={m}
                  onGoTo={() => onGoTo(m.coordinate)}
                  onSetPoint={onSetPoint && ((anchor) => onSetPoint(m.coordinate, anchor))}
                  onEdit={onDescribe && (() => setEditingId(m.id))}
                  onUnmark={onUnmark && (() => onUnmark(m.id))}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function MarkerRow({
  marker,
  onGoTo,
  onSetPoint,
  onEdit,
  onUnmark,
}: {
  marker: SurfacePoint
  onGoTo: () => void
  onSetPoint?: (anchor: { x: number; y: number }) => void
  onEdit?: () => void
  onUnmark?: () => void
}) {
  const name = marker.label ?? 'Unnamed point'
  return (
    <>
      {marker.label ? (
        <p className="break-words text-body text-ink">{marker.label}</p>
      ) : (
        <p className="text-body italic text-ink-subtle">Unnamed point</p>
      )}
      <p className="text-caption tabular-nums text-ink-muted">{formatMarsCoordinate(marker.coordinate)}</p>
      <div className="mt-1.5 flex gap-1">
        <RowAction label={`Go to ${name}`} onClick={onGoTo}>
          Go to
        </RowAction>
        {onSetPoint && (
          <RowAction
            label={`Set point at ${name}`}
            onClick={(e) => {
              const box = e.currentTarget.getBoundingClientRect()
              onSetPoint({ x: box.left, y: box.bottom })
            }}
          >
            Set point
          </RowAction>
        )}
        {onEdit && (
          <RowAction label={`Edit description of ${name}`} focusKey="edit-description" onClick={onEdit}>
            Edit
          </RowAction>
        )}
        {onUnmark && (
          <RowAction label={`Unmark ${name}`} onClick={onUnmark}>
            Unmark
          </RowAction>
        )}
      </div>
    </>
  )
}

/**
 * The optional description of a marked point: here to edit one, and in the
 * context menu's Mark point step. Escape cancels only this edit, so
 * the list or menu around it stays open, wherever focus is in the form: the
 * field or either button.
 */
export function DescriptionEditor({
  initial,
  submitLabel = 'Save',
  onSave,
  onCancel,
}: {
  initial: string
  submitLabel?: string
  onSave: (text: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(initial)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSave(text)
      }}
      onKeyDown={cancelOnEscape(onCancel)}
    >
      <label className="mb-1 block text-micro uppercase text-ink-subtle">
        Description
        <input
          type="text"
          value={text}
          maxLength={MARKER_DESCRIPTION_MAX}
          autoFocus
          autoComplete="off"
          placeholder="Optional"
          onChange={(e) => setText(e.target.value)}
          className="mt-1 block w-full rounded-control border border-line bg-surface px-3 py-2 text-body normal-case text-ink placeholder:text-ink-subtle"
        />
      </label>
      <div className="mt-1.5 flex gap-1">
        <button
          type="submit"
          className="rounded-control bg-accent/15 px-2 py-1 text-caption text-accent transition-colors duration-(--duration-fast) hover:bg-accent/25"
        >
          {submitLabel}
        </button>
        <RowAction label="Cancel editing" onClick={onCancel}>
          Cancel
        </RowAction>
      </div>
    </form>
  )
}

function RowAction({
  label,
  focusKey,
  onClick,
  children,
}: {
  label: string
  /** `data-focus`, for a control focus is sent back to. */
  focusKey?: string
  onClick: (e: MouseEvent<HTMLButtonElement>) => void
  children: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      data-focus={focusKey}
      onClick={onClick}
      className="rounded-control px-2 py-1 text-caption text-ink-muted transition-colors duration-(--duration-fast) hover:bg-surface-raised hover:text-ink"
    >
      {children}
    </button>
  )
}
