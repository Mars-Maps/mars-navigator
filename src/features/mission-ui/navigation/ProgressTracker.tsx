import { unavailable, type Classified, type RouteOption } from '../../../domain'
import { Panel } from '../../../components/Panel'
import { PanelHeader } from '../../../components/PanelHeader'
import { useMinimized } from '../../../components/useMinimized'
import { ClassifiedValue } from '../ClassifiedValue'

/**
 * Nothing reports where the user is along the route yet, so progress cannot
 * be known. Shown as unavailable rather than as 0 km travelled.
 */
const NO_POSITION = 'Live position not tracked yet'
const TRAVELLED: Classified<number> = unavailable(NO_POSITION)
const REMAINING: Classified<number> = unavailable(NO_POSITION)

const formatKm = (km: number) => `${km.toFixed(2)} km`

/**
 * How far along the route the user is. From and To are not repeated here:
 * the read-only route line at the top of the column shows them.
 */
export function ProgressTracker({ route }: { route: RouteOption | null }) {
  const { minimized, toggle, bodyId } = useMinimized()
  return (
    <Panel surface="glass" compact>
      <PanelHeader
        title="Progress"
        minimized={minimized}
        onToggleMinimized={toggle}
        bodyId={bodyId}
        spacing="mb-1"
      >
        <h2 className="text-body font-semibold text-ink">Progress</h2>
      </PanelHeader>
      {minimized ? null : route ? (
        <dl id={bodyId} className="grid grid-cols-2 gap-x-3">
          <div>
            <dt className="text-caption text-ink-subtle">Travelled</dt>
            <dd className="text-body">
              <ClassifiedValue value={TRAVELLED} format={formatKm} />
            </dd>
          </div>
          <div>
            <dt className="text-caption text-ink-subtle">Remaining</dt>
            <dd className="text-body">
              <ClassifiedValue value={REMAINING} format={formatKm} />
            </dd>
          </div>
        </dl>
      ) : (
        <p id={bodyId} className="text-body text-ink-muted">
          No route planned
        </p>
      )}
    </Panel>
  )
}
