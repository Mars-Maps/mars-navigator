import type { RoverTraverse } from '../../domain'
import { ClassificationBadge } from '../../components/ClassificationBadge'
import { useMissionStore } from '../../state'
import type { TraverseHover } from './RoverTraverseOverlay'
import { SolSlider } from './SolSlider'
import { ROVER_NAME } from './traverseLabel'
import { solSliderShown } from './traverseSols'

/**
 * The slider and the sol of the waypoint under the pointer, over the
 * globe's canvas. The sol shows above the pointer, clear of the coordinate
 * readout that follows it below. Nothing shows for an empty traverse. The
 * slider gives way to the welcome globe, hidden tools and open tool panels.
 */
export function TraverseControls({
  traverse,
  range,
  sol,
  onSol,
  hover,
}: {
  traverse: RoverTraverse
  range: { first: number; last: number } | null
  sol: number | null
  onSol: (sol: number) => void
  hover: TraverseHover | null
}) {
  const sliderShown = useMissionStore((s) => solSliderShown(s.viewMode, s.toolsHidden, s.activeToolId))
  if (range === null || sol === null) return null
  return (
    <>
      {/* Above the shell's tool dock, which sits centred at the bottom. */}
      {sliderShown && (
        <div className="pointer-events-none absolute inset-x-0 bottom-20 flex justify-center">
          <SolSlider
            first={range.first}
            last={range.last}
            value={sol}
            roverName={ROVER_NAME[traverse.rover]}
            source={traverse.source}
            onChange={onSol}
          />
        </div>
      )}
      {hover && (
        <p
          className="pointer-events-none absolute flex items-center gap-1.5 rounded-control border border-line/60 bg-surface/80 px-2 py-1 text-caption text-ink backdrop-blur-glass"
          style={{ left: hover.x + 12, top: hover.y - 36 }}
        >
          {ROVER_NAME[traverse.rover]} waypoint, sol {hover.point.sol}, site {hover.point.rmc.site}{' '}
          drive {hover.point.rmc.drive}
          <ClassificationBadge classification="OFFICIAL" detail={traverse.source} passive />
        </p>
      )}
    </>
  )
}
