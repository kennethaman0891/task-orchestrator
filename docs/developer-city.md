# Developer City — 3D visualization layer

Living architecture doc. One file, per-phase notes. The city is a **visual
operating layer**: it renders real system state. Nothing in it is faked —
every moving element traces to a live sidecar/Rust signal.

## Principles

- **Data-driven, zero hard-coded projects.** The city renders records from
  the project registry (`backend/routers/projects.py`,
  `backend/data/projects.json`). New project → new building, automatically.
- **No re-architecture.** Rust (Tauri) still owns terminals/sessions; the
  Python sidecar owns app data. The city adds one router + one WS message
  type; no Rust changes.
- **HTML overlays for all panels** (accessible, cheap). 3D only for world
  objects: buildings, bots, avatar.
- **Real state only.** Bot motion maps 1:1 to terminal/agent state.
  Working → step cycle. Thinking → slow bob. Failed → shake. Idle → still.
- **Graceful degradation.** No WebGL? The city becomes a 2D top-down card
  grid with the same data and the same click/panel behavior.

## Data contracts (shared with the backend)

| Contract | Value | Where |
|---|---|---|
| Grid size | 8×8 | `projects.py` `city_meta` / `CityGrid.tsx` `GRID_SIZE` |
| Spacing | 14.0 world units | same pair |
| Project types | college, ecommerce, business, portfolio, saas, custom | `PROJECT_TYPES` / `__meta` |
| Themes | midnight, neon, sandstone, glass, forest, mono, sunset, ice | `themes.ts` / `__meta` |
| Default floors per type | see `DEFAULT_FLOORS` in `projects.py` | server-assigned |
| WS message | `projects_changed` on the existing dashboard `/ws` | `main.py` broadcaster |

Color cascade for a building: **explicit user color → brand-extracted
palette → theme default.** Brand colors are extracted client-side (canvas
pixel sampling, `utils/brandColors.ts`) and stored on the project record.

## Phase notes

### Phase 1 — City foundation ✅
- `backend/routers/projects.py`: full CRUD + `__meta` + agent-snapshot
  endpoints. JSON store, asyncio lock, atomic saves, `set_broadcaster`
  decoupling (wired in `main.py` inside a try/except so a failure can
  never break core boot).
- Frontend: `frontend/src/city/` module. `types.ts` contracts, `store.ts`
  zustand state (projects, nav stack, selection, camera target, filters,
  agents, user avatar), `feed.ts` (REST sync + WS `projects_changed` +
  10 s recovery poll), `api.ts` reusing `apiBase()`/`wsBase()`.
- R3F scene: `CityGrid` (ground, roads, plot rings), `ProjectBuilding`
  (6 archetypes, instanced windows, sign textures, status beacon, LOD via
  `<Detailed>`), `CameraRig` (orbit + fly-to lerp).
- `CityView` is lazy-imported from `App.tsx` — the ~1 MB three.js payload
  only downloads when the City tab opens (own chunk, `CityView-*.js`).

### Phase 2 — Building customization ✅
- `BuildingEditor` (DOM overlay): 8 theme swatches, 3 color pickers,
  "extract brand colors from logo", scale/rotation sliders, floor editor.
  Saves via `PATCH /api/projects/{id}` — persistent across restarts.
- `default_building(type)` on the server ensures no project is visually
  empty; user edits layer on top.

### Phase 3 — Project interaction / workspace ✅
- `ProjectPanel`: status, health, deploy info, live agents for that
  building, recent actions. Prominent **Continue in workspace** hands off
  to the classic terminal view (finds a live session in the project path,
  or opens a fresh workspace pinned to it).
- `CreateProjectModal`: name + path + type → `POST /api/projects` → the
  WS feed makes the new building appear in the city.

### Phase 4 — Enterable interiors ✅
- Double-click a building (or "Enter building") → camera flies inside,
  the solid tower is replaced by the **active floor**: slab, walls with a
  doorway, room zones from `project.floors` (named rooms get their own
  floor patch + sign + desk/screen), stairs/elevator marker, floor
  title plate.
- `FloorNav` overlay: floor chips, up/down, exit building, workspace jump.
  Nav is a history stack: CITY → PROJECT → BUILDING → FLOOR → (ROOM) →
  WORKSPACE; exit pops one level.
- Every interior is generated from that project's own floor config —
  never one fixed interior.

### Phase 5 — Agent 3D visualization ✅
- `sync/agentSync.ts`: maps REAL `TerminalEntry` state (process-scan CLI,
  `opencode_status`, current task, model, history) to `AgentBot` records,
  matched to buildings by `cwd` ↔ project path.
- `Bots.tsx`: one robot per agent. Exterior = plaza ring around its
  building; interior = inside the room guessed from task text.
  Motion is a pure function of status (see Principles). No fake theater.
- `AgentPanel`: select a bot → name, model, session, terminal, tools,
  status, task + progress, recent actions, last log lines, "Open terminal".

### Phase 6 — Polish, performance, persistence, avatar ✅
- **Search/filter**: TopBar query + type chips + agents-active toggle.
  `visibleProjectIds` is the single filter; the scene renders only that.
- **Health/deployment indicators**: roof beacon color = project health
  (green/amber/red/gray); pulses while an agent is active. Maintenance +
  last deploy status surface in the project panel.
- **Performance**: instanced window meshes (one draw call per building
  for all windows), 2-level LOD, frustum culling on, DPR capped
  [1, 1.75], single 1024 shadow map, no per-frame allocations, lazy
  R3F chunk. Targets: 60 fps with 100+ projects / 50+ agents.
- **Persistence/recovery**: `POST /{id}/agent-snapshot` persists session
  state; records survive restart via `projects.json`. Snapshot *restore*
  (resuming sessions after a crash) is the next step — the API surface
  is ready; no visual state is ever fabricated from a stale snapshot.
- **Avatar foundation**: `UserAvatar` entity at the plaza centre driven
  by `store.userAvatar` (`{ name, color }`). Appearance customization
  (models, textures) layers on this record without new plumbing.

## File map

```
backend/
  routers/projects.py        # registry CRUD + meta + snapshot (the city's data source)
  data/projects.json         # auto-created on first write
  main.py                    # mounts the router + wires the WS broadcaster (guarded)
  tests/test_projects.py     # registry tests (standalone: venv/bin/python …)

frontend/src/city/
  CityView.tsx               # composition root (canvas + overlays), lazy from App
  index.ts                   # public barrel
  types.ts themes.ts store.ts feed.ts api.ts
  scene/  CityScene CityGrid ProjectBuilding archetypes CameraRig
          Interior Bots UserAvatar
  ui/     TopBar ProjectPanel BuildingEditor AgentPanel FloorNav
          FallbackMap CreateProjectModal
  sync/   agentSync.ts       # TerminalEntry → AgentBot mapping
  utils/  brandColors.ts     # logo → 3-color palette (client-side)

frontend/src/components/App.tsx        # view switch + city hand-offs (lazy import)
frontend/src/lib/workspace.ts          # View += 'city'
frontend/src/components/shell/Sidebar  # CITY tab
```

## Workspace ↔ City sync (sidebar workspaces)

The city mirrors the sidebar's **workspace list** — no hard-coded projects:

- `city/sync/workspaceSync.ts` (`useWorkspaceSync`) runs inside CityView:
  1. **Auto-provision**: every workspace with a `projectPath` gets a
     `POST /api/projects` record (deduped by path). Building name = workspace
     name, type guessed from the name, primary/accent = the workspace color.
  2. **Logo**: a 256×256 PNG data-URL is generated on the fly — the workspace
     NAME on its color — and stored in `building.logo`. The building's sign
     texture renders it; the floating label shows the full name.
  3. **Rename sync**: records created by this sync carry
     `deploy: { source: "workspace-sync", workspace_id }`. If the sidebar
     workspace is renamed, the building's `name` + `building.logo` follow
     (PATCH, building dict merged server-side).
  4. **Current-workspace focus**: the active workspace's `projectPath` is kept
     in the store (`activeWorkspacePath`); CityView selects that building and
     flies the camera to it once per path change (mount + sidebar switch).
     The building shows a green "● current workspace" chip; the 2D fallback
     list gets the same marker.
- 8-color palette: `BuildingConfig.palette?: (string|null)[8]` — slots map to
  facade / plinth / glass / accent / lit-glow / plaza-ring / sign-bg / trim.
  Unset slots inherit the theme cascade. Editable in BuildingEditor
  ("8-COLOR PALETTES" section, per-slot clear).
- Building rename: ProjectPanel ✎ (inline, Enter=save, Esc=cancel) or
  BuildingEditor "BUILDING NAME" — both PATCH the record, so it persists.

## Zoom visibility & building options

### Why buildings "disappeared" when zooming out
Three independent effects combined to hide buildings at certain camera distances:
- **Fog** was set to `near=90, far=320` — beyond 90 units, buildings faded toward the background color.
- **LOD** (`<Detailed>`) switched to a low-detail box at distance 90, then again at far.
- **Frustum culling** on individual building meshes could drop them at grazing angles.

Fix (all in `CityScene.tsx` + `ProjectBuilding.tsx`):
- Fog widened to `near=150, far=800` so buildings stay readable across the whole dolly range.
- `<Detailed>` thresholds set to `[0, 200]` — detailed geometry kept out to 200 units.
- `frustumCulled={false}` added to the exterior tower, interior roof, LOD box, and sign meshes so they never get culled.

### User avatar now tracks the active workspace
`UserAvatar` no longer sits fixed at the city center. It reads `activeWorkspacePath` + `projects`
from the store and places the "YOU" capsule at the active workspace building's plot
(`plotWorldPosition`). Falls back to the center when there is no active workspace.

### Right-click building context menu
Right-clicking (or long-pressing) a building opens `BuildingContextMenu` — a DOM overlay in
`CityView` driven by `store.contextMenu`. The 3D mesh only *triggers* it
(`openContextMenu(projectId, x, y)`); the menu itself renders at the DOM level so it stays
crisp and accessible. Native WKWebView context menu is suppressed on the canvas.

Menu offers, without opening the full editor:
- **Building type** dropdown (college / ecommerce / business / portfolio / saas / custom)
  — patches `building.buildingStyle`, which changes the archetype (shape, height, feature).
- **Building name** inline edit — patches `name`.
- **8-color palette** quick swatches — patches `building.palette`.
- **Save Changes**, **Continue**, **New Session**, and **Open full editor** (→ `BuildingEditor`).

### Building type / architecture selector
`BuildingEditor` now has a **BUILDING TYPE** dropdown too, so the archetype can be changed from
the full editor as well as the quick context menu. Both paths patch
`building.buildingStyle`; `archetypeFor(buildingStyle || project.type)` re-resolves the shape.

## Workspace icons, city mood & moving buildings
### Workspace icon upload (sidebar) → building sign
- `Workspace` type gains `logo?: string` (a PNG data URL, downscaled to 256×256
  at pick time so localStorage stays light).
- Each sidebar workspace row shows an **Image** button (hover cluster). Clicking
  opens a file picker. Format-agnostic pipeline:
  - **Small files (≤ 300 KB) are stored raw** as a `data:` URL — no decode step,
    so anything the system can display works (HEIC, WebP, AVIF, …).
  - **Larger files** are downscaled to a centered 256×256 PNG (localStorage
    quota). Decode tries `createImageBitmap` first (broadest WebKit coverage),
    then `<img>`. If both fail the toast names the file + type and tells you
    to convert (macOS Preview → Export as JPEG).
  - If a stored icon genuinely can't render, the avatar silently falls back to
    initials (and the building sign shows its monogram) — no broken-image box.
  A **trash** button appears when an icon is set (clears it, back to the
  generated monogram).
- The avatar itself renders the uploaded image (with `object-fit: cover`) when
  present, otherwise the colored initials.
- `useWorkspaceSync` mirrors it to the city:
  - **create**: `building.logo = ws.logo || makeWorkspaceLogo(name, color)`
  - **rename**: keeps an uploaded icon over the regenerated monogram
  - **logo-sync effect**: idempotent; when the uploaded icon changes (or is
    cleared), it PATCHes `building.logo` on that workspace's building. The sign
    texture in `ProjectBuilding` already accepts `data:` URLs, so no scene
    changes were needed.
- `onSetWorkspaceLogo` is wired through `App.tsx` into `Sidebar` and persists
  with the rest of the workspace list (`saveWorkspaces`).

### Day / Night city mood
- A new scene-level mood (`day` | `night`) is separate from the 8 per-building
  color themes. `CITY_MOODS` in `themes.ts` drives:
  - **Day** — blue sky (`#8ec9ff`), light blue fog, warm bright sun, light
    plaza ground.
  - **Night** — dark sky (`#0b0e16`), dark fog, cool moon, dark base (the
    previous look).
- `CityScene` reads `cityMood` from the city store and applies sky/fog/lights/
  ground from the mood. `TopBar` gets a **Day / Night** toggle (Sun/Moon icon)
  in the camera-preset row; the choice persists in `localStorage`
  (`tto-city-mood`).

### Moving buildings on the city grid
- `BuildingEditor` gains a **Position on City Grid** picker: an 8×8
  mini-grid. The building's current cell is highlighted; cells occupied by
  other buildings are dimmed + disabled. Clicking a free cell PATCHes
  `plot` immediately (live, independent of the Save button) and the building
  moves in the scene.

## Backlog (intentionally deferred)

- Snapshot-based session *resume* after crash (API ready, UI pending).
- Texture/model upgrades for buildings (v1 is primitive-accurate for the
  Tauri WebView; swap-in point is `archetypes.ts`).
- Avatar appearance picker (record + entity exist already).
- City-wide statistics layer (per-plot agent throughput, deploy cadence).
