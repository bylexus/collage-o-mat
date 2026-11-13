# Collage-o-mat PoC

**Ticket/Source:** `doc/agent-plans/initial_idea.md`
**Branch:** none
**Status:** in progress

## Goal

Collage-o-mat is a self-hosted web application to make photo collages (similar to the Mac app "Collage It Pro").
A user logs in, creates collages (a "page" with a size in mm), imports photos from their Immich server into a
collage, lets the app auto-arrange the photos (grid or center mode), then edits the result by hand (move, rotate,
resize, crop, borders, texts) and exports it as PNG/JPG. This PoC proves the full flow end to end with a
Go backend and an Angular frontend in one Docker image.

## Scope

**In scope:**
- Base app: Go backend (stdlib `net/http`, GORM, SQLite), Angular 22 SPA embedded in the Go binary
- Username/password login, server-side sessions, users with role flag `is_admin` (no admin UI)
- CLI subcommands to create users and set passwords
- Collage list: create, rename, delete (no thumbnails)
- Connectors per user; only type `immich`; API key encrypted in the DB
- Import from Immich: choose album, select photos from thumbnails, synchronous import of previews
- Auto-arrangement modes `grid` and `center` (run in the frontend)
- Editor (Konva canvas): select, move, rotate, resize (keep aspect / cover), crop mode (pan/zoom inside frame),
  per-photo border with collage default and "apply to all", background colour, page settings, z-order buttons,
  delete, undo/redo, debounced auto-save
- Overlay texts: multi-line, 4 bundled fonts, size, colour, bold/italic, alignment, shadow, outline
- Export to PNG/JPG in the browser (pixel size = page mm × DPI)
- Dev container (compose) and central `Makefile`
- Prod multiarch image (amd64/arm64, Alpine runtime) pushed to `registry.alexi.ch/collageomat`

**Out of scope:**
- Arrangement modes mosaic, masonry, heap
- "local" file connector / file upload
- User admin UI (users are created with the CLI)
- PostgreSQL (code stays GORM-only so it can be added later)
- High-resolution export (export uses the stored ~1440px previews)
- Collage thumbnails, duplicate collage, sharing collages between users
- Multi-select, snapping, keyboard nudging in the editor
- Text background box, curved text
- Background import jobs / progress reporting
- A second UI language (i18n framework is set up, only English texts)
- Automated tests

## Rough Architecture / Concept

- **One Go binary** (`collageomat`) serves the JSON API under `/api/...` and the Angular SPA (embedded with
  `go:embed`, SPA fallback to `index.html`). Subcommands: `serve`, `user add`, `user passwd`.
- **Storage:** SQLite file + photo files in a data directory (`COLLAGEOMAT_DATA_DIR`). Photos are copies of the
  Immich preview image (JPEG or WebP, about 1440px).
- **Data model "typed key columns + JSON props":** tables have typed columns only for identity, ownership and
  file data. All layout/settings data is one JSON text column per row (`collages.settings`, `photos.props`,
  `collage_texts.props`). The frontend owns the JSON structure; the backend stores it, checks it is valid JSON
  and checks ownership.
- **Frontend owns geometry:** arrangement algorithms, crop math, rendering and export run in the browser
  (TypeScript + Konva). The backend never renders images.
- **Editor save model:** the editor holds the full layout (settings + photo props + texts) in memory. Each
  change creates an undo snapshot and triggers a debounced (1 s) `PUT /api/collages/{id}/layout` with the full
  layout.
- **Connectors:** a `connectors` table (type + encrypted JSON config) per user. Type-specific API routes under
  `/api/connectors/{id}/immich/...`. The browser never talks to Immich directly; the backend proxies (API key
  stays on the server, no CORS problems).

Why this architecture:
- Few dependencies, simple deployment (one static binary, no CGO, no separate web server).
- JSON props columns let the editor model change without DB migrations during the PoC.
- Geometry in one place (frontend) avoids two renderers that must produce the same result.
- Konva gives ready-made transform handles, clipping/crop and export at any pixel ratio.

## Context for a new agent

### Sources read

- `doc/agent-plans/initial_idea.md` — the original idea and wishlist plus a short "Decisions (PoC)" list.
  Wishlist summary: multiple collages per user; collage = photos + settings (page size, page colour,
  arrangement mode, borders, overlay texts); modes mosaic/masonry/grid/center/heap; auto-arrangement is a
  one-time operation, after it photos are free objects (size, position, rotation, border); resize with keep
  aspect or cover, and move/zoom the image inside the frame; connectors (UI part + server part), first Immich,
  later "local"; roles normal/admin; export PNG/JPG with size from collage settings.
- Immich server of the developer: `https://immich.alexi.ch/` — version **3.3.6**
  (`GET /api/server/version` returned `{"major":3,"minor":3,"patch":6}`).
- Immich OpenAPI spec v3.3.6:
  `https://raw.githubusercontent.com/immich-app/immich/v3.3.6/open-api/immich-openapi-specs.json`. Relevant
  content:
  - Auth with header `x-api-key: <key>`. The API key needs permissions `album.read`, `asset.read`,
    `asset.view`.
  - `GET /api/albums` → array of `AlbumResponseDto` (`id`, `albumName`, `assetCount`,
    `albumThumbnailAssetId`, `startDate`, `endDate`, `shared`, ...). In v3 the album response has **no asset
    list**.
  - Album content: `POST /api/search/metadata` with body `{"albumIds": ["<id>"], "page": 1, "size": 250}`
    (`size` max 1000, `order` optional). Response: `{"assets": {"items": [AssetResponseDto...], "nextPage":
    "<string|null>", "total": n, ...}}`. `AssetResponseDto` has `id`, `type` (`IMAGE`/`VIDEO`),
    `originalFileName`, `originalMimeType`, `width`, `height`, `thumbhash`. The request `type` filter is
    deprecated since v3.2.0 → filter `type == "IMAGE"` in the backend.
  - `GET /api/assets/{id}/thumbnail?size=thumbnail|preview|fullsize|original` → image bytes. Default sizes
    (server-configurable): thumbnail 250px, preview 1440px. Format is JPEG or WebP (server config).
    `fullsize` is a converted JPEG only if "fullsize generation" is enabled on the server, otherwise it
    redirects to the original (can be HEIC) → not used in the PoC.
  - `GET /api/server/version` (no auth) → `{major, minor, patch}`. For "test connection" use an authenticated
    call (`GET /api/albums` or `GET /api/users/me`) so the key is checked too.
- PrimeNG 22 licence (checked in the npm package `primeng@22.1.4`, `LICENSE.md`): "PrimeUI License", needs a
  licence key, Community License free for individuals but renewed every year. Reason why Angular Material is
  used. PrimeVue is a Vue library and cannot be used with Angular.

### Key files and directories (target layout, created in step 1)

```
backend/                          Go module "collageomat"
  cmd/collageomat/main.go         entry: subcommands serve | user add | user passwd
  internal/config/                env var parsing (COLLAGEOMAT_*)
  internal/db/                    open SQLite (glebarez), AutoMigrate all models
  internal/httpapi/               router (http.ServeMux), JSON helpers, error responses, middleware
  internal/auth/                  User, Session models; bcrypt; session cookie; login/logout/me handlers; CLI helpers
  internal/collage/               Collage, CollageText models; collage CRUD + layout handlers
  internal/photo/                 Photo model; file storage under data dir; photo file + delete handlers
  internal/connector/             Connector model; AES-GCM crypto; connector CRUD + test handlers
  internal/connector/immich/      Immich HTTP client; album/asset/thumbnail proxy handlers; import
  internal/web/                   go:embed of the built SPA (dist/), SPA fallback handler
  internal/web/dist/.gitkeep      placeholder so go:embed works without a frontend build
frontend/                         Angular 22 workspace (standalone components, signals)
  proxy.conf.json                 ng serve proxy: /api -> http://localhost:8080
  src/app/core/                   auth service, auth guard, API models
  src/app/features/login/
  src/app/features/collages/      collage list + create/rename dialogs
  src/app/features/connectors/    connector settings page (Immich form)
  src/app/features/editor/        editor page, Konva canvas service, settings panel, import dialog
  src/app/features/editor/arrange/  grid.ts, center.ts (pure functions)
  src/app/features/editor/geometry/ crop.ts (cover crop, pan/zoom math), units.ts (mm/pt/px)
  src/app/features/editor/history.ts undo/redo snapshot stack
docker/Dockerfile.dev             dev image: Go 1.27 + Node 26 + make
docker/Dockerfile                 prod multi-stage image (step 11)
compose.yaml                      service "dev"
Makefile                          all commands
data/                             (gitignored) collageomat.db, photos/<collageId>/<photoId>.<ext>
.nvmrc                            Node 26 (exists)
```

### Existing patterns to follow

- None. The repository has no code and no commits yet (only `.nvmrc` and `doc/`). Step 1 creates the
  conventions; later steps follow step 1.
- Go: stdlib style, `internal/` packages per domain, handlers as methods on a small struct holding `*gorm.DB`
  and config. No global state except in `main.go`.
- Angular: standalone components, signals, new control flow (`@if`, `@for`), Angular Material components,
  all UI texts marked for i18n (`i18n` attribute in templates, `$localize` in TS).

### Commands (defined in step 1; exact target names)

Host (macOS):
```sh
make dev-up        # docker compose up -d --build dev
make dev-shell     # docker compose exec dev bash
make dev-down      # docker compose down
make publish       # step 11: docker buildx multiarch build + push
```
Inside the dev container (`/workspace`):
```sh
make install         # cd frontend && npm ci ; cd backend && go mod download
make backend-run     # cd backend && go run ./cmd/collageomat serve      (listens :8080)
make frontend-serve  # cd frontend && npx ng serve --host 0.0.0.0 --proxy-config proxy.conf.json  (:4200)
make build           # ng build, copy output to backend/internal/web/dist, CGO_ENABLED=0 go build -o bin/collageomat
make user-add USERNAME=alex ADMIN=1   # go run ./cmd/collageomat user add --username alex [--admin]
make user-passwd USERNAME=alex
```
Dev URL: `http://localhost:4200` (ng serve, proxies `/api` to Go). Built binary: `http://localhost:8080`.

### Environment / prerequisites

- Host: Docker with compose and buildx, make. Host has Go 1.27.3 and Node 26.11.1, but the workflow uses
  the dev container.
- Env vars (all read in `internal/config`):

| Var | Default | Meaning |
|---|---|---|
| `COLLAGEOMAT_LISTEN` | `:8080` | listen address |
| `COLLAGEOMAT_DATA_DIR` | `./data` | SQLite file `collageomat.db` and `photos/` live here |
| `COLLAGEOMAT_SECRET` | — (required) | any string; AES-256 key = SHA-256(secret). Server refuses to start without it. Changing it makes stored API keys unreadable. |
| `COLLAGEOMAT_COOKIE_SECURE` | `true` | `Secure` flag of the session cookie; `false` in the dev container |

- compose sets in the dev container: `COLLAGEOMAT_SECRET=dev-only-secret`, `COLLAGEOMAT_DATA_DIR=/workspace/data`,
  `COLLAGEOMAT_COOKIE_SECURE=false`.
- An Immich API key for `https://immich.alexi.ch/` with permissions `album.read`, `asset.read`, `asset.view`
  (the developer enters it in the connector settings page; never commit it).
- If a command or file access fails, it can be the Claude Code sandbox: report the exact command/path to the
  developer, who will adjust the sandbox config.

### Domain terms

- **Collage:** one page (size in mm) with photos and texts, owned by one user.
- **Page:** the printable area of a collage; size `widthMm × heightMm`, `dpi` for export.
- **Frame:** the rectangle of a photo on the page (centre, size, rotation). The image is drawn inside the frame.
- **Crop:** the part of the source image shown in the frame, as a normalized rectangle (0..1) of the image.
- **Cover:** the crop has the same aspect as the frame and is as large as possible → the frame is filled, the
  image is cut.
- **Arrangement / mode:** algorithm that sets all frames at once (`grid`, `center`).
- **Connector:** a configured external photo source of a user (only `immich` now).
- **Layout:** collage settings + all photo props + all texts, saved together.

### External references

- Immich OpenAPI v3.3.6: https://raw.githubusercontent.com/immich-app/immich/v3.3.6/open-api/immich-openapi-specs.json
- Immich API docs: https://api.immich.app/
- Angular 22 (npm `@angular/core` 22.2.5 on 2026-11-08): https://angular.dev
- Angular Material/CDK 22.2.6: https://material.angular.dev
- Angular i18n: https://angular.dev/guide/i18n
- Konva 10.9.1 (MIT): https://konvajs.org/docs/
- GORM: https://gorm.io/docs/ ; pure-Go SQLite driver: https://github.com/glebarez/sqlite
- PrimeNG licence change (reason for rejection): https://primeng.org/lts ,
  https://dev.to/playfulprogramming-angular/ng-news-2617-primengs-new-licensing-and-a2ui-for-angular-4eik

## Architecture conventions (clean code, SOLID, DRY)

The developer requires maintainable code: SOLID, common design patterns, DRY, clean code. All steps from step 3
on follow these rules.

**Backend — one package per domain** (`internal/collage`, `internal/photo`, `internal/connector`, ...), layered:
- `model.go` — GORM models only.
- `store.go` — repository: the **only** layer that uses `*gorm.DB`. Exposed as a concrete type with a
  constructor; consumers depend on small interfaces they declare themselves (Interface Segregation,
  Dependency Inversion).
- `service.go` — business rules: validation, ownership checks, transactions, orchestration. No `net/http`.
  Depends on interfaces (stores, file storage, external clients), not on concrete types.
- `handler.go` — HTTP only: parse path/body, call the service, map the result. Implements `httpapi.Module`.
- Constructors with explicit dependencies (`NewService(store Store, ...)`); wiring only in the composition root
  `backend/cmd/collageomat/main.go`. No package-level mutable state.
- Shared building blocks (no duplicates in domain packages):
  - `internal/apperr`: domain errors `ErrNotFound`, `ErrConflict`, and a validation error type with a message;
    services return these.
  - `httpapi.WriteServiceError(w, err)`: one central mapping apperr → HTTP status + JSON error (unknown errors
    → 500 with a generic message, real error logged).
  - `httpapi.PathID(r, name) (uint, error)` for numeric path parameters.
  - `internal/jsoncol.JSON`: GORM column type for JSON stored as `TEXT` (implements `sql.Scanner`,
    `driver.Valuer`, `json.Marshaler`/`Unmarshaler`; rejects invalid JSON). Used by all `settings`/`props`/
    `config` columns.
- Naming (unified after steps 3/4): the GORM repository is `type GormStore` with `NewGormStore(db *gorm.DB)`;
  the service declares the exported consumer interface `Store` it needs; `NewService(...)` takes interfaces;
  handlers depend on the concrete `*Service` (no handler-side interface — no tests, no substitution need);
  `NewHandler(svc *Service)`. The session user ID in handlers comes from `auth.UserID(r)` (one helper, no
  per-package copies).
- Cross-domain access only through small interfaces declared by the consumer and implemented by adapters
  in the provider package (e.g. `collage.Photos` implemented in `internal/photo`); no import cycles.
- Ownership: service methods take the `userID` of the session user; a record that does not exist **or**
  belongs to another user gives `apperr.ErrNotFound` (→ 404).
- Errors are wrapped with context (`fmt.Errorf("load collage %d: %w", id, err)`); no panics for control flow.
- Small functions, intention-revealing names, doc comments on exported identifiers, `gofmt`/`go vet` clean.
- Existing `internal/auth` (step 2) does not follow the store/service split yet; it stays as is unless the
  developer asks for a refactor.

**Frontend:**
- `src/app/core/api/` — one API service per resource (`CollageApi`, `ConnectorApi`, `ImmichApi`, ...). Only
  these services use `HttpClient`. Typed DTOs in `src/app/core/models/`.
- `src/app/shared/` — reusable building blocks: `ConfirmDialog` (Material dialog, title/message/confirm
  label), `NotificationService` (snackbar for success/error), `errorMessage(err)` helper that turns an
  `HttpErrorResponse` with `{"error": "..."}` into a display text. No duplicated dialog/snackbar/error code
  in features.
- `src/app/features/<feature>/` — page components (containers: load data, call API services, hold state in
  signals) and presentational components/dialogs (`input()`/`output()`, no API calls).
- Signals for state, `inject()`, standalone components, new control flow, OnPush (default). No state library.
- All UI texts marked for i18n with stable ids (`@@<feature>.<key>`).

## Data model

All tables have `created_at`, `updated_at` (GORM). JSON columns are `TEXT`.

| Table | Columns |
|---|---|
| `users` | `id` uint PK, `username` unique, `password_hash` (bcrypt), `is_admin` bool |
| `sessions` | `id` uint PK, `token_hash` unique (hex SHA-256 of the cookie token), `user_id` FK, `expires_at` |
| `collages` | `id` uint PK, `user_id` FK, `name`, `settings` JSON |
| `connectors` | `id` uint PK, `user_id` FK, `type` (`immich`), `name`, `config` (base64 of AES-GCM nonce‖ciphertext of the JSON config) |
| `photos` | `id` uint PK, `collage_id` FK, `connector_id` (nullable), `source_asset_id`, `file_name` (relative to `photos/`), `mime_type`, `width_px`, `height_px`, `props` JSON |
| `collage_texts` | `id` string PK (UUID made by the frontend), `collage_id` FK, `props` JSON |

Immich connector config JSON (encrypted as a whole): `{"url": "https://immich.alexi.ch", "apiKey": "..."}`.
The API never returns `apiKey`; it returns `{"url": "...", "apiKeySet": true}`. On update, an empty `apiKey`
keeps the stored key.

`collages.settings` JSON (defaults for a new collage):
```json
{
  "page": { "preset": "A4", "orientation": "landscape", "widthMm": 297, "heightMm": 210, "dpi": 300 },
  "backgroundColor": "#ffffff",
  "defaultBorder": { "widthMm": 0, "color": "#ffffff" },
  "mode": "grid",
  "grid":   { "rows": null, "cols": null, "gapMm": 5, "marginMm": 10 },
  "center": { "centerPhotoId": null, "sizePercent": 50, "gapMm": 5, "marginMm": 10,
              "topCount": null, "middleCount": null, "bottomCount": null }
}
```
Presets (portrait size, swapped for landscape): A5 148×210, A4 210×297, A3 297×420, Letter 215.9×279.4,
30×30 cm 300×300, Custom (free width/height).

`photos.props` JSON:
```json
{
  "cxMm": 100, "cyMm": 80, "widthMm": 90, "heightMm": 60, "rotationDeg": 0, "z": 3,
  "crop": { "x": 0.1, "y": 0, "width": 0.8, "height": 1 },
  "border": { "widthMm": null, "color": null }
}
```
- `cx/cy` = frame centre (rotation is around the centre).
- `crop` = normalized rect of the source image (Konva `crop` in px = value × `width_px`/`height_px`).
- `border` values `null` = use `settings.defaultBorder`. Border is drawn **inside** the frame (frame size stays).
- A new imported photo has `props = {}` until the arrangement sets it.

`collage_texts.props` JSON:
```json
{
  "text": "Summer 2026", "fontFamily": "Inter", "fontSizePt": 24, "color": "#000000",
  "bold": false, "italic": false, "align": "left",
  "cxMm": 100, "cyMm": 20, "widthMm": 120, "rotationDeg": 0, "z": 10,
  "shadow":  { "enabled": false, "color": "#000000", "blurMm": 1, "offsetXMm": 0.5, "offsetYMm": 0.5, "opacity": 0.5 },
  "outline": { "enabled": false, "color": "#ffffff", "widthMm": 0.3 }
}
```
`z` is shared between photos and texts (the editor sorts all elements by `z`). 1 pt = 25.4/72 mm.

## API

All routes need a valid session except `GET /api/health` and `POST /api/auth/login`. Mutating requests must
have `Content-Type: application/json` (with the `SameSite=Lax` cookie this is the CSRF protection).
Every collage/photo/connector access checks `user_id` = session user; otherwise **404** (do not reveal
existence). Errors: `{"error": "<message>"}`.

| Method | Path | Body / Result |
|---|---|---|
| GET | `/api/health` | `{"status":"ok"}` |
| POST | `/api/auth/login` | `{username, password}` → sets cookie `collageomat_session` (HttpOnly, SameSite=Lax, Secure per config, 30 days); `{id, username, isAdmin}` |
| POST | `/api/auth/logout` | deletes session, clears cookie |
| GET | `/api/auth/me` | `{id, username, isAdmin}` |
| GET | `/api/collages` | `[{id, name, settings, photoCount, updatedAt}]` |
| POST | `/api/collages` | `{name, settings}` → collage |
| GET | `/api/collages/{id}` | `{id, name, settings, photos:[{id, widthPx, heightPx, mimeType, props}], texts:[{id, props}]}` |
| PATCH | `/api/collages/{id}` | `{name}` |
| DELETE | `/api/collages/{id}` | deletes rows (photos, texts) and directory `data/photos/<id>/` |
| PUT | `/api/collages/{id}/layout` | `{settings, photos:[{id, props}], texts:[{id, props}]}` — in one DB transaction: replace settings, update props of the listed photos (unknown photo ids → 400), upsert listed texts, delete texts not listed |
| DELETE | `/api/collages/{id}/photos/{photoId}` | deletes row and file |
| GET | `/api/collages/{id}/photos/{photoId}/file` | image bytes, `Cache-Control: private, max-age=31536000, immutable` |
| POST | `/api/collages/{id}/import` | `{connectorId, assetIds:[...]}` → `{photos:[...]}` (synchronous, 4 parallel downloads) |
| GET | `/api/connectors` | `[{id, type, name, config:{url, apiKeySet}}]` |
| POST | `/api/connectors` | `{type:"immich", name, config:{url, apiKey}}` |
| PUT | `/api/connectors/{id}` | `{name, config:{url, apiKey?}}` |
| DELETE | `/api/connectors/{id}` | |
| POST | `/api/connectors/{id}/test` | `{ok, serverVersion?, error?}` |
| GET | `/api/connectors/{id}/immich/albums` | `[{id, name, assetCount, thumbnailAssetId}]` |
| GET | `/api/connectors/{id}/immich/albums/{albumId}/assets?page=N` | `{items:[{id, fileName, width, height}], nextPage}` (images only, 250 per page) |
| GET | `/api/connectors/{id}/immich/assets/{assetId}/thumbnail` | proxied Immich `size=thumbnail` bytes |

Import details: for each asset, `GET /api/assets/{id}/thumbnail?size=preview`; store as
`data/photos/<collageId>/<photoId>.<jpg|webp>` (extension from `Content-Type`); read pixel size with
`image.DecodeConfig` (`image/jpeg` + `golang.org/x/image/webp` registered); create `photos` row with
`props = {}`. If one asset fails, the import stops and returns an error listing the failed asset; already
imported photos stay.

## Algorithms (frontend, pure functions)

Coordinates in mm, page origin top-left. `content` = page minus `marginMm` on all sides.

**Cover crop** (`geometry/crop.ts`): for image aspect `ia = widthPx/heightPx` and frame aspect `fa = w/h`:
if `ia > fa` → `crop.height = 1`, `crop.width = fa/ia`, centred in x; else `crop.width = 1`,
`crop.height = ia/fa`, centred in y. Keeping a crop centre: same, but centred on the given centre and clamped
inside 0..1.

**Grid** (`arrange/grid.ts`), photos in import order (photo `id` ascending), `n` photos, `A = content.w/content.h`:
- rows and cols null: `cols = min(ceil(sqrt(n × A)), n)`, `rows = ceil(n / cols)` (1 photo fills the content)
- only cols set: `rows = ceil(n / cols)`; only rows set: `cols = ceil(n / rows)`; both set: as given
- `cellW = (content.w − (cols−1)·gap)/cols`, `cellH = (content.h − (rows−1)·gap)/rows`
- photo i (i < rows·cols): frame = cell (row-major), rotation 0, cover crop, `z = i`
- photos beyond `rows·cols`: frame width = `cellW`, keep image aspect, placed right of the page
  (`x = page.w + 10mm`), stacked with 10 mm vertical offset, full crop, so the user sees and moves them
- empty cells stay empty

**Center** (`arrange/center.ts`) — lane model (revised after the step 6/7 review):
- centre photo = `settings.center.centerPhotoId` if it exists in the collage, else the first photo
- centre frame: keeps image aspect, fits in a box of `sizePercent%` of content width × `sizePercent%` of
  content height, centred in content, full crop
- three lanes: **top lane** = full content width × (space above centre − gap); **bottom lane** likewise;
  **middle lane** = left side + right side of the centre frame (each: height of the centre frame × (space
  beside the centre − gap)). Lanes/sides with size ≤ 0 are unusable.
- counts: `topCount`, `middleCount`, `bottomCount` (`null` = auto). Fixed counts are used as given (middle
  split left = ceil(m/2), right = floor(m/2)); the remaining photos are distributed over the auto lanes in
  proportion to lane area (largest remainder, order top, middle, bottom; middle area = left + right area).
  Photos fill lanes in the order top, middle (left side first, then right), bottom. Photos beyond the total
  capacity (all counts fixed, or no usable lane) go beside the page (`placeBesidePage`). If there are fewer
  photos than the fixed counts, the lanes are filled in order and the remaining lanes stay empty.
- top/bottom lane = one justified row (photo widths ∝ image aspect, scaled so widths + gaps = lane width,
  height = lane height, cover crop); each middle side = one justified column (heights ∝ 1/aspect, analog).
  A lane with fewer photos than its count still spans the whole lane (justified).
- `z`: centre photo highest

**Arrangement trigger:** after each import (all photos, current mode) and with button "Re-arrange". If any
photo has been changed by hand since the last arrangement (editor flag in memory; after reload: always ask),
show a confirm dialog first. Arrangement result is one undo step.

## Editor behaviour

- Konva `Stage` fills the editor area; one layer: grey workspace, page rect (background colour), photos
  (`Konva.Group` with clip = frame, `Konva.Image` with crop, border as `Konva.Rect` stroke inside), texts
  (`Konva.Text`). Stage scale = zoom × px-per-mm; "Zoom to fit" button and initial fit.
- Selection: click selects one element, `Konva.Transformer` with rotation anchor.
- Resize: **corner anchors keep aspect** (crop scales with the frame); **edge anchors change the frame aspect**,
  crop is recomputed as cover around the current crop centre. After `transformend`, scale is converted into
  `widthMm/heightMm` and reset to 1.
- Crop mode: double-click a photo → the full image is shown semi-transparent around the frame; drag pans the
  image, mouse wheel / slider zooms; crop stays inside the image and keeps the frame aspect. `Esc` or click
  outside ends crop mode.
- Side panel: collage settings (page preset/orientation/custom size, DPI, background colour, default border +
  "Apply to all photos", mode + mode parameters, "Re-arrange") and properties of the selected element (photo:
  border width/colour override, "Set as centre photo", z-order "Bring to front"/"Send to back", delete; text:
  all text props, z-order, delete).
- Undo/redo: `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, toolbar buttons. Snapshot of the full layout on each committed
  change (`dragend`, `transformend`, crop end, panel change, arrangement), max 100 entries, in memory only.
- Auto-save: 1 s debounce after a committed change → `PUT .../layout`. Status indicator "Saved"/"Saving"/
  "Error"; on error show a snackbar, the next change retries. `beforeunload` warning while a save is pending.

## Decision log

- **UI library:** Angular 22 + Angular Material/CDK — *Rationale:* PrimeVue (named in the idea doc) is
  Vue-only; PrimeNG 22 needs a yearly-renewed licence key. Rejected: PrimeNG 22, Vue + PrimeVue 4.5.5 (last
  MIT, but changes the framework), plain Angular without a component library (more own code).
- **Photo storage:** copy the Immich preview (~1440px, JPEG/WebP) to the server, store the Immich asset ID —
  *Rationale:* works when Immich is offline, avoids HEIC/RAW decoding. Rejected: copy originals (HEIC needs
  extra libs, disk), reference + proxy only (breaks when Immich is offline or the asset is deleted).
- **Photo scope:** photos belong to one collage and are deleted with it — *Rationale:* simplest model,
  matches "photo import within a collage". Rejected: user-level library.
- **Editor technology:** HTML canvas with Konva.js 10.9.1 — *Rationale:* ready-made transform handles,
  clipping, export at any pixel ratio; one MIT dependency without sub-dependencies. Rejected: self-made SVG
  (much interaction code), DOM/CSS transforms (export hard), server-side Go rendering (two renderers).
- **Page/coordinate model:** mm + DPI; frames in mm, rotation in degrees — *Rationale:* print-oriented,
  export size = mm × DPI. Rejected: pixels, normalized 0..1.
- **Crop scope:** cover resize and crop mode (pan/zoom inside the frame) are in the PoC — *Rationale:* grid
  cells need cover crops; users must be able to fix bad automatic crops.
- **Connector config:** per user, stored in `connectors`, API key encrypted with AES-GCM (key = SHA-256 of
  `COLLAGEOMAT_SECRET`), never returned by the API. Rejected: plain-text key, one global Immich from env.
- **Import unit:** select an album, then select photos from its thumbnails. Rejected: whole albums only,
  album + search (too much for the PoC).
- **Import execution:** synchronous request, 4 parallel downloads. Rejected: background job with progress.
- **Arrangement trigger:** after every import and with a "Re-arrange" button; overwrites manual edits after a
  confirm dialog. Rejected: place only new photos; arrange only on mode change.
- **Arrangement location:** frontend TypeScript (pure functions) — *Rationale:* immediate preview, geometry
  in one place. Rejected: backend Go.
- **Grid spec:** rows/cols auto or fixed, gap/margin mm, equal cells, cover crop, extra photos stacked beside
  the page. Rejected: fit instead of cover; auto-adding rows.
- **Center spec:** 4 bands, each one justified row/column with cover crop. Rejected: grid with centre block,
  masonry columns.
- **Save/undo:** debounced auto-save of the full layout + in-memory undo/redo snapshots. Rejected: save
  button, no undo.
- **Photo storage in DB:** photo row = file columns + one JSON `props` column (frame, rotation, z, crop,
  border) — decided by the developer. Rejected: typed columns per property.
- **Collage storage in DB:** typed `id`, `user_id`, `name`, timestamps + one JSON `settings` column.
  Rejected: typed column per setting.
- **User creation:** CLI subcommands `user add` (`--username`, `--admin`, password prompt without echo) and
  `user passwd` — *Rationale:* a bcrypt hash cannot be typed directly into the DB. Rejected: env bootstrap
  admin.
- **Access rules:** collages and connectors are visible only to their owner, also not to admins; other users
  get 404.
- **Go HTTP/sessions:** stdlib `net/http` ServeMux (Go 1.22+ patterns) + own sessions in the DB (random
  32-byte token in cookie, SHA-256 hash in DB, 30 days sliding expiry: extend when less than 15 days are
  left). Rejected: chi, scs, Echo/Gin.
- **SQLite driver:** `github.com/glebarez/sqlite` (pure Go, `CGO_ENABLED=0`) — *Rationale:* easy multiarch
  cross-compile. Rejected: `gorm.io/driver/sqlite` (CGO).
- **Postgres:** not in the PoC; code uses only GORM APIs (no raw SQL) so it can be added later. Rejected:
  driver switch untested; postgres in compose.
- **Repo layout / serving:** monorepo `backend/` + `frontend/`; prod binary embeds the SPA with `go:embed`
  (`//go:embed all:dist` in `internal/web`, `dist/.gitkeep` committed, build output gitignored). Rejected:
  static folder at runtime.
- **Added to PoC scope:** export PNG/JPG, prod multiarch image, overlay texts. Still out: local connector,
  mosaic/masonry/heap, user admin UI.
- **Export source:** stored previews only — *Rationale:* no extra logic; at A4/300 DPI a 3×3 grid cell is
  about 1100px, so previews are sharp; large photos can be a little soft. Asset ID is stored for a later
  high-res export. Rejected: also storing fullsize, fetching fullsize at export.
- **Texts:** multi-line, 4 bundled fonts, size pt, colour, bold/italic, align, move/rotate/resize, shared z,
  table `collage_texts` with JSON props, **plus optional shadow and outline**. No background box/curved text.
- **Fonts:** Inter (sans), Lora (serif), Caveat (handwriting), Bebas Neue (display), all OFL, self-hosted via
  `@fontsource/*` npm packages — *Rationale:* export looks the same on every machine; no Google Fonts CDN.
- **Prod image:** multi-stage build (Node 26 → Go 1.27 → **Alpine** runtime), non-root user, port 8080,
  volume `/data`, `make publish` on the host with `docker buildx --platform linux/amd64,linux/arm64 --push`,
  tags `latest` + git short SHA. Rejected: distroless (no shell for debugging), latest-only tag.
- **Borders:** collage default border + per-photo override + "Apply to all photos" (clears overrides);
  drawn inside the frame. Rejected: per photo only, collage-wide only.
- **UI language:** English, but all texts marked with Angular i18n (`@angular/localize`, source locale `en`).
  Note: Angular i18n is build-time (one build per language); a 2nd language later needs one build per locale
  and locale routing in the Go server.
- **Editor extras:** only z-order buttons. Rejected for the PoC: multi-select, snapping, keyboard nudging.
- **Collage list:** list (name, page size, photo count, last change) + create (name, preset, orientation) /
  rename / delete with confirm. Rejected: thumbnails, duplicate.
- **Testing:** no automated tests, manual review per step.
- **UI fonts (step 1):** self-hosted from npm (`@fontsource/roboto` 300/400/500, `material-symbols`
  outlined), added to `angular.json` `styles`; Google Fonts CDN links from the Material schematic removed —
  *Rationale:* no external requests, offline build. Note: the Material Symbols font is 3.8 MB (loaded once,
  cached). Rejected: keep the CDN links.
- **Forms (step 2):** Angular Reactive Forms (`NonNullableFormBuilder`) — *Rationale:* Signal Forms are still
  `@experimental` in `@angular/forms` 22.2.5.
- **Duplicate import (step 5):** an Immich asset that is already in the collage (same `connector_id` +
  `source_asset_id`) is skipped on import; the import result reports the skipped count; the selection dialog
  marks already imported assets. Rejected: allow duplicates.
- **Immich testing by agents (steps 4, 5):** agents test against the real server `https://immich.alexi.ch`
  with a read-only API key (scopes `album.read`, `asset.read`, `asset.view`) from the repo-local file `.env`
  (gitignored as `/.env`), variables `IMMICH_TEST_URL=https://immich.alexi.ch` and `IMMICH_TEST_API_KEY=...`.
  The app itself does not read these variables (the app gets the key from the connector settings in the DB);
  they are only for agent tests. Agents only read `.env`; the key must never be written to committed files,
  the plan, logs or reports. The developer keeps `.env` permanently for dev purposes (decided after step 4).
  `.dockerignore` (created by the developer) already contains `/.env`. Rejected: fake Immich server only;
  key file in `~/.config/collageomat/` (needs a sandbox change).
- **Import order (step 5):** accepted: photo ids follow the download completion order (4 parallel
  downloads), not the album/selection order; arrangement order = photo id ascending. Rejected: keep request
  order.
- **Bundle budget (step 5):** the developer accepts a large initial bundle (~533 kB raw / ~132 kB transfer;
  `matTooltip` on logout pulls in the CDK overlay). `angular.json` production budget `initial` raised to
  warning 1 MB / error 2 MB. Rejected: replace the tooltip.
- **Collage presets (step 3, confirmed):** preset ids `A5`, `A4`, `A3`, `Letter`, `30x30`, `Custom`. Custom:
  no orientation toggle, orientation derived from width/height (width > height → landscape, square →
  portrait), width/height 10–2000 mm.
- **Grid with few photos (step 6):** in auto mode the column count is limited to the photo count
  (`cols = min(ceil(sqrt(n × A)), n)`), so 1 photo fills the content area. Rejected: plain plan formula
  (1 photo = half page).
- **Center with few photos (step 7):** accepted for the PoC as specified (each band one justified row/column,
  extreme strips possible with 2–4 photos); re-evaluate after the visual test. Rejected for now: special
  rules for few photos.
- **Beside-page placement (step 6):** cascade — each photo 10 mm lower than the previous one, overlapping,
  later photos in front, starting at the page top. Rejected: column with 10 mm gaps.
- **Orientation toggle for square presets:** hidden in the editor settings panel; the create dialog keeps
  showing it for 30×30 (developer: leave as is).
- **Review feedback steps 6/7 (2026-11-08, from screenshots):**
  - Settings panel needs inner padding (fields touched the panel edges).
  - **Canvas navigation:** pan + zoom like Figma/Canva: wheel/trackpad scroll pans (Shift = horizontal),
    Ctrl/Cmd + wheel and trackpad pinch zoom at the pointer, drag on the empty workspace pans, zoom controls
    (−, zoom %, +, fit) as a floating overlay on the canvas, auto zoom-to-fit when the page size or
    orientation changes. Rejected: native scrollbars; auto-fit only.
  - **Centre photo selection:** a "Set as centre" toolbar button (center mode, a photo selected). No
    double-click (reserved for crop mode), no context menu. The hidden "Selection" section at the bottom of
    the settings panel is removed. Changed in the step 8 review (2026-11-13): no re-arrange and no confirm;
    the selected photo and the current centre photo swap their frames (centre, size, rotation, z; frame
    sizes stay, crop = centred cover crop of the own image, border stays with the photo; one undo step).
    `centerPhotoId` is set too. Rejected: re-arrange all photos.
  - **Center lane model:** counts per lane top / middle / bottom (middle split evenly left/right); photos in
    a lane justified by aspect; empty count = auto (by lane area), extra photos beside the page. Rejected:
    separate left/right counts; equal cells; counts as maximums with shrinking lanes. Spec: "Algorithms" →
    "Center".
- **Settings normalization:** settings loaded from the API are merged with `defaultCollageSettings()`
  (missing fields, e.g. the new lane counts in older collages, get defaults) by a pure
  `normalizeSettings(raw)` in `core/models/collage.ts`, used by the editor store on load.
- **Photo delete and undo (step 8):** deleting a photo stays an explicit action with confirm that deletes row
  and file at once and is NOT undoable. Undo/redo covers all other changes. Snapshots are applied only to
  photos that still exist. Rejected: soft delete.
- **Beside-page width (step 8):** photos placed beside the page always get ¼ of the page width (grid overflow,
  center overflow, declined re-arrange after import). Rejected: centre photo width / cell width.
- **Text decisions (step 9, 2026-11-13):**
  - Resize: transformer side handles change only the text box width (text wraps again); font size only in
    the panel; rotation handle rotates. Rejected: corner handles scale the font, scale-only.
  - Outline width = visible outline outside the letters: Konva `strokeWidth = 2 × outline.widthMm` (the fill
    covers the inner half of the stroke). Rejected: stroke width = value (only half visible).
  - Panel edits: live preview on the canvas while typing / picking a colour / changing a number (not saved,
    no undo step, like the photo border colour); committed (one undo step + auto-save) when the field loses
    focus, the picker closes, or a checkbox/select/button changes. Rejected: debounced commit while typing,
    no preview.
  - "Add text" toolbar button (next to Import): text "Text", Inter 24 pt, black, align centre, box width 50 %
    of the page width, centred on the page, rotation 0, z in front of all elements, selected; the panel text
    area gets the focus with its text selected. Rejected: centre of the visible area, no focus.
  - Bold/italic always allowed; for a font without that face (Bebas Neue: regular only; Caveat: no italic)
    the browser synthesizes it. Rejected: disable the toggles.
  - Delete text: toolbar Delete button + panel button, no confirm (texts are in the undo history).
  - A text that is empty when its text area loses focus is deleted (one undo step).
  - Double-click a text on the canvas focuses the panel text area; no inline editing on the canvas.
  - Limits: font size 4–400 pt; shadow blur 0–20 mm, offset −20..20 mm, opacity 0–100 % (stored 0..1);
    outline width 0–5 mm.
  - Bundled font faces: Inter and Lora 400/700 normal + italic, Caveat 400/700, Bebas Neue 400.
  - Text panel above the collage settings (like the photo panel), z-order buttons as for photos.
- **Architecture (step 3+):** SOLID/DRY/clean code required by the developer; see section "Architecture
  conventions".
- **Backend module wiring (step 2):** `httpapi` must not import domain packages (import cycle, because domain
  packages use `httpapi.WriteJSON`). Each domain handler implements `httpapi.Module`
  (`RegisterRoutes(mux, requireAuth)`); `main.go` calls `httpapi.NewRouter(static, authHandler.RequireAuth,
  modules...)`. All GORM models are listed in one place: `models()` in `backend/cmd/collageomat/main.go`,
  passed to `db.Open(path, models...)`. Later steps add their models and modules there.
- **Defaults (approved):** session 30 days sliding; new collage A4 landscape, 300 DPI, white background,
  default border 0 mm white; presets A5/A4/A3/Letter/30×30 cm/Custom; corner resize = keep aspect, edge
  resize = cover; server does not start without `COLLAGEOMAT_SECRET`.

## Testing strategy

No automated tests, manual review only. Each step ends with manual test instructions (commands, URLs, expected
results) and the developer reviews before the next step starts.

## Steps

### Step 1 — Dev environment and project skeleton
- **Status:** done (reviewed 2026-11-08)
- **What:**
  - `docker/Dockerfile.dev`: base `golang:1.27-bookworm`, Node 26 copied from `node:26-bookworm`
    (`COPY --from=node:26-bookworm /usr/local /usr/local`), `make`, `git`; workdir `/workspace`.
  - `compose.yaml`: service `dev` (build `docker/Dockerfile.dev`, `command: sleep infinity`), bind mount repo →
    `/workspace`, named volumes for `/go/pkg/mod` and `/workspace/frontend/node_modules`, ports `8080:8080`,
    `4200:4200`, env vars from the Environment table (dev values).
  - `Makefile` with all targets from the Commands section (`build`/`user-*` targets can be stubs that work
    once later steps exist; `publish` is added in step 11).
  - `backend/`: Go module `collageomat`, `cmd/collageomat/main.go` with subcommand `serve` (stdlib `flag`),
    `internal/config`, `internal/httpapi` (ServeMux, JSON helpers, logging + recover middleware),
    `GET /api/health`, `internal/web` (`//go:embed all:dist`, static file server with SPA fallback to
    `index.html`, `/api/*` never falls back).
  - `frontend/`: `npx @angular/cli@22 new` (standalone, SCSS, routing, no SSR, skip git) in `frontend/`,
    `ng add @angular/material`, `ng add @angular/localize`, `i18n.sourceLocale = "en"`, `proxy.conf.json`,
    empty app shell (Material toolbar with app name, router outlet).
  - `.gitignore`: `data/`, `bin/`, `frontend/node_modules/`, `frontend/dist/`, `frontend/.angular/`,
    `backend/internal/web/dist/*` except `.gitkeep`.
- **Acceptance criteria:**
  - `make dev-up && make dev-shell`, then `make install`, `make backend-run` → `curl localhost:8080/api/health`
    gives `{"status":"ok"}`.
  - `make frontend-serve` → `http://localhost:4200` shows the toolbar shell; `http://localhost:4200/api/health`
    works through the proxy.
  - `make build` → `./bin/collageomat serve` serves the SPA at `http://localhost:8080/` and a deep link like
    `/collages` returns `index.html`.
- **Notes:**
  - Dev image: `golang:1.27-bookworm` + Node from `node:26-bookworm` (node 26.13.0, npm 11.20.0) + `make`,
    `git`, `sqlite3`. Named volumes `go-mod-cache` and `frontend-node-modules` (the latter hides a host
    `node_modules` → run `make install` in the container first).
  - `.gitignore` anchors `/data/` and `/bin/` to the repo root.
  - `make build` fails unless exactly one `frontend/dist/*/browser` folder exists; it empties
    `backend/internal/web/dist/` (except `.gitkeep`) before copying. `make` without target prints help.
    `user-add`/`user-passwd` accept `ADMIN=1|true|yes`.
  - Static handler (`backend/internal/web/web.go`): missing path with a file extension → plain 404 (no SPA
    fallback); non-GET/HEAD → 405; `/index.html` → 301 to `/`; no build present → plain-text 404
    "frontend not built (run 'make build')". Unknown `/api/...` → JSON 404 `{"error":"not found"}`.
  - Frontend scaffold command: `npx -y @angular/cli@22 new collageomat --directory frontend --standalone
    --style scss --routing --ssr=false --skip-git --skip-tests --ai-config none --package-manager npm
    --interactive=false --defaults`, then `ng add @angular/material` and `ng add @angular/localize`
    (localize is a devDependency, polyfill `@angular/localize/init`). Zoneless, OnPush default.
    Versions: `@angular/core` 22.2.5, `@angular/material`/`cdk` 22.2.6, TypeScript ~6.0.2.
  - CLI leftovers kept: `tsconfig.spec.json` and npm script `test` (no test target in `angular.json`).
  - UI fonts switched to self-hosted (see decision log "UI fonts").

### Step 2 — Config, database, users and authentication
- **Status:** done (reviewed 2026-11-08)
- **What:**
  - Config: all env vars from the table; `serve` fails with a clear message without `COLLAGEOMAT_SECRET`;
    create data dir if missing.
  - `internal/db`: open `<data>/collageomat.db` with `github.com/glebarez/sqlite`, enable foreign keys, WAL;
    `AutoMigrate` of `User`, `Session`.
  - `internal/auth`: bcrypt (`golang.org/x/crypto/bcrypt`), session create/lookup/extend/delete, cookie
    handling, middleware that puts the user in the request context, handlers login/logout/me. Login error is
    always "invalid username or password".
  - CLI: `collageomat user add --username <u> [--admin]` and `collageomat user passwd --username <u>`;
    password prompt twice without echo (`golang.org/x/term`).
  - Frontend: `AuthService` (signal with current user, `me()` on app start), login page (Material form),
    route guard, toolbar shows username + "Admin" badge if admin + logout button. All texts with `i18n`.
- **Acceptance criteria:**
  - `make user-add USERNAME=alex ADMIN=1` creates a user (password prompt). Login works at
    `http://localhost:4200/login`; wrong password shows an error.
  - Without login, any route redirects to `/login`; `curl localhost:8080/api/auth/me` → 401.
  - Logout removes the session row; reload goes to login. `sqlite3 data/collageomat.db "select * from users"`
    shows a bcrypt hash.
- **Notes:**
  - Go deps: `gorm.io/gorm` v1.31.2, `github.com/glebarez/sqlite` v1.11.0, `golang.org/x/crypto` v0.58.0,
    `golang.org/x/term` v0.47.0.
  - Backend files: `internal/db/db.go` (DSN pragmas `foreign_keys(1)`, `journal_mode(WAL)`,
    `busy_timeout(5000)`; `Open` checks the pragmas and fails if not active — the only raw SQL, SQLite-specific;
    GORM logger level Warn), `internal/auth/{models,password,users,context,session,handler}.go`,
    `cmd/collageomat/user.go`, `internal/config` (`RequireSecret`, `EnsureDataDir` (mode 0750), `DBPath`),
    `internal/httpapi` (`DecodeJSON` with 1 MB limit → 413, unknown fields → 400; `RequireJSON` middleware).
  - CSRF rule (`RequireJSON`, all `/api/` paths): POST/PUT/PATCH always need `Content-Type: application/json`
    (parameters allowed), also with an empty body; DELETE only when it has a body. Otherwise 415.
  - Logout is public: deletes the cookie's session if any, clears the cookie, always 204.
  - Login: username trimmed; dummy bcrypt compare for unknown users; on success also deletes the old cookie's
    session and the user's expired sessions. `RequireAuth` clears an unknown/expired cookie.
  - Passwords: 8 characters min, 72 bytes max (bcrypt limit). CLI prompts go to stderr; without a TTY, two
    lines are read from stdin (scriptable: `printf 'pw\npw\n' | collageomat user add --username x`).
  - Frontend files: `src/app/core/{models,auth.service,auth.guard,auth.interceptor}.ts`,
    `src/app/features/login/login.page.{ts,html,scss}`, `src/app/features/home/home.page.ts` (placeholder
    "Welcome, {username}", replaced by the collage list in step 3). Routes: `login` (`loginGuard`), `''`
    (`authGuard`), `**` → `''`; pages lazy-loaded. Guards wait for `AuthService.ensureLoaded()` (no app
    initializer). Interceptor: 401 from `/api/*` (except `/api/auth/me`, `/api/auth/login`) → clear user,
    go to `/login?returnUrl=...`. `withFetch()` not used (deprecated in 22.2; fetch is default). Admin badge
    is a styled `<span>`. i18n ids like `@@login.title`, `@@toolbar.logout`.

### Step 3 — Collage management
- **Status:** done (reviewed 2026-11-08)
- **What:**
  - Model `Collage`, AutoMigrate; handlers list/create/get/patch/delete with owner check (404 for others).
  - Frontend: route `/collages` (start page after login): Material table/cards with name, page size
    (e.g. "A4 landscape"), photo count, last change; "New collage" dialog (name, preset, orientation; custom
    → width/height mm); rename dialog; delete with confirm. Click on a collage opens `/collages/:id`
    (placeholder editor page with the name).
  - Shared TS types for `CollageSettings` + defaults + presets in `frontend/src/app/core/`.
- **Acceptance criteria:**
  - Create, rename, delete collages; list survives reload.
  - A second user (create with CLI) sees none of the first user's collages; `GET /api/collages/<other id>`
    → 404.
- **Notes:**
  - Shared foundations built before steps 3–5: `internal/apperr` (`ErrNotFound`, `ErrConflict`,
    `Conflict(fmt,...)`/`AsConflict`, `Validation(fmt,...)`/`AsValidation`, `Upstream(fmt,...)`/`AsUpstream`),
    `httpapi.WriteServiceError` (404 / 409 msg / 400 msg / 502 msg logged as warning / 500 generic logged),
    `httpapi.PathID`, `internal/jsoncol.JSON` (TEXT; nil/empty/`null` → SQL NULL; `From`, `Decode`, `IsNull`,
    `IsObject`; services set defaults, columns `not null`). Frontend: `core/api/auth.api.ts`,
    `core/models/user.ts`, `shared/confirm-dialog/{confirm-dialog,confirm.service}.ts`
    (`ConfirmService.confirm(data): Promise<boolean>`), `shared/notification.service.ts` (success 3 s, error 8 s
    with Close), `shared/error-message.ts` (`errorMessage(err, fallback?)`; status 0 → network text). Toolbar
    links "Collages" / "Connectors"; `''` redirects to `collages`. Login page shows server error text for non-401.
  - Backend `internal/collage/{model,store,service,handler}.go`: `NewGormStore`, `NewService(store Store, photos
    Photos)`, `NewHandler(*Service)`. `Photos` interface (implemented in `internal/photo`, step 5):
    `CountByCollages`, `DeleteAllForCollage` (called before the row delete, idempotent), `ListForCollage` →
    `[]collage.PhotoView`. Service: `List`, `Create`, `Get`, `Detail`, `Rename`, `Delete`.
  - API: list sorted `updated_at` desc then `id` desc; POST → 201 and PATCH → 200 return the summary shape
    `{id, name, settings, photoCount, updatedAt}`; detail `{id, name, settings, photos, texts: []}` (no
    `updatedAt`). Errors: blank name / > 200 chars / settings not an object → 400.
  - Frontend: `core/models/collage.ts` (types matching the settings JSON, presets, pure helpers
    `findFixedPreset`, `orientedSize`, `orientationOf`, `fixedPageSettings`, `customPageSettings`, `pageLabel`,
    `defaultCollageSettings`, constants `DEFAULT_DPI`, `COLLAGE_NAME_MAX_LENGTH = 200`,
    `CUSTOM_PAGE_SIZE_MIN_MM`/`MAX_MM`), `core/api/collage.api.ts`, `features/collages/` (`collages.page`,
    `collage-create-dialog`, `collage-rename-dialog`, `collage-dialogs.service`, `collage-name` validators).
    Dialogs only collect input; the page calls the API. Page label: "A4 landscape", square preset "30 × 30 cm",
    custom "300 × 200 mm" (`Intl.NumberFormat`). `features/home` deleted.
  - Editor page `features/editor/editor.page.*` (route `collages/:id`): invalid id / 404 → notification +
    back to `/collages`.

### Step 4 — Connectors and Immich client
- **Status:** done (reviewed 2026-11-08)
- **What:**
  - Model `Connector`, AutoMigrate; AES-GCM encrypt/decrypt of the config JSON; CRUD handlers (API key never
    returned; empty `apiKey` on update keeps the stored key); `POST /api/connectors/{id}/test`.
  - `internal/connector/immich`: client with base URL + `x-api-key`, timeout 30 s, methods `ServerVersion`,
    `ListAlbums`, `AlbumAssets(albumId, page)` (via `POST /api/search/metadata`), `Thumbnail(assetId, size)`.
    URL is normalized (trailing slash removed, `/api` appended by the client).
  - Frontend: route `/settings/connectors`: list, add/edit dialog (type fixed "Immich", name, URL, API key as
    password field, hint "key is stored; leave empty to keep it"), delete, "Test connection" button with
    result. Toolbar link "Connectors".
- **Acceptance criteria:**
  - Add a connector for `https://immich.alexi.ch` with a valid key → "Test" shows OK and version 3.3.6.
    Wrong key → "Test" shows an error.
  - `sqlite3 data/collageomat.db "select config from connectors"` shows no readable URL or key.
  - Edit name without entering the key → test still works.
- **Notes:**
  - `internal/secretbox` (AES-256-GCM, key SHA-256(secret), base64(nonce‖ciphertext)).
  - `internal/connector/{model,kind,store,service,handler}.go`: Strategy `Kind` interface (`Type`,
    `BuildConfig(input, stored json.RawMessage)` — stored nil on create, empty `apiKey` keeps the stored key,
    `PublicConfig`, `Test(ctx, stored) (TestResult, error)`); `NewRegistry(kinds...)` (duplicate type → error;
    unknown type → 400). `NewGormStore`, `NewService(store Store, cipher Cipher, kinds *Registry)`,
    `NewHandler(*Service)`. `Service.LoadConfig(ctx, userID, id) (Connector, json.RawMessage, error)` returns
    the decrypted config (contains the key — never send to clients).
  - `internal/connector/immich/{client,types,kind}.go`: `NewClient(url, apiKey, httpClient)` (trims `/`,
    appends `/api`), `NewHTTPClient()` (30 s, redirects only to the same host), `ServerVersion`, `ListAlbums`,
    `AlbumAssets(ctx, albumID, page)` (page from 1, 250, images only, `NextPage` 0 = last), `Thumbnail(ctx, id,
    size)`; `StatusError` (401/403 → "Immich rejected the request: invalid API key or missing permission");
    JSON responses limited to 32 MiB; HTML instead of JSON → clear "check the URL" message. Config strict:
    unknown fields → 400, URL absolute http/https without user info/query/fragment, stored without trailing `/`.
    Test = server version, then album list; failed test → 200 `ok:false` (with version if only the key is wrong).
  - Frontend: `core/models/connector.ts`, `core/api/connector.api.ts`, `features/connectors/`
    (`connectors.page`, `connector-dialog` with `save` callback (stays open on error), `immich-config-form` +
    `createImmichConfigGroup()`, `connector-types.ts`). Test result shown in the connector card. A new type =
    one form component + one `@case`.
  - `POST /api/connectors/{id}/test` needs `Content-Type: application/json` (CSRF rule); frontend sends `{}`.
  - Verified against immich.alexi.ch 3.3.6 (36 albums).

### Step 5 — Immich import into a collage
- **Status:** done (reviewed 2026-11-08)
- **What:**
  - Model `Photo`, AutoMigrate; storage helper for `data/photos/<collageId>/`.
  - Handlers: Immich albums, album assets (images only, paged), thumbnail proxy (owner check of connector);
    import (synchronous, 4 parallel downloads of `size=preview`, `image.DecodeConfig` with jpeg + webp);
    photo file endpoint; photo delete; collage delete also deletes the photo directory;
    `GET /api/collages/{id}` returns photos.
  - Frontend editor page placeholder: "Import from Immich" button → dialog: choose connector (if more than
    one), choose album (list with name + count), thumbnail grid with checkboxes, "Select all", "Load more"
    for further pages, "Import (n)" with spinner. After import, the editor page shows a simple list/grid of
    the imported photos with a delete button (canvas comes in step 6).
- **Acceptance criteria:**
  - Import 10 photos from an album → 10 files in `data/photos/<id>/`, 10 rows in `photos` with correct
    `width_px`/`height_px`, photos visible on the editor page.
  - Delete one photo → file and row are gone. Delete the collage → directory is gone.
  - Another user gets 404 for the photo file URL.
- **Notes:**
  - Consistency pass: `auth.UserID(r)`; connector renamed to `GormStore`/`NewGormStore`, exported `Store`,
    handler takes `*Service` (see Architecture conventions "Naming").
  - `internal/photo/{model,store,storage,preview,service,collage_photos,handler}.go`. `Photo` unique index on
    `(collage_id, connector_id, source_asset_id)`; collage FK CASCADE, connector FK SET NULL. Consumer
    interfaces: `Store`, `FileStorage{Save, Open → io.ReadSeekCloser, Remove, RemoveDir}`,
    `Collages{Get}` (= `*collage.Service`), `Sources{Source(ctx, userID, connectorID) (Source, error)}` +
    `Source{Preview(ctx, assetID)}` (connector-agnostic; loaded once per import). `photo.DiskStorage` uses
    `os.Root` (path traversal safe), atomic writes. `GormStore.CreateWithFile` inserts row + writes
    `<collageId>/<photoId>.<ext>` in one transaction. `photo.CollagePhotos` adapter implements
    `collage.Photos` (uses store + storage directly to avoid a construction cycle).
  - Import: asset ids trimmed, deduped, 1–500, max 200 chars each; skipped = already in the collage; previews
    read into memory (max 50 MiB, 4 workers with `sync.WaitGroup.Go`); decoded format must match Content-Type
    (`image/jpeg`/`image/webp`) else 502; first failure stops new downloads, already imported photos stay,
    error names the asset. Photo delete: row first, then file (file error only logged).
  - `internal/connector/immich/{service,handler}.go`: `immich.NewService(connectors Connectors, kind *Kind)`
    implements browse routes and `photo.Sources`; all Immich errors → `apperr.Upstream` (502, never 401 so the
    frontend does not log out). Album list sorted by name (case-insensitive), `thumbnailAssetId` may be `null`.
    Image endpoints send `X-Content-Type-Options: nosniff`; thumbnail proxy rejects non-`image/*`. Photo file
    via `http.ServeContent` (Range/HEAD). Bad/unknown Immich asset id → 502 (Immich answers 400).
  - `main.go`: `newDomainModules(...)`, `newConnectorService(...)`; `Config.PhotosDir()`. New dep
    `golang.org/x/image` v0.47.0.
  - Frontend: `core/models/{photo,immich}.ts` (`photoFileUrl`, `immichThumbnailUrl`), `core/api/{immich,photo}
    .api.ts`, `features/editor/photo-grid.ts`, `features/editor/import/{import-dialog,connector-list,
    album-list,asset-grid,import-result-message}.ts`. Dialog step derived from selection signals; one `load()`
    helper with stale-response protection; asset ids sent in album order; "Select all" = loaded, not yet
    imported assets; album count says "items" (includes videos).

### Step 6 — Editor canvas, collage settings, grid mode, auto-save
- **Status:** done (reviewed 2026-11-08)
- **What:**
  - `npm i konva@10.9.1`. Editor page: Konva stage, page rect with background colour, photos rendered from
    `props` (group with clip, image with crop, inside border), texts list prepared but empty; zoom to fit;
    photos with empty `props` are not drawn until arranged.
  - `geometry/crop.ts` (cover crop), `geometry/units.ts`, `arrange/grid.ts` per the Algorithms section.
  - Side panel: page preset/orientation/custom size, DPI, background colour, default border, mode select
    (only `grid` active in this step), grid parameters, "Re-arrange" (with confirm rule).
  - Auto-arrange after import. Layout endpoint `PUT /api/collages/{id}/layout` (backend, transaction) and
    debounced auto-save with status indicator; `beforeunload` warning.
- **Acceptance criteria:**
  - After import, photos appear as a grid on the page; changing rows/cols/gap/margin + "Re-arrange" changes
    the layout; extra photos (fixed rows×cols too small) appear right of the page.
  - Change page preset/orientation/background → visible at once; reload → same state.
- **Notes:**
  - Contract-first: shared types written before the parallel agents — `core/models/photo.ts` (`PhotoProps`,
    `NormalizedRect`, `PhotoBorder`, `UnplacedProps`, `isPlaced`), `core/models/layout.ts`
    (`SaveLayoutRequest`), stubs in `arrange/arrange.ts` and `geometry/crop.ts`.
  - Backend: `PUT /api/collages/{id}/layout` → 204. Unit of work in the context: `internal/db/tx.go`
    (`NewTransactor(gdb).InTx(ctx, fn)`, `db.Conn(ctx, gdb)`); ALL collage and photo `GormStore` methods use
    `db.Conn` and join a running transaction. `collage.Service.SaveLayout` (settings update with ownership
    check first, then `Photos.UpdateProps` per photo via `photo.CollagePhotos`). 400: settings not an object,
    `photos` missing (array required, `[]` allowed), props not an object, duplicate id, unknown photo id, unknown
    fields (also `texts` until step 9). Body limit stays 1 MiB (~3700 photos).
  - Arrangement (pure, `features/editor/arrange/`): `arrange.ts` (dispatcher, strategy map by mode; re-exports),
    `types.ts`, `frame.ts` (`coverFrame`, `fullFrame`, `MIN_FRAME_SIZE_MM = 1`), `grid.ts` (`arrangeGrid`,
    `gridDimensions`; auto cols limited to n), `beside-page.ts` (`placeBesidePage`, cascade), `center.ts`
    (lane model, `resolveCentrePhotoId`), `lanes.ts` (`laneCapacities`, `largestRemainder`,
    `splitByCapacities`), `justified-line.ts`. Geometry: `crop.ts` (`coverCrop`, `fullCrop`), `rect.ts`,
    `numbers.ts` (`clamp`, `optionalCount`, `sum`, ...), `units.ts`. Node 26 can run these files directly
    (erasable TS, `import type`); extensionless imports need a resolve hook in check scripts.
  - Editor: `editor.store.ts` (`EditorStore`, component-scoped; `load` uses `normalizeSettings`; `commit()`
    → `AutoSaver.schedule()`; `markManualChange()` hook for step 8; confirm rule via private flag
    `layoutIsArrangement`; declined re-arrange after import → `placeBesidePage(new, page, ¼ page width, maxZ+1)`;
    `deletePhoto` flushes pending save first and clears `centerPhotoId` if needed), `auto-saver.ts` (1 s debounce,
    one request in flight), `save-status-indicator.ts`. Toolbar: back, name/page label, save status,
    "Set as centre" (outlined text button, center mode only, tooltip explains disabled state), delete, import.
  - Canvas: `canvas/editor-canvas.ts` (Angular wiring, zoom overlay − / % / + / Fit, auto-fit on page size
    change), `canvas/collage-renderer.ts` (plain class, Konva scene, node reuse by photo id, image cache,
    selection outline), `canvas/stage-navigator.ts` (pan/zoom: wheel pans, Shift = horizontal, Ctrl/Cmd+wheel
    and pinch zoom at the pointer, drag on empty area pans with 4 px threshold, zoom 10–800 %, 100 % = 96 dpi),
    `canvas/viewport.ts` (pure view math). Konva imported as `konva/lib/Core` + single shapes (bundle size) —
    later steps import `Transformer`/`Text` the same way.
  - Bug found in the browser check: `fillEnabled(false)` on the loaded image removed it from Konva's hit graph
    (photos not clickable) → placeholder is now cleared with `fill('')`. Never disable fill/listening on
    clickable shapes.
  - Settings panel: `settings-panel/collage-settings-panel.*` + sections `page-settings-section`,
    `appearance-settings-section`, `arrangement-settings-section` (grid rows/cols, center size %, lane counts
    top/middle/bottom; empty = Auto), `number-field.ts`, `color-field.ts`, `settings-limits.ts`,
    `sync-from-input.ts`. Emits only committed, valid changes. Shared with the create dialog:
    `shared/page-size-form.ts`, `shared/number-limits.ts`. Panel container has 16 px padding.
  - `core/models/collage.ts`: `normalizeSettings(raw)`, `ARRANGEMENT_MODES`, `isSquarePreset`.
  - Testing note: port 8080 serves the SPA embedded at build time; use `ng serve` (`127.0.0.1:4200`).

### Step 7 — Center mode
- **Status:** done (reviewed 2026-11-08)
- **What:** `arrange/center.ts` per the Algorithms section; mode `center` in the panel with `sizePercent`,
  gap, margin; "Set as centre photo" action for the selected photo (needs simple click-selection, which is
  added here if not yet present) followed by re-arrange (with confirm rule).
- **Acceptance criteria:**
  - With 9 photos in center mode on A4 landscape: one large photo in the middle, the others fill 4 bands
    without overlap; changing `sizePercent` and re-arranging resizes the centre.
  - "Set as centre photo" on another photo puts it in the middle.
- **Notes:** implemented together with step 6 (see step 6 Notes): lane model in `arrange/center.ts`, lane
  count fields in the arrangement section, toolbar "Set as centre" button (replaces the panel "Selection"
  section). Reviewed in the browser by the developer after the review round (padding, pan/zoom, lanes,
  centre button).

### Step 8 — Editing interactions
- **Status:** done (reviewed 2026-11-13)
- **What:** selection + `Konva.Transformer` (move, rotate, corner resize keeps aspect, edge resize with cover);
  crop mode (double-click, pan, zoom, Esc); properties panel for photos (border override, "Apply to all
  photos" for the default border, z-order buttons, delete with confirm); undo/redo (`history.ts`, keyboard +
  toolbar); all changes go through the auto-save.
- **Acceptance criteria:**
  - Each interaction works and the state is the same after reload.
  - Corner drag keeps the photo aspect; edge drag changes the frame aspect and the image stays filled
    (no empty area).
  - In crop mode the image can be moved/zoomed but never shows empty area in the frame.
  - Undo/redo steps back and forward through moves, rotations, crops, border changes and re-arrange.
- **Notes:**
  - Pure logic: `geometry/transform.ts` (`applyFrameBox`, `panCrop`, `zoomCrop`, `normalizeRotationDeg`,
    `MIN_CROP_SIZE`, `ImageSize`, `FrameBox`), `geometry/frame-size.ts`, `history.ts`, `swap-frames.ts`.
  - Canvas: `canvas/collage-renderer.ts` is a facade over `photo-view.ts` (Konva nodes of one photo),
    `photo-transformer.ts`, `crop-mode.ts`, `crop-mode-controls.ts`, `scene.ts`, `image-cache.ts`,
    `press-gesture.ts`, `pointer.ts`, `canvas-theme.ts`, `stage-navigator.ts`. Each interaction reports one
    committed change (`onPhotoChange`), never during the gesture; live previews are drawn by the views.
  - Store/UI: `layout-snapshot.ts`, `z-order.ts`, `photo-border.ts`, `undo-history.ts`, `undo-shortcut.ts`,
    `photo-panel/photo-properties-panel.*`; shared form fields in `features/editor/fields/`
    (`number-field`, `color-field`, `border-fields`, `sync-from-input`, `panel-section.scss`).
  - Review round 1: photo border colour is shown live while the picker changes it (`ColorField.previewed` →
    `EditorStore.previewPhotoBorder`; canvas draws `EditorStore.displayedPhotos`; preview not saved, no undo
    step; committed on native `change`). Crop zoom slider zooms live (native `input`), commits on release
    (`CropMode.setZoom`/`commitZoom`); wheel zoom commits 300 ms after the last change. Crop controls = only
    a 160 px slider directly below the frame (follows pan/zoom via `CropModeState.anchor`), no hint text, no
    "Done" button (crop mode ends with Esc or a click outside the frame).
  - Review round 2: crop slider has a semi-transparent pill background (75 % surface colour); "Set as
    centre" swaps frames instead of re-arranging (see decision log "Centre photo selection").
  - Only the photo border colour has the live preview; background colour and default border colour still
    apply on picker close.

### Step 9 — Overlay texts
- **Status:** in progress
- **What:** `@fontsource` packages for Inter, Lora, Caveat, Bebas Neue (regular, bold, italic where the font
  has them), loaded globally; `collage_texts` model + AutoMigrate (layout endpoint already handles texts);
  "Add text" button; text rendering with `Konva.Text` (size pt→mm, shadow, outline as stroke); transformer for
  texts; properties panel (text area, font, size, colour, bold, italic, align, shadow on/off + colour/blur/
  offset/opacity, outline on/off + colour/width, z-order, delete); undo/redo + auto-save cover texts.
- **Acceptance criteria:**
  - Add two texts with different fonts and styles, move/rotate them, put one behind a photo with z-order;
    reload → same state.
  - Shadow and outline are visible and adjustable.
- **Notes:**
  - Status: in progress (2026-11-13). Contract-first, then 3 parallel agents (backend / canvas / store+UI).
  - Contract files written before the agents: `core/models/text.ts` (`TextProps`, `CollageText`,
    `TEXT_FONT_FAMILIES`, `ptToMm`), `core/models/layout.ts` (`SaveLayoutRequest.texts` = all texts),
    `core/models/collage.ts` (`CollageDetail.texts: CollageText[]`), `features/editor/selection.ts`
    (`EditorSelection` = photo id | text id | null, `sameSelection`, `selectedPhotoIdOf`, `selectedTextIdOf`),
    `canvas/scene.ts` (`SceneText`, `Scene.texts`, `Scene.selection` replaces `selectedPhotoId`).
  - `EditorCanvas` API: inputs `settings`, `photos`, `texts: readonly CollageText[]` (already with the live
    preview applied), `collageId`, `selection: EditorSelection`; outputs `selectionChange: EditorSelection`
    (replaces `photoSelected`), `photoChange` (unchanged), `textChange: {id: string; props: TextProps}`
    (committed move/rotate/width change), `textEditRequest: string` (double-click on a text).
  - Ownership: backend agent `backend/**`; canvas agent `features/editor/canvas/**`; store/UI agent
    everything else in the frontend (store, snapshot, page, text panel, fonts in `package.json` +
    `angular.json`).
  - Backend (done): `CollageText` model in `internal/collage/model.go` (PK string ≤ 64, FK CASCADE),
    store `ListTexts`, `TextIDsInOtherCollages`, `ReplaceTexts` (delete unlisted, upsert listed in batches of
    100, upsert guarded by `collage_id`); `Service.SaveLayout(ctx, userID, id, Layout{Settings, Photos,
    Texts})` in one transaction. 400 messages: `texts must be a list`, `text id is required`, `text id must
    be at most 64 characters`, `duplicate text id "x"`, `props of text "x" must be a JSON object`, `text id
    "k" belongs to another collage` (rolls back the whole save). Tested with curl against a real server.
  - Canvas (done): `canvas/text-view.ts`, `font-loader.ts` (`document.fonts.load` once per face, relayout via
    `Text._setTextData()`, also on `document.fonts` `loadingdone`), `selection-transformer.ts` (shared base),
    `text-transformer.ts` (side handles + rotate, width-only, min 5 mm), `photo-transformer.ts` extends the
    base; `scene.ts` (`TextBox`, `applyTextBox`, `sameTextBox`, `MIN_TEXT_WIDTH_MM`). Konva 10.9.1 source:
    shadow blur/offset are multiplied by the absolute scale → stored mm values work at every zoom and in the
    export; the shadow offset is not rotated with the text. Outline = Konva stroke with
    `fillAfterStrokeEnabled`.
  - Store/UI (done): `text-props.ts` (`newTextProps`, `isBlankText`, `sameTextProps`), `text-panel/*`
    (`TextPropertiesPanel`, `TEXT_LIMITS`), store `selection`/`select()`, `texts`, `displayedTexts`,
    `addText`, `previewText`, `updateTextProps`, `deleteText`, `bringTextToFront`, `sendTextToBack`;
    `layout-snapshot.ts` includes texts. Fonts: `@fontsource/{inter,lora,caveat,bebas-neue}` ^5.3.0 in
    `angular.json` styles. The dev container needs `make install` (own `node_modules` volume).

### Step 10 — Export PNG/JPG
- **Status:** open
- **What:** "Export" dialog (format PNG/JPG, JPG quality 0.6–1.0, shows the pixel size
  `round(widthMm/25.4×dpi) × round(heightMm/25.4×dpi)`); render the page into an offscreen Konva stage at
  `dpi/25.4` px per mm (no selection, no workspace, only page area), wait for `document.fonts.ready`,
  `toBlob`, download as `<collage name>.<png|jpg>`. If a side is > 16384 px, show an error and ask for a
  lower DPI.
- **Acceptance criteria:**
  - Export of an A4 landscape collage at 300 DPI gives a 3508×2480 px file that looks like the editor
    (photos, crops, borders, rotation, texts with correct fonts, background).
  - JPG quality setting changes the file size.
- **Notes:**

### Step 11 — Prod image and publish
- **Status:** open
- **What:** `docker/Dockerfile` multi-stage: `node:26` stage (`npm ci`, `ng build`) → `golang:1.27` stage
  (copy SPA build to `internal/web/dist`, `CGO_ENABLED=0 go build` with `TARGETOS/TARGETARCH`) → `alpine`
  runtime (non-root user, `COLLAGEOMAT_DATA_DIR=/data`, `VOLUME /data`, `EXPOSE 8080`,
  `ENTRYPOINT ["/app/collageomat"]`, `CMD ["serve"]`). Build stages run on `$BUILDPLATFORM` (no QEMU for
  compile). Makefile targets on the host: `image` (local single-arch build + load), `publish`
  (`docker buildx build --platform linux/amd64,linux/arm64 -t registry.alexi.ch/collageomat:latest
  -t registry.alexi.ch/collageomat:$(git rev-parse --short HEAD) --push .`). Short run instructions in this
  plan's Notes (docker run with `-e COLLAGEOMAT_SECRET`, `-v`, and `docker exec ... /app/collageomat user add`).
- **Acceptance criteria:**
  - `make image` and `docker run -p 8080:8080 -e COLLAGEOMAT_SECRET=x -e COLLAGEOMAT_COOKIE_SECURE=false -v
    $PWD/data-prod:/data registry.alexi.ch/collageomat:latest` → app works on `http://localhost:8080`; user
    created with `docker exec`.
  - `make publish` pushes both architectures (check with `docker buildx imagetools inspect
    registry.alexi.ch/collageomat:latest`). Needs a prior `docker login registry.alexi.ch` by the developer.
- **Notes:**

## Open questions

- **Risk — SSRF:** the Immich URL is user input, so the server makes requests to any URL a logged-in user
  enters. Accepted for a private PoC; revisit before multi-tenant use.
- **Risk — no login rate limiting** in the PoC.
- **Risk — Immich preview format:** if the Immich server is set to WebP previews, Konva shows them fine in
  modern browsers; Go needs `golang.org/x/image/webp` only to read the pixel size.
- **Host proxy note:** `frontend/proxy.conf.json` targets `http://localhost:8080`. On the host, `localhost`
  can resolve to `::1:8080` = the dev container's port mapping, not a backend started on the host with
  `127.0.0.1:8080`. Correct for the container workflow; host-only tests need a scratch proxy config with
  `127.0.0.1`.

## Current state / Next action

- Done: research and grilling; Steps 1–8 (reviewed and committed).
- Nothing half-finished, no temporary changes to revert.
- Sandbox notes for agents on the host: `pkill`/process listing is blocked → stop own servers with
  `lsof -ti tcp:<port> | xargs kill`, or ask the developer to run a kill command. Background `&` prints a
  harmless `nice(5) failed` warning; `nohup` cannot detach (use a background task). The developer's dev
  container may be running and bound to `:8080`/`:4200`; use other ports (`COLLAGEOMAT_LISTEN`) and a scratch
  proxy config targeting `127.0.0.1:<port>` for host tests.
- Step 8 done (reviewed and committed 2026-11-13, commit `c504234`).
- Next: **Step 9 — Overlay texts** (open question "Text resize behaviour" must be answered first).
