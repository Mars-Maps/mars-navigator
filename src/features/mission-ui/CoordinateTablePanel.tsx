import { useEffect, useRef, useState } from 'react'
import { ClassificationBadge } from '../../components/ClassificationBadge'
import { Panel } from '../../components/Panel'
import { PanelHeader } from '../../components/PanelHeader'
import { useMinimized } from '../../components/useMinimized'
import type { MarsCoordinate } from '../../domain'
import { copyText } from '../../lib/clipboard'
import { useMissionStore, type CoordinateTableState } from '../../state'
import {
  TABLE_METHOD,
  TABLE_PRECISION_NOTE,
  TABLE_TYPED_METHOD,
  coordinateRows,
} from './coordinateTable'
import { useEscapeLayer } from '../../lib/useEscapeLayer'

type CopyState = 'idle' | 'copied' | 'failed'

/** How long "Copied" or "Copy failed" shows before the button reads "Copy" again. */
const COPY_FEEDBACK_MS = 2000

/**
 * The coordinate table's slot content: the panel for the point the store
 * holds, or nothing while it is closed, so the slot stays empty and hides
 * rather than showing the layout's placeholder.
 */
export function CoordinateTable() {
  const table = useMissionStore((s) => s.coordinateTable)
  const close = useMissionStore((s) => s.closeCoordinateTable)
  if (!table) return null
  const { point, source } = table
  // A new point is a new panel: the copy feedback starts over.
  return (
    <CoordinateTablePanel
      key={`${point.latitude},${point.longitudeEast},${source}`}
      coordinate={point}
      source={source}
      onClose={close}
    />
  )
}

/**
 * The menu's point in full: planetocentric latitude, longitude
 * 0–360 °E and ±180, and the copyable form. A picked point is DERIVED from
 * the pick ray, with the method and the precision note; a typed one is the
 * user's own entry, so it carries no mark and says where it came
 * from. Opened from the context menu; closed from there,
 * its × or Escape. Takes the point, source and close action as props, so
 * the shell decides where it sits and a test renders it without the store.
 */
export function CoordinateTablePanel({
  coordinate,
  source,
  onClose,
}: {
  coordinate: MarsCoordinate
  source: CoordinateTableState['source']
  onClose: () => void
}) {
  const picked = source === 'pick'
  const rows = coordinateRows(coordinate)
  const [copy, setCopy] = useState<CopyState>('idle')
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { minimized, toggle, bodyId } = useMinimized()

  // Escape closes it when it is the top layer.
  useEscapeLayer(true, onClose)

  useEffect(
    () => () => {
      if (reset.current !== null) clearTimeout(reset.current)
    },
    [],
  )

  const onCopy = async () => {
    const ok = await copyText(rows.copyable)
    setCopy(ok ? 'copied' : 'failed')
    if (reset.current !== null) clearTimeout(reset.current)
    reset.current = setTimeout(() => setCopy('idle'), COPY_FEEDBACK_MS)
  }

  return (
    <Panel surface="glass" compact={minimized} className="w-full">
      <PanelHeader
        title="Coordinate table"
        minimized={minimized}
        onToggleMinimized={toggle}
        bodyId={bodyId}
        onClose={onClose}
        spacing="mb-3"
      >
        <h2 className="text-heading font-semibold text-ink">Coordinate table</h2>
      </PanelHeader>
      {!minimized && (
        <div id={bodyId}>
          <dl
            className={`grid ${picked ? 'grid-cols-[auto_1fr_auto]' : 'grid-cols-[auto_1fr]'} items-center gap-x-3 gap-y-2 text-body`}
          >
            <Row label="Latitude (planetocentric)" value={rows.latitude} derived={picked} />
            <Row label="Longitude 0–360 °E" value={rows.longitudeEast} derived={picked} />
            <Row label="Longitude ±180" value={rows.longitudeSigned} derived={picked} />
          </dl>
          <div className="mt-3 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-control border border-line/60 px-2 py-1 text-body tabular-nums text-ink">
              {rows.copyable}
            </code>
            <button
              type="button"
              onClick={() => void onCopy()}
              className="shrink-0 rounded-control border border-line px-2 py-1 text-caption text-ink-muted transition-colors duration-(--duration-fast) hover:bg-surface-raised hover:text-ink focus-visible:bg-surface-raised focus-visible:text-ink"
            >
              Copy
            </button>
          </div>
          <p role="status" className="mt-1 h-4 text-caption text-ink-subtle">
            {copy === 'copied' && 'Copied. Pastes into the search bar.'}
            {copy === 'failed' && <span className="text-danger">Copy failed: the browser refused the clipboard.</span>}
          </p>
          <p className="mt-2 text-caption text-ink-subtle">{picked ? TABLE_METHOD : TABLE_TYPED_METHOD}.</p>
          {picked && <p className="mt-1 text-caption text-ink-subtle">{TABLE_PRECISION_NOTE}</p>}
        </div>
      )}
    </Panel>
  )
}

/** `derived`: the DERIVED mark, its method in the mark's own tooltip. */
function Row({ label, value, derived }: { label: string; value: string; derived: boolean }) {
  return (
    <>
      <dt className="text-ink-subtle">{label}</dt>
      <dd className="tabular-nums text-ink">{value}</dd>
      {derived && (
        <dd>
          <ClassificationBadge classification="DERIVED" detail={TABLE_METHOD} />
        </dd>
      )}
    </>
  )
}
