import { useCallback, useEffect, useRef } from 'react'
import type { RouteRequest, RouteStrategy } from '../domain'
import type { RouteTerrain } from '../features/route-analysis/strategies/types'
import { useMissionStore } from '../state'
import { planRouteOnTerrain, planRouteOptions } from './planRoute'

/**
 * Plans a route in two steps: navigation starts at once on the
 * answers every strategy gives from the request alone, then the options
 * are replaced when the terrain searches finish. A new request cancels a
 * search still running, and an answer to a cancelled request never lands.
 * `strategies` narrows the options offered; without it, every strategy.
 */
export function useRoutePlanner(terrain: RouteTerrain): (request: RouteRequest, strategies?: readonly RouteStrategy[]) => void {
  const running = useRef<AbortController | null>(null)
  useEffect(() => () => running.current?.abort(), [])
  return useCallback(
    (request: RouteRequest, strategies?: readonly RouteStrategy[]) => {
      running.current?.abort()
      const controller = new AbortController()
      running.current = controller
      const { startNavigation, replaceRouteOptions } = useMissionStore.getState()
      startNavigation(planRouteOptions(request, strategies))
      // Refused (not in close-up): nothing to replace, so no search.
      if (useMissionStore.getState().viewMode !== 'navigation') return
      planRouteOnTerrain(request, terrain, controller.signal, strategies)
        .then((options) => {
          if (!controller.signal.aborted) replaceRouteOptions(options)
        })
        .catch((e: unknown) => console.error('Route planning failed', e))
    },
    [terrain],
  )
}
