# Synology "Shared with me" albums

**Ticket/Source:** none (follow-up of `doc/agent-plans/done/synology-connector.md`; developer, 2026-11-17:
"Synology has a 'Shared with me'-Album section. Can this also be implemented? If it can be done, we can
implement it as another separate tab")
**Branch:** none — work directly on `main` (decision of the developer)
**Status:** done

## Goal

The Synology connector can import photos from albums that **other NAS users shared with the connector
account** ("Shared with me" in Synology Photos). The Synology import dialog gets a third tab "Shared with me"
next to "Albums" and "Folders": the user opens a shared album, selects photos and imports them in preview or
original size, the same way as from own albums.

## Scope

**In scope:**
- Backend: list the albums shared with the account, list the photos of one shared album (pages), thumbnail
  proxy and import (preview + original) for photos of shared albums.
- Frontend: third tab "Shared with me" in `synology-import-dialog` (album list → photo grid → import).
- Docs: `doc/architecture.md`, `README.md`.

**Out of scope:**
- Shared Space / Team Space (`SYNO.FotoTeam.*`; the test account gets error 801), public share links (a
  passphrase typed in by the user), albums the account shares with others (they are already in "Albums").
- Owner name of a shared album, album covers.
- 2FA, write access, sync (same as the first Synology plan).

## Rough Architecture / Concept

- **Synology API:** shared albums are listed with `SYNO.Foto.Sharing.Misc` `list_shared_with_me_album`. Each
  shared album has a **passphrase** (a random share token that Synology generates when an album is shared —
  the same token as in a share link `/photo/mo/sharing/<passphrase>`; nobody types it). The photos, thumbnails
  and originals of a shared album are read with `passphrase=<token>` **instead of** `album_id` (both together
  give error 120). The logged-in session (`_sid`) is still sent with every request.
- **Token stays on the server:** routes, browser and database use only the album `id`. The backend gets the
  token from the album list and keeps a map album id → passphrase in memory in the connector's session cache
  entry (`sessionCache` in `backend/internal/connector/synology/session.go`), so a config change clears it.
  On a cache miss the backend loads the shared-album list once more; an album that is still unknown → 404.
- **Asset id of a shared photo:** `s:<albumId>:<itemId>` (decimal, canonical). Own photos keep the plain
  decimal item id. One parser (`parseAssetRef`) is used by the thumbnail route and by the import
  (`imageSource.Image`), so `photo.Source.Image(ctx, assetID, size)`, the import API and the `photo` package
  stay unchanged. Stored in `photos.source_asset_id` (column size 200).
- **Original refused:** if the NAS refuses the original download of a shared photo (owner gave only the
  "viewer" role, any Synology API error), the import returns the `xl` thumbnail with `Fallback=true` (the
  existing "imported in preview size" message).
- **Frontend:** the tab reuses the generic `AlbumList` and `AssetGrid` and the existing selection / paging /
  size / import code of `SynologyImportDialog`.
- *Why:* follows the existing Synology package and dialog structure; no new libraries; no change of the
  connector-neutral `photo` package; the share token never leaves the server.

## Context for a new agent

### Sources read (summarized)

**1. Previous plan** `doc/agent-plans/done/synology-connector.md` — full background of the Synology connector:
verified API facts of the Personal Space (login, `_sid`, album/item/folder list, thumbnail, download), session
handling (re-login once on 106/107/119, 1-minute login failure cooldown), error messages, decision log. Read
it first. Relevant facts from it:
- All `SYNO.Foto.*` calls go to `POST <url>/webapi/entry.cgi` with `api`, `version`, `method`, `_sid`;
  answers are `{"success":true,"data":...}` / `{"success":false,"error":{"code":N}}` also with HTTP 200.
- `SYNO.Foto.Sharing.Misc` max version **2**; `list_shared_with_me_album` with **v2 works** on the test NAS
  (verified 2026-11-16, returned 0 albums).
- `SYNO.Foto.Browse.Item list` with `album_id=<id>` (not `id`!), `offset`, `limit`,
  `additional=["thumbnail","resolution","orientation"]`. Item fields: `id`, `filename`, `type`
  (`photo`/`live`/`video`), `additional.resolution.{width,height}`, `additional.thumbnail.{cache_key,unit_id}`.
- Thumbnail (Personal Space, verified): `SYNO.Foto.Thumbnail` v2 `get`, `id=<item id>`,
  `cache_key="<key>"`, `type="unit"`, `size="m"|"xl"`; cache key is not validated by the NAS.
- Original (Personal Space, verified): `SYNO.Foto.Download` v2 `download`, `unit_id=[<id>]` (one id = raw
  file; two ids = ZIP; error = JSON).

**2. esp32-photoframe-server PR #63** (https://github.com/aitjcize/esp32-photoframe-server/pull/63, merged
2026-09-28, tested on **DSM 7.4.1-90080**; a Go client, unofficial):
- Shared-with-me list: `api=SYNO.Foto.Sharing.Misc&version=1&method=list_shared_with_me_album&offset=..&limit=..`
  (`list_shared_with_me` does not exist → error 103).
- Items of a shared album: `SYNO.Foto.Browse.Item list` with `passphrase=<token>` (unquoted) and **no**
  `album_id`. Sending both → `{"error":{"code":120,"errors":{"reason":"Bad parameters. album id and passphrase both set ..."}}}`.
  Owned albums that are link-shared also carry a `passphrase` field; they must be read with `album_id` only.
- Thumbnail of a shared item: `SYNO.Foto.Thumbnail get` with `passphrase="<token>"` (JSON-quoted), **no**
  `album_id` (both → HTTP 404), and `type="item"` with the item `id`: with `type="unit"` the id is looked up as
  a unit and gives 404 when the item's `unit_id` differs from its `id` (fixture: item 238228, unit 236492).
- The JSON fields of a shared-with-me album are **not shown** in the PR. Download with passphrase and whether
  `_sid` is needed are **not covered**.

**3. inkypi-synology-photos issue #2** (https://github.com/chriswoj/inkypi-synology-photos/issues/2, open):
`SYNO.Foto.Thumbnail` v1 with `type=unit` and an (apparently empty) `passphrase` gives error 119 — no
resolution; probably a wrong/empty passphrase.

**4. nology-api** (https://docs.rs/nology-api/0.0.2/src/nology_api/album.rs.html): `list_shared_with_me_album`
at `SYNO.Foto.Sharing.Misc` **v2** with `offset`/`limit`; passphrase used in place of an album id for shared
albums.

**5. zeichensatz/SynologyPhotosAPI** (https://github.com/zeichensatz/SynologyPhotosAPI): unofficial API list;
the author did not check all parameters.

**No live probe was done for this feature** (developer's decision: plan without probe). The test account has
**no** shared album yet; the developer must share an album from a second NAS user with the test account
before the final test.

### Key files and directories
- `backend/internal/connector/synology/types.go` — API names/versions, error codes, `Album`, `Item`,
  `ItemPage`, `listData[T]`.
- `backend/internal/connector/synology/client.go` — `Client`: `call`, `callInto`, `download`, `withSession`,
  `apiParams`, `setRange`, `listAlbums`, `listItems(filterParam, filterID, offset, limit)`,
  `thumbnail(id, cacheKey, size)`, `original(id)`, `APIError`, `StatusError`.
- `backend/internal/connector/synology/session.go` — `session`, `sessionCache` (one entry per connector id,
  replaced when the `Config` differs).
- `backend/internal/connector/synology/kind.go` — `Kind`, `Kind.Client(connectorID, stored)`.
- `backend/internal/connector/synology/service.go` — `Service` (`Albums`, `AlbumItems`, `Folder`,
  `FolderItems`, `Thumbnail`, `Source`, `client`), `imageSource.Image` / `preview`, `parseAssetID`,
  `itemPage`, `listAll`, `checkPage`, `validCacheKey`, `upstream`.
- `backend/internal/connector/synology/handler.go` — routes `/api/connectors/{id}/synology/...`,
  `albumResponse`, `assetResponse`, `assetPageResponse`, `pathInt64`, `pageParam`, thumbnail headers.
- `backend/internal/photo/service.go` — `photo.Source.Image(ctx, assetID, size)`, `SourceImage{Body,
  ContentType, Fallback}`; `photo/model.go` — `SourceAssetID` size 200.
- `frontend/src/app/core/models/synology.ts` — `SynologyAlbum`, `SynologyAsset` (`thumbnailKey`),
  `SynologyAssetPage`, `synologyThumbnailUrl(connectorId, asset)`.
- `frontend/src/app/core/api/synology.api.ts` — `SynologyApi` (`albums`, `albumAssets`, `folder`,
  `folderAssets`).
- `frontend/src/app/features/editor/import/synology-import-dialog.{ts,html,scss}` — Synology dialog with
  `mat-tab-nav-bar` tabs "Albums" / "Folders".
- `frontend/src/app/features/editor/import/{album-list.ts,asset-grid.ts}` — shared generic components.
- `doc/architecture.md` (section "Synology connector", API table), `README.md`.

### Existing patterns to follow
- Own albums: `Service.Albums` + `Service.AlbumItems` + handler `albums` / `albumAssets` + "Albums" tab in
  `synology-import-dialog` — the shared-albums code mirrors them.
- `doc/architecture.md` for layering (handler → service → client, `apperr` errors, `httpapi` helpers;
  `HttpClient` only in `frontend/src/app/core/api/`).
- All UI texts English with i18n ids (`i18n="@@<feature>.<key>"`, `$localize`).

### Commands
```sh
make dev-up && make dev-shell                 # host: start + enter the dev container
make backend-run                              # container: Go server on :8080
make frontend-serve                           # container: ng serve on :4200 (proxy /api -> :8080)
cd backend && go build ./... && go vet ./...  # backend verification
cd frontend && npx ng build                   # frontend verification
```

### Environment / prerequisites
- Test NAS: `https://bollyeahnas.synology.me:60333`, the developer's account (Photos app only). Credentials are
  never written to files in the repo.
- **For the final test:** a second NAS user shares an album with the test account (Synology Photos → album →
  Share → add the test account), ideally with some EXIF-rotated photos; optionally one album with the
  "viewer" role to test the original fallback.

### Domain terms
- **Shared with me album:** an album of another NAS user that is shared with the connector account.
- **Passphrase / share token:** random token that Synology generates per shared album; needed to read the
  album's photos. Never sent to the browser in this feature.
- **Shared asset id:** `s:<albumId>:<itemId>` — asset id of a photo from a shared album.
- Other terms (Personal Space, sid, cache_key, item/unit): see the previous plan.

### External references
- https://github.com/aitjcize/esp32-photoframe-server/pull/63 (DSM 7.4.1) — unofficial.
- https://github.com/chriswoj/inkypi-synology-photos/issues/2 — unofficial.
- https://docs.rs/nology-api/0.0.2/src/nology_api/album.rs.html — unofficial.
- https://github.com/zeichensatz/SynologyPhotosAPI — unofficial.
- https://kb.synology.com/en-sg/DSM/help/SynologyPhotos/sharing?version=7 — official user help (sharing roles).

## Decision log

- **Final test (developer, 2026-11-17):** listing shared albums and importing from them work on the test NAS
  with the API forms below (list `SYNO.Foto.Sharing.Misc` v2 gives a usable album `id` + `passphrase`; items
  with unquoted `passphrase`; thumbnail `type="item"` + quoted passphrase). Not separately confirmed: the
  "viewer"-role fallback for originals, and whether `_sid` is needed together with the passphrase (always
  sent). Feature approved.
- **Feasibility / probe (developer, 2026-11-17):** implement without a live probe; the unverified API facts
  are checked by the developer's final test with a shared album. — *Rejected:* create a shared album first
  and probe read-only (lower risk of rework, developer chose speed).
- **Share token handling (developer):** routes, browser and DB use the album id; the backend looks up the
  passphrase from `list_shared_with_me_album` and caches album id → passphrase in memory per connector
  session cache entry; a miss reloads the list once; still unknown → 404 (`apperr` not found). — *Rationale:*
  the token is a share secret and stays on the server. *Rejected:* token in URLs and in `source_asset_id`
  (simpler, but stores the secret in the DB and the browser). **Fallback if the list has no stable album
  `id`:** stop and ask the developer (the rejected option is then the candidate).
- **Shared asset id:** `s:<albumId>:<itemId>`, both positive decimals in canonical form; parsed by one
  function used by the thumbnail route and the import. Own photos keep plain decimal ids (no migration). —
  *Rationale:* `photo.Source.Image` gets only the asset id; the album is needed to find the passphrase.
  Consequence: the same photo in two shared albums has two ids ("Imported" mark per album) — accepted, rare.
- **Original refused (developer):** if `SYNO.Foto.Download` for a shared photo returns a Synology API error
  (e.g. no permission because of the "viewer" role), the import uses the `xl` thumbnail with
  `Fallback=true`. Transport errors and session errors stay errors (session errors are already retried by
  `withSession`). — *Rejected:* fail with an error.
- **Tab UI (developer):** third tab "Shared with me", always visible; shared `AlbumList` (name, photo count,
  album icon, filter); empty text "No albums are shared with this account."; no owner name. — *Rejected:*
  owner name (unverified fields, needs `AlbumList` change); hide the tab when empty (extra NAS request).
- **API forms used (best known, unverified):** list `SYNO.Foto.Sharing.Misc` **v2** (v2 verified to exist on
  the test NAS); items `SYNO.Foto.Browse.Item list` with `passphrase=<token>` unquoted, no `album_id`;
  thumbnail `SYNO.Foto.Thumbnail` v2 with `id=<item id>`, `type="item"`, `passphrase="<token>"` (quoted),
  `cache_key`, `size`; original `SYNO.Foto.Download` v2 with `unit_id=[<id>]` and `passphrase="<token>"`;
  `_sid` sent always. Source: PR #63 (DSM 7.4.1). If the final test shows other forms, change them and
  record the verified form here.
- **Item filter / paging / sorting:** same as own albums (photos + Live Photos, pages of 250 with
  `nextPage`; album list all pages of 500, sorted by name case-insensitive, then id).
- **Invalid shared albums (step 1):** list entries with `id <= 0` or an empty passphrase are dropped from the
  list and the cache (→ 404) — *Rationale:* an empty passphrase would send an unfiltered item list (whole
  library).
- **Refused original (step 1):** only a Synology `*APIError` that is neither a login nor a session error
  triggers the `xl` fallback. The passphrase lookup runs before the download: an album that is no longer
  shared gives 404, no fallback.
- **Thumbnail route checks (step 1):** the asset id is checked before the key; an invalid id gives
  `invalid Synology asset id "<id>"` (400).
- **Concurrent cache misses (step 1):** not de-duplicated (each miss may reload the list; map access is
  mutex-guarded) — accepted, rare.
- **Workflow (developer, 2026-11-17):** implement all steps one after another with sub-agents, no review stop
  after each step; the developer tests at the end. Stop and ask only for real decisions.
- **Branch:** no feature branch, work on `main`; no commits unless the developer asks.
- **Testing:** no automated tests (project rule in `AGENTS.md`).

## Testing strategy

No automated tests, manual review only. After every step: `cd backend && go build ./... && go vet ./...` and
`cd frontend && npx ng build`. Optional temporary Go test against an `httptest` fake NAS (delete it again,
like in the previous plan). Final manual test by the developer against the test NAS with a shared album.

## Steps

### Step 1 — Backend: shared albums, items, thumbnail, import
- **Status:** done (reviewed 2026-11-17)
- **What:**
  - `types.go`: `apiSharingMisc = "SYNO.Foto.Sharing.Misc"`, version 2; type `SharedAlbum` (`id`, `name`,
    `item_count`, `passphrase`).
  - `client.go`: `listSharedAlbums(offset, limit)`; item list with `passphrase` instead of a filter id;
    `thumbnail` and `original` with an optional passphrase (shared: `type="item"`, quoted passphrase).
  - `session.go` (cache entry) + `service.go`: passphrase cache album id → passphrase per connector entry,
    reload once on miss, unknown → not found; `SharedAlbums` (all pages, sorted), `SharedAlbumItems(albumID,
    page)`; `Thumbnail` accepts a shared asset ref; `parseAssetRef` (`<id>` or `s:<albumId>:<itemId>`) used by
    the thumbnail route and `imageSource.Image`; original refused (API error) → `xl` with `Fallback=true`.
  - `handler.go`: `GET /api/connectors/{id}/synology/shared-albums` (same shape as `albums`),
    `GET /api/connectors/{id}/synology/shared-albums/{albumId}/assets?page=N` (asset `id` =
    `s:<albumId>:<itemId>`); thumbnail route `assets/{assetId}/thumbnail` accepts both id forms.
- **Acceptance criteria:** builds and vet pass; with a shared album on the NAS the routes return the album and
  its photos, the thumbnail URL returns a JPEG, another user's connector → 404, invalid ids → 400.
- **Notes:**
  - `types.go`: `apiSharingMisc` (v2), `SharedAlbum {ID, Name, ItemCount, Passphrase}`.
  - `client.go`: `Client` holds `passphrases *passphraseCache` (passed to `newClient`); `listSharedAlbums`;
    `listItems` takes a filter name + string value (passphrase unquoted, no `album_id`);
    `thumbnail(..., passphrase)` → shared: `type="item"` + quoted passphrase, own: `type="unit"`;
    `original(id, passphrase)` adds the quoted passphrase if set.
  - `session.go`: `passphraseCache` (mutex, `replace` swaps the whole map); the per-connector cache entry
    holds session + passphrase cache (`forConnector` returns both); config change → new entry → cache cleared.
  - `kind.go`: `Client` / `Test` pass the cache (`Test` gets its own empty one).
  - `service.go`: `SharedAlbums` (all pages, refreshes the cache, sorted), `SharedAlbumItems`,
    `sharedPassphrase` (miss → reload once → still unknown → `apperr.ErrNotFound`); `parseAssetRef` (+
    `assetRef`, `parseCanonicalID`) replaces `parseAssetID`; `Thumbnail` takes the asset id string;
    `imageSource.Image` handles both forms; shared original refused (`*APIError`, not login/session) → `xl`
    with `Fallback=true`.
  - `handler.go`: routes `GET .../synology/shared-albums`, `.../shared-albums/{albumId}/assets?page=N`
    (asset id `s:<albumId>:<itemId>`); thumbnail route passes the raw `assetId` (URL-encoded `s%3A..` works).
  - Small decisions: see decision log "(step 1)".
  - Verified: `go build ./... && go vet ./...`, gofmt; temporary `httptest` fake-NAS test (deleted) for all
    sent params, cache miss/reload/404, `s:` parsing (15 invalid forms), fallback, handler responses (no
    token in responses). Not tested against the real NAS.

### Step 2 — Frontend: "Shared with me" tab
- **Status:** done (reviewed 2026-11-17)
- **What:** `SynologyApi.sharedAlbums(connectorId)`, `sharedAlbumAssets(connectorId, albumId, page)`;
  `synologyThumbnailUrl` encodes the asset id (`encodeURIComponent`, the `s:` id has colons); third tab in
  `synology-import-dialog` with `AlbumList` → asset grid (paging, selection, size toggle, import, "Imported"
  marks); empty text; new i18n ids `@@import.synology.tabs.shared`, `@@import.synology.shared.empty`.
- **Acceptance criteria:** `npx ng build` passes; in the browser the tab lists shared albums, photos can be
  imported in preview and original size, rotated photos are upright, imported photos are marked; "Albums" and
  "Folders" unchanged.
- **Notes:**
  - `core/api/synology.api.ts`: `sharedAlbums(connectorId)`, `sharedAlbumAssets(connectorId, albumId, page)`.
  - `core/models/synology.ts`: `synologyThumbnailUrl` already encoded the id; the fallback key now uses the
    item id part (after the last `:`) → `<itemId>_0`; doc comments mention the `s:` form.
  - `features/editor/import/synology-import-dialog.{ts,html}`: `SynologyTab` + `'shared'`; signal
    `sharedAlbums` (loaded once per dialog instance in `showTab`); `loadAssetPage` uses `sharedAlbumAssets`
    when an album is open on the shared tab; third tab link "Shared with me"; shared list via `AlbumList`
    (`coverUrl` null); empty text shown by the dialog (not `AlbumList`'s generic text).
  - Small decisions: the open album's source is derived from `tab()` (the tab bar is hidden while an album
    is open, so the tab cannot change); tab order Albums, Folders, Shared with me.
  - New i18n ids: `@@import.synology.tabs.shared`, `@@import.synology.shared.empty`.
  - Verified: `npx ng build` (no errors/warnings), prettier clean. Not tested in the browser.

### Step 3 — Documentation
- **Status:** done (reviewed 2026-11-17)
- **What:** `doc/architecture.md` (Synology section: shared albums, routes in the API table, asset id format
  `s:<albumId>:<itemId>`, passphrase cache, unverified API facts); `README.md` (feature list: albums shared
  with the account). Then set this plan to `done` and move it to `doc/agent-plans/done/` after the
  developer's final test.
- **Acceptance criteria:** the developer reviews the docs.
- **Notes:**
  - `doc/architecture.md`: Synology scope incl. "Shared with me"; package table (`passphraseCache` in
    `session.go`, shared functions + `parseAssetRef` in `service.go`); new paragraphs "Asset id" and "Shared
    albums" (list call, server-side passphrase cache, API forms, `xl` fallback, UNVERIFIED note with link to
    PR #63 and to `agent-plans/done/synology-shared-albums.md`); frontend table (third tab); data model
    (`source_asset_id` `s:` form); API table (2 new routes, thumbnail route accepts both id forms); domain term.
  - `README.md`: feature list and section "Connect a Synology Photos NAS" mention shared albums.
  - The link to `doc/agent-plans/done/synology-shared-albums.md` works only after the plan is moved.

## Open questions

- Not separately confirmed in the final test: the `xl` fallback when the owner gave only the "viewer" role
  (original refused), and whether `_sid` is needed together with the passphrase (it is always sent).

## Current state / Next action

Feature done and approved by the developer (2026-11-17) after the final manual test (listing and importing
from shared albums on the test NAS). Plan moved to `doc/agent-plans/done/`. No open work. Not committed yet
(commit only on the developer's request).
