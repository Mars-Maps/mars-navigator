# Architecture

## Data flow

Mars Navigator follows a layered architecture designed to separate external scientific data, internal domain models, analytical calculations and visual presentation.

Information moves through the application in a defined direction. External datasets are first processed by adapters that interpret their formats, validate their contents, classify their provenance and convert units or coordinate conventions where required.

Once the data has been normalized, the remaining application layers can use it without depending on the original source format. This separation allows the analytical and visualization components to operate through consistent internal interfaces.

The following diagram illustrates how information moves between the main architectural layers:

```
EXTERNAL DATA        tile services, GeoTIFFs, feature services, JSON feeds,
      │              committed grids and extracts, mock data
      ▼
src/data/adapters/   parse, validate, classify, convert units and conventions
      │
      ▼
src/domain/          normalized, format-agnostic model
      │
      ▼
src/features/route-analysis/     calculations: routes, slopes, hazards, models
      │
      ▼
src/features/mars-3d/            the globe and the surface view
src/features/mission-ui/         panels, tools and the HUD
```
### Application composition

The `src/app/` directory serves as the application's composition root. It connects external data adapters with the analytical and visual features that consume their results.

This layer is responsible for invoking adapters, passing normalised information into route-analysis functions and supplying the resulting data to interface components through props or shared state.

Individual features do not directly retrieve or interpret external scientific formats. Instead, they declare the information they require through component properties or interfaces.

For example, the surface elevation interface in `mars-3d` defines the data needed for surface visualization, while the application shell supplies the corresponding implementation.

This arrangement keeps data acquisition, scientific calculations and visual presentation separate, making the project easier to maintain and extend.

## Import rules

`scripts/check-architecture.mjs` (`npm run check:arch`, also run in CI)
scans every import under `src/` and fails on a violation.

| Rule | Reason |
|---|---|
| `src/features/**` must not import `src/data/**` | The interface stays independent of external formats |
| `src/features/**` must not import `src/app/**` | The shell composes features, never the reverse |
| `src/domain/**` must not import `features` or `data` | The model is a leaf |
| `src/state/**` imports only `src/domain/` | Shared state knows nothing about who reads it |
| `src/lib/**` must not import `domain`, `state`, `features` or `data` | Helpers stay generic |

Two conventions the script does not check: only `src/data/adapters/**`
parses raw external formats, and features do not reach into each other's
internals more than necessary. What two features share belongs in `domain`,
`state`, `lib` or `components`.

## Data classification

Every value that could be unknown is a `Classified<T>`
(`src/domain/classification.ts`). The type has no variant without
provenance, so a number cannot be read without first handling the case where
it does not exist.

| Class | Carries | Meaning | In the interface |
|---|---|---|---|
| `OFFICIAL` | `value`, `source` | Directly from an official dataset | Shown normally; the mark's tooltip gives the citation |
| `DERIVED` | `value`, `method` | Calculated from other data | Marked as derived; the tooltip states the method |
| `SIMULATED` | `value`, `source` | Invented for demonstration | Always visibly labelled as simulated |
| `UNAVAILABLE` | `reason` | Not known | Shown as unavailable with the reason, never as `0`, a blank or a guess |

Helpers: `official()`, `derived()`, `simulated()`, `unavailable()`,
`isAvailable()`, `valueOr()`. In the interface, `ClassificationBadge`
(`src/components/`) and `ClassifiedValue` (`mission-ui`) render the mark; the
source, method or reason is always in the DOM and shows on hover or focus.
The classification colours in `src/index.css` are used for provenance only.
A corner label and the surface caption keep what is simulated on screen
(the globe's spin speed, the surface view's look) named at all times, even
under "Hide all tools".

A figure built on a simulated input is itself shown as simulated, and one
whose input is unavailable is unavailable: classification never improves
on the way up.

## State

Shared interface state lives in `src/state/` as Zustand stores, re-exported
from `src/state/index.ts`. Read with a selector
(`useMissionStore((s) => s.viewMode)`) so a component re-renders only for
its own slice.

| Store / file | Holds |
|---|---|
| `missionStore.ts` | View mode, selected point, route draft and options, active route, layers and active layer, surface image, active tool, visibility toggles |
| `viewMode.ts`, `transitions.ts` | The view modes (`welcome`, `close-up`, `navigation`, `surface`) and the allowed moves between them |
| `missionTime.ts` | The mission clock: one UTC instant, running or paused |
| `walkPlan.ts` | The planned walk and the active stop |
| `routeDraft.ts`, `routeFollow.ts`, `routePick.ts`, `routeHover.ts` | Route editing, following, picking a point for a field, chart hover |
| `markers.ts`, `measure.ts`, `terrainPoints.ts`, `coordinateTable.ts` | Marked points and the tools' own points |
| `thermalVariant.ts`, `layerLegends.ts`, `noData.ts` | Layer variants, legends and no-data notes |
| `site.ts`, `surfaceHeading.ts`, `unitHover.ts`, `hoverPrecision.ts` | The site in use and small pieces of cross-feature view state |

Smaller stores exist beside `missionStore.ts` mostly to keep each file under
the 500-line limit and each subscription narrow. State local to one
component stays in that component. Nothing is persisted between page loads
except a session-storage timestamp used to guard chunk reloads
(`src/main.tsx`) and, in local storage, where the user put the Terrain
Profile 3D plot's box (`src/app/terrainPlot/`); the app works the same when
storage is unavailable.

## Lazy loading and the first load

Three.js is large, so it is kept out of the first load:

- `src/app/App.tsx` loads `MarsGlobe` with `React.lazy`; the globe loads
  `SurfaceView` lazily in turn; the 3D terrain plot is a further chunk.
- Panels that show only in some modes or after a click (the navigation
  panels, the walk planner, the walk HUD and stop card, rover photos, the
  terrain profile panels, search, the coordinate table) are lazy too.
- Some non-UI code is imported dynamically on first use: the TES grids and
  temperature model (`tesGrids.ts`), the thermal grid layer, and the slope
  read (`useSelectedSlope.ts`).
- Each lazy part sits in its own error boundary and `Suspense` fallback
  (`ErrorBoundary.tsx`), so a failed chunk leaves the rest of the app
  working. `src/main.tsx` reloads the page once when a chunk from an older
  deploy is missing.

Consequence: any module that the shell or `mission-ui` imports statically
must not import `three`, directly or indirectly. Pure maths that the shell
needs from `mars-3d` lives in Three-free modules (for example
`wholeGlobeView.ts`, `framing.ts`).

`scripts/check-bundle.mjs` (`npm run check:bundle`, after a build) is the
guard: it follows the entry script, its `modulepreload` links and every
chunk they import statically, fails if any of them contains Three.js
(recognised by `WebGLRenderer`), and fails if together they exceed 500 kB.
Chunk contents are decided by the bundler, not by the import graph alone,
so check claims about the bundle by building.

## Three.js resource disposal

Geometries, materials, textures and render targets must be released when the
component that made them unmounts. Leaked GPU resources are the most likely
performance bug in this codebase.

- Prefer JSX-declared geometry and materials: React Three Fiber disposes
  them on unmount.
- Anything created imperatively (`new BufferGeometry()`, `new
  ShaderMaterial()`, a `CanvasTexture`, tile textures in a store) is disposed
  in the effect's cleanup or by the store that owns it (`tileStore.ts`,
  `mapTileStore.ts`).
- `PerfProbe.tsx` / `perfReport.ts` (open the app with `?perf`) report
  renderer memory and can cycle the scene to show that nothing grows while
  unmounted.

## Main modules

### `src/data/`

| Path | Role |
|---|---|
| `adapters/LayerAdapter.ts` | Base-layer images and detail tiles from Mars Trek WMTS, legends, coverage handling |
| `adapters/ElevationAdapter.ts`, `LayeredElevation.ts` | Heights by HTTP range request from USGS GeoTIFFs; a chain of models, finest first |
| `adapters/GeologyAdapter.ts`, `arcgisFeatures.ts` | Geologic units and mapped features from USGS ArcGIS feature services |
| `adapters/TraverseAdapter.ts` | Rover waypoints from the live NASA feeds |
| `adapters/RawImagesAdapter.ts` | Perseverance raw images by sol range |
| `adapters/ThermalGridAdapter.ts` | The committed TES thermal inertia and albedo grids |
| `adapters/PlaceNamesAdapter.ts` | The committed gazetteer of place names |
| `adapters/SiteAdapter.ts` | The landing ellipse of the site |
| `adapters/coordinates.ts` | The one place longitude conventions are converted |
| `adapters/DataAdapter.ts`, `MockDataAdapter.ts`, `NASADataAdapter.ts` | The generic dataset contract, its simulated implementation, and an unimplemented placeholder |
| `layers/`, `elevation/`, `geology/`, `traverse/`, `sites/`, `radiation/`, `temperature/`, `thermal/`, `constants/`, `places/` | Source descriptions (URLs, citations, licences, caveats) and committed data |
| `mock/` | Simulated datasets, labelled as such |

### `src/domain/`

`classification.ts` (provenance), `mars.ts` (coordinates: planetocentric
latitude, longitude 0–360° east), `route.ts`, `walk.ts`, `terrain.ts`
(hazards to a person on foot), `layers.ts`, `geology.ts`, `traverse.ts`,
`site.ts`, `surfaceImage.ts`, `temperature.ts`, `radiation.ts` (atmospheric
shielding relative to Gale, never a dose), `time.ts` and `mars24.ts` (Mars
solar time after the Mars24 algorithm).

### `src/features/route-analysis/`

Pure functions, no rendering. `strategies/` holds one `RoutingStrategy` per
route kind (`fastest`, `energyEfficient`, `scientific`, `shortest`) and the
registry the interface lists them from. `terrainSearch.ts` is the A* search
over the elevation model that the terrain strategies share; `walkingSpeed.ts`
and `metabolicCost.ts` are its cost models. `walkLegs.ts`, `hazards.ts`,
`mappedObstacles.ts`, `pointSlope.ts` and `profileSlope.ts` produce slopes
and hazards; `scienceGoals.ts` maps science goals to geologic units and
stops. Plan a walk's three walks are `flatBedrockWalk.ts`, `transectLine.ts`
with `transectWalk.ts` (rim to floor) and `roverCheckWalk.ts`;
`walkBudget.ts` costs a walk in time and energy, fits it to the mission
settings and places its samples; `landingFavourability.ts` and
`landingLattice.ts` rate the ground for a landing site; `elevationProfile.ts`, `terrainProfile.ts` and `terrainProfileGrid.ts`
sample heights; `thermalModel.ts`, `temperatureModel.ts` and
`temperatureLayer.ts` are the surface temperature estimate;
`atmosphericShielding.ts` applies the shielding rule; `photoPositions.ts`
places rover photos from the traverse.

### `src/features/mars-3d/`

`MarsGlobe.tsx` is the entry: the canvas, the globe mesh and its overlays.
`CameraController.tsx` with `cameraMath.ts` and `spinMath.ts` moves the view.
`SurfaceTiles.tsx`, `tilePyramid.ts` and `tileStore.ts` draw detail tiles.
Overlays: routes, the walk plan, the rover traverse, geology, the coordinate
grid, measure lines, the terrain region, the landing ellipse and site label.
`sky/` places the Sun, planets and moons; `SunLight.tsx` shades the globe.
`surfaceView/` is the first-person ground: a height field and imagery patch
(`surfacePatch.ts`, `groundPatch.ts`, `Ground.tsx`), simulated rocks, the
walker (`WalkDriver.tsx`, `moveMath.ts`) and the overhead map.
`terrainProfile/` is the 3D height plot.

### `src/features/mission-ui/`

`SearchBar.tsx` (route fields), `search/` (place search),
`PointMenu.tsx` and `pointFields.ts` (the selected point's values),
`LayerMenu.tsx`, `IconPanel.tsx`, `ContextMenu.tsx`, `TimeMenu.tsx` and
`time/`, `tools/` (the dock and every tool), `navigation/` (destination bar,
hazards, elevation profile, progress), `walk/`, `stops/`, `hud/`, `photos/`,
`radiation/` and `temperature/`.

### `src/app/`

`App.tsx` composes everything. `layout/slots.ts` lists every panel slot,
where it sits and which view modes show it; `layout/AppLayout.tsx` renders
the slots and takes the real panels through its `panels` prop. The `use*`
hooks and their plain modules (`elevation.ts`, `planRoute.ts`,
`walkPlanner.ts`, `surfaceLayers.ts`, `stopPhotos.ts`, `roverFeed.ts`, …) are
where adapters meet route-analysis. Plan a walk runs in `WalkPlannerPanel.tsx`:
`walkDrafts.ts` reads what each of the three walks needs (map units, the
rover traverse, the place names, heights) and `planWalks.ts` plans them side
by side, one failing never failing the others, and checks each plan against
the walk contract in `src/domain/walk.ts` before the store takes it. `viewModeTriggers.ts` decides when the
view mode changes.

## How to extend

### Add a data source (adapter)

1. Describe the source in `src/data/<area>/`: URL, citation, licence,
   caveats, resolution. A source that cannot be cited is not added.
2. Write the adapter in `src/data/adapters/`. It parses the external shape,
   validates at the boundary (reject or mark `UNAVAILABLE`, never coerce),
   converts longitude through `coordinates.ts`, and returns domain types
   wrapped in `Classified`. Take `fetch` or an I/O object as a parameter so
   tests can pass a fake.
3. If the domain cannot express the data, widen `src/domain/` minimally.
4. Call the adapter from `src/app/` (usually a small module plus a hook) and
   pass the result to features as props or through a store.
5. Add tests in `tests/unit/` for parsing, validation and coordinates, and
   record the source in `DATA_SOURCES.md`.

### Add a map layer

1. Add the id to `MapLayerId` in `src/domain/layers.ts`.
2. Add its entry to `LAYER_SOURCES` in `src/data/layers/layerSources.ts`. The
   record is keyed by `MapLayerId`, so a missing entry is a type error. Give
   the Trek layer name, tile host and format, `maxZoom`, `coverage`,
   `licence`, a `caveat` wherever the picture is not what it appears to be,
   and a `legend` (or the reason there is none).
3. `LayerAdapter` and `src/app/surfaceLayers.ts` / `useSurfaceLayers.ts` load
   it; the layer menu lists whatever is in the store. A layer drawn from a
   committed grid instead of tiles follows `src/data/thermal/thermalLayers.ts`
   and `src/app/thermalGridLayer.ts`.

### Add a tool

1. Define a `ToolDefinition` in its own file under
   `src/features/mission-ui/tools/` (see `measure.tsx`): `id`, `label`,
   `hint`, `icon`, and either a `Panel` component or `panelFromShell: true`
   when the panel needs something only the shell may compute.
2. Add it to `TOOL_REGISTRY` in `tools/registry.ts`. The dock renders the
   registry; the store holds only `activeToolId`.
3. For a shell-rendered panel, pass it to `ToolDock` through its `panels`
   prop in `App.tsx`, keyed by the tool's id.
4. If the scene must behave differently while the tool is active, compare
   `activeToolId` against the tool's id there.

### Add a routing strategy

Implement `RoutingStrategy` (`strategies/types.ts`) and add it to the
registry in `strategies/registry.ts`. `plan` answers immediately from the
request; `planOnTerrain` replaces that answer when a terrain search
finishes. Costs and limits must come from a cited source.

### Add a panel slot

Add the id to `SLOT_ORDER` and its spec to `SLOTS` in
`src/app/layout/slots.ts`, then pass the panel in `App.tsx`. A slot with no
panel shows a labelled placeholder; `null` draws nothing.
