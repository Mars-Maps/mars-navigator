# Development notes

## Checks

```bash
npm run typecheck    # tsc -b: the app, the tests and the config files
npm run lint         # oxlint
npm test             # vitest run
npm run build        # tsc -b && vite build
npm run check:arch   # import rules (see ARCHITECTURE.md)
npm run check:bundle # after build: first load is Three-free and under 500 kB
```

CI (`.github/workflows/ci.yml`) runs the same steps, plus a guard that no
`.env` or key file is tracked.

## Conventions

- **TypeScript, strict.** `noUnusedLocals`, `noUnusedParameters`,
  `verbatimModuleSyntax` and `erasableSyntaxOnly` are on (no enums or
  parameter properties; use `import type` for types). No `any` without a
  comment saying why, and no `@ts-ignore` without a reason.
- **Files stay under 500 lines.** When a file approaches the limit, move a
  coherent part out (pure maths into a `*Math.ts`, a sub-store into its own
  file) rather than raising the limit.
- **Validate at the boundary.** Adapters check the shape of everything they
  read and reject or mark `UNAVAILABLE`; they never coerce silently. Code
  above the adapters trusts domain types.
- **Classify every value.** Anything that might be unknown is a
  `Classified<T>`. Never show `0`, an empty string or a guess in place of an
  unavailable value. Simulated values are labelled in the interface.
- **Cite sources in code.** A constant, threshold or model coefficient
  carries its source next to it. A value that is this app's own choice says
  so ("a project choice") in the text the user can read.
- **Shown text carries no tracker references.** Method and source lines are
  read by users, so they contain citations, not internal numbers; several
  tests assert this (`tests/unit/shownTextNumbers.test.ts`).
- **Pure logic apart from rendering.** Calculations live in plain modules
  (`cameraMath.ts`, `hudMath.ts`, `stopCardMath.ts`, …) that components call,
  so they can be tested without WebGL or a DOM.
- **Coordinates.** Internally: planetocentric latitude, longitude degrees
  east 0–360. Sources use ±180° or −360 to +360; only
  `src/data/adapters/coordinates.ts` converts. Nothing is clamped or wrapped
  silently.
- **Design tokens.** Components use the semantic utilities generated from
  `src/index.css`, never raw palette classes or hex values; see
  `src/components/README.md`.
- **Three.js resources are disposed on unmount**, and Three stays out of
  anything the first load imports statically (see ARCHITECTURE.md).
- **Simple over speculative.** Read the existing implementation before
  adding a new one; match the surrounding style.
- **No new dependencies without a reason**: what it replaces, its size and
  its maintenance status.

## Testing

Mars Navigator uses automated testing to verify scientific calculations, application logic, data adapters and the handling of external datasets.

Tests are located in the `tests/` directory and run with Vitest in a Node.js environment. The test suite is organized into unit tests, integration tests and shared fixtures.

### Testing structure

- `tests/unit/` contains focused tests for individual functions, calculations and modules.
- `tests/integration/` verifies interactions between components of the application's logic and data processing.
- `tests/fixtures/` provides representative data records used to test adapters and calculations without relying on live external services.

The `tsconfig.test.json` configuration applies TypeScript checking to the tests using the application's rules.

### What is tested

Automated tests focus on calculations, routing algorithms, data validation, coordinate conversion, scientific models and data adapters.

WebGL rendering is primarily reviewed manually because the test environment does not provide a browser or WebGL context. Regression tests are introduced where a specific issue justifies additional automated coverage.

### Component testing

Component tests use React's `renderToStaticMarkup` to examine generated HTML.

During server-side rendering, components using Zustand hooks observe their initial store state. Effects are not executed, and changing a store before rendering does not reliably place a component into another application mode.

Mode-dependent behaviour is therefore tested through pure functions or inner components receiving explicit properties.

### Testing external data adapters

Adapters receive their input/output dependencies through parameters, such as a fetch-compatible function or an I/O object.

Tests replace these dependencies with controlled implementations that record requested URLs and return predefined fixtures.

This allows the application to verify data-processing behaviour without making network requests.

### Scientific fixtures and data validation

Test fixtures are based on trimmed responses from actual data services. They retain the fields required by the adapters and record when the original responses were obtained.

Invalid or incomplete records are derived from these fixtures to verify how the application handles unexpected data.

Committed scientific datasets, including MEDA extracts, TES grids and planetary place names, are also checked through automated tests.

### Scientific model validation

The surface temperature model is evaluated against measurements from the two rover locations described in the project.

The corresponding test fails when the model exceeds its documented error tolerance.

### State management testing

Zustand stores are tested directly through their `getState()` and `setState()` interfaces.

Test names should describe the behaviour being verified in clear sentences, making failures easier to interpret during development and review.

## Gotchas

- **Chunk contents come from a build, not the import graph.** The bundler
  may move a module into a shared preloaded chunk. Verify any claim about
  what the first load contains with `npm run build && npm run check:bundle`.
  The first load is close to its 500 kB limit, so a new static import into
  the shell or `mission-ui` can tip it over; lazy-load instead.
- **A static import of anything that reaches `three` from `src/app/` or
  `mission-ui` puts all of Three.js in the first load.** Nothing else
  fails; only `check:bundle` notices.
- **`lazy()` caches a rejected import.** Retrying a failed chunk is a page
  reload, not a re-render (`ErrorBoundary.tsx`). After a deploy, a tab that
  still runs the old build asks for chunk names that no longer exist;
  `src/main.tsx` reloads once for that, at most once a minute.
- **Range requests carry the byte range in the URL query as well as the
  `Range` header** (`ElevationAdapter.ts`). Chrome serialises concurrent
  requests to one URL through its HTTP cache lock, which would make parallel
  reads of one GeoTIFF run one at a time; the storage host ignores the query.
- **Mars Trek answers 404 for tiles outside a product's coverage**, not an
  empty tile. The adapter treats rows outside the stated coverage as
  transparent and anything else as a failure.
- **Trek tile rows count from the north**, and the equirectangular tile
  matrix is two tiles wide at zoom 0.
- **Longitude conventions differ by source** (Trek and USGS ±180°, rover
  feeds −360 to +360). A value that looks 180° or 360° off has skipped
  `coordinates.ts`.
- **The elevation models have no-data cells and limited boxes.** The chain
  falls through to a coarser model, and a height always says which model
  answered.
- **Rover feeds and raw images are live.** They grow as the rovers drive, so
  counts in comments are as of the date beside them.
- **The raw-image feed ignores a filter it cannot read** instead of
  failing, so the adapter fails the read when a returned record falls
  outside what was asked for.
- **oxlint's `react/only-export-components` is a warning**: a component file
  that also exports a constant or function breaks Fast Refresh for that
  file. Put shared constants in their own module.
- **URL parameters for development:** `?perf` opens the performance probe
  (frame times, renderer memory, a mount/unmount cycle); `?sampleWalk` loads
  a simulated walk plan so the walk views can be seen without planning one.
- **`npm run datum-check`** bundles `scripts/datum-check.ts` with `rolldown`,
  which is present as Vite's own dependency rather than a direct one.
- **Line endings** are normalized to LF by `.gitattributes`.
