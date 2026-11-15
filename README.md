# Mars Explorer

A desktop web map for planning and walking a route on the surface of Mars, at
Jezero crater. It opens on a 3D globe drawn from NASA Mars Trek imagery, with
four switchable base layers (satellite, elevation, thermal, geology), place
search, measuring and terrain-profile tools, and route planning between
points with distance, slope, hazard and metabolic-cost figures. Plan a walk
takes a landing site picked on a map coloured by how flat the ground is,
mission settings (max slope, samples, energy, duration), and plans three
scientific walks side by side: over the flat bedrock of the crater floor,
from a crater rim down to the floor across the geologic map's units, and to
the Perseverance rover's own waypoints. Each has its sample points, time and
energy against the settings. A walk is then followed in a first-person surface view built from official elevation
models and orbital imagery, with a heads-up display, stop cards and the
Perseverance rover's own photos nearby. Every value on screen is marked as
official, derived, simulated or unavailable, with its source or method.

## Tech stack

React 19 · TypeScript 6 · Vite 8 · Tailwind CSS 4 · Zustand 5 · Three.js with
React Three Fiber · oxlint · vitest. Node 24 (see `.nvmrc`).

## Quick start

```bash
npm ci
npm run dev
```

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server at http://localhost:5173 |
| `npm run build` | Type-check, then production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Unit and integration tests (vitest) |
| `npm run lint` | oxlint |
| `npm run typecheck` | TypeScript check of the app, the tests and the config |
| `npm run check:arch` | Verify the architecture import rules |
| `npm run check:bundle` | After `build`: Three.js stays out of the first load, which stays under 500 kB |
| `npm run datum-check` | One-off report: elevation models against the rovers' own heights (needs network) |

Before committing:

```bash
npm run typecheck && npm run lint && npm test && npm run build && npm run check:arch && npm run check:bundle
```

No environment variables are required. `.env.example` lists optional
placeholders; anything prefixed `VITE_` is public once bundled.

## Deployment

The app is a static single-page build. `wrangler.jsonc` describes a
static-assets-only Cloudflare Worker: it serves `./dist` and answers unknown
paths with `index.html`.

```bash
npm run build
npx wrangler deploy
```

Any static host works as long as unknown paths fall back to `index.html`.
The app fetches its map tiles, elevation, geology, rover paths and photos
from public NASA and USGS services at runtime, so the browser needs network
access to them (see `DATA_SOURCES.md`).

## Project structure

| Path | Contents |
|---|---|
| `src/app/` | App shell: composes features, wires adapters to them, lays out the panels |
| `src/components/` | Shared presentational components and the design-system note |
| `src/data/` | Adapters for external formats, source descriptions, committed datasets, mock data |
| `src/domain/` | Normalized, format-agnostic model and the classification types |
| `src/features/mars-3d/` | The globe, overlays, sky and the surface view (Three.js) |
| `src/features/mission-ui/` | Panels, tools, HUD, search and navigation interface |
| `src/features/route-analysis/` | Route search, slopes, hazards, walking and temperature models |
| `src/state/` | Shared interface state (Zustand stores) |
| `src/lib/` | Generic helpers with no domain knowledge |
| `tests/` | Unit tests, integration tests and fixtures |
| `scripts/` | Architecture and bundle checks, and the scripts that rebuild committed data |
| `public/` | Static assets |
| `.github/` | CI workflow |

## Documentation

- [`ARCHITECTURE.md`](ARCHITECTURE.md): layers, import rules, state, lazy loading, how to extend
- [`DATA_SOURCES.md`](DATA_SOURCES.md): every external dataset and service, with credits and licences
- [`DEVELOPMENT.md`](DEVELOPMENT.md): conventions, testing notes and gotchas
- [`src/components/README.md`](src/components/README.md): design-system usage

## Scientific integrity

All data values are classified as `OFFICIAL`, `DERIVED`, `SIMULATED` or
`UNAVAILABLE`. Simulated data is always labelled as such in the interface,
and an unknown value is shown as unavailable, never as zero or a guess.
