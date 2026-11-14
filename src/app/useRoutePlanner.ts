import { useCallback, useEffect, useRef } from 'react'
import type { RouteRequest } from '../domain'
import type { RouteTerrain } from '../features/route-analysis/strategies/types'
import { useMissionStore } from '../state'
import { planRouteOnTerrain, planRouteOptions } from './planRoute'

/**
 * Plans a route in two steps: navigation starts at once on the
 * answers every strategy gives from the request alone, then the options
 * are replaced when the terrain searches finish. A new request cancels a
 * search still running, and an answer to a cancelled request never lands.
 */
export function useRoutePlanner(terrain: RouteTerrain): (request: RouteRequest) => void {
  const running = useRef<AbortController | null>(null)
  useEffect(() => () => running.current?.abort(), [])
  return useCallback(
    (request: RouteRequest) => {
      running.current?.abort()
      const controller = new AbortController()
      running.current = controller
      const { startNavigation, replaceRouteOptions } = useMissionStore.getState()
      startNavigation(planRouteOptions(request))
      // Refused (not in close-up): nothing to replace, so no search.
      if (useMissionStore.getState().viewMode !== 'navigation') return
      planRouteOnTerrain(request, terrain, controller.signal)
        .then((options) => {
          if (!controller.signal.aborted) replaceRouteOptions(options)
        })
        .catch((e: unknown) => console.error('Route planning failed', e))
    },
    [terrain],
  )
}
