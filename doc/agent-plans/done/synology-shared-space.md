# Synology Shared Space

**Ticket/Source:** none (follow-up of `doc/agent-plans/done/synology-connector.md` and
`doc/agent-plans/done/synology-shared-albums.md`; developer, 2026-11-17: "let's investigate in the 'Shared
Space' feature - can this be implemented analogous to the shared-with[-me feature]")
**Branch:** none — work directly on `main` (decision of the developer)
**Status:** done

## Goal

The Synology connector can import photos from the **Shared Space** (also called Team Space) of Synology
Photos: a folder tree that the NAS admin shares with several users. The Synology import dialog gets a fourth
tab "Shared Space" with folder navigation like the "Folders" tab (Personal Space). The tab is shown only if the
connector account has access to the Shared Space.

## Scope

**In scope:**
- Backend: availability check, folder navigation (folder + subfolders, photos of a folder, pages), thumbnail
  proxy and import (preview + original) for Shared Space photos, via the `SYNO.FotoTeam.*` API.
- Frontend: fourth tab "Shared Space" in `synology-import-dialog`, hidden when the account has no access.
- Docs: `doc/architecture.md`, `README.md`.

**Out of scope:**
- Shared Space photos that appear in own albums ("Albums" tab): current behaviour unchanged (unverified
  whether their import works).
- FotoTeam albums, timeline, persons, search, `list_with_filter`.
- Write access, sync, 2FA (same as the earlier Synology plans).

## Rough Architecture / Concept

- The Shared Space is **folder-based** (not album-based like "Shared with me"). Its API family
  `SYNO.FotoTeam.*` mirrors the Personal Space folder APIs of `SYNO.Foto.*` (same method and parameter
  names according to the unofficial docs). No share token (passphrase) is involved: access is a permission of
  the account.
- **Backend:** the Synology client gets a **space** parameter (Personal → `SYNO.Foto.*`, Shared Space →
  `SYNO.FotoTeam.*`) for the existing calls `getFolder`, `listFolders`, `listItems`, `thumbnail`,
  `original`; only the API name (and version) changes. New service functions and routes under
  `/api/connectors/{id}/synology/shared-space/...`. Asset id of a Shared Space photo: `t:<itemId>`,
  parsed by the existing `parseAssetRef`, so the thumbnail route and the import (`imageSource.Image`) choose the
  FotoTeam API. The `photo` package and the import API stay unchanged.
- **Availability:** `GET .../synology/shared-space` → `{"available": bool}`; `false` when the NAS answers
  error **801** (seen on the test NAS for an account without Shared Space access; meaning not documented).
  Other errors stay errors.
- **Frontend:** the dialog calls the availability route when it opens; the tab "Shared Space" is shown only
  with `available: true`. If the check fails with another error, the tab is shown and the error appears when
  it is opened. The folder navigation code (trail, folder, `openFolder`, `loadAssetPage`) is generalized
  with a space parameter and used by "Folders" and "Shared Space".
- *Why:* maximal reuse of the verified Personal Space folder code; no new libraries; no change of the
  connector-neutral `photo` package.

## Context for a new agent

### Sources read (summarized)

**1. Earlier plans** (read first): `doc/agent-plans/done/synology-connector.md` (verified Personal Space API
facts, session handling, error messages) and `doc/agent-plans/done/synology-shared-albums.md` (shared albums,
`parseAssetRef` with `s:<albumId>:<itemId>`, passphrase cache). Relevant verified facts:
- Personal Space folders (verified 2026-11-16): `SYNO.Foto.Browse.Folder` v2 `get` without `id` → root
  `{"folder":{"id":978,"name":"/","parent":978}}` (root's `parent` = own id); `get&id=N`; `list&id=N` →
  direct subfolders (`name` is the full path); `list` without `id` → children of root.
  `SYNO.Foto.Browse.Item` v1 `list` with `folder_id` → only direct photos.
  `SYNO.Foto.Thumbnail` v2 `get` `id`, `cache_key="..."`, `type="unit"`, `size="m"|"xl"`.
  `SYNO.Foto.Download` v2 `download` `unit_id=[id]`.
- First probe (2026-11-16): `SYNO.FotoTeam.Browse.Folder` `list` with the test account → **error 801**
  (no Shared Space access at that time).

**2. zeichensatz/SynologyPhotosAPI README** (https://github.com/zeichensatz/SynologyPhotosAPI, unofficial;
author checked only a few APIs): "`SYNO.FotoTeam.*` offers access to all folders in the Shared Space"; "The
APIs with similar names should be quite the same referring to their methods and responses". Examples:
- `api=SYNO.FotoTeam.Browse.Folder&version=1&method=list&offset=0&limit=100&id=153`; top level with
  `method=list_parents`. Folder fields: `id`, `name`, `owner_user_id`, `parent`, `passphrase`, `shared`, ...
- `api=SYNO.FotoTeam.Browse.Item&version=1&method=list&offset=0&limit=100&folder_id=608&additional=["thumbnail"]`
  (item fields like Personal Space, `additional.thumbnail.{cache_key, m, sm, xl, preview, unit_id}`).
- `api=SYNO.FotoTeam.Thumbnail&method=get&version=1&id=40808&cache_key=40808_1633659236&type=unit&size=sm`.
- `api="SYNO.FotoTeam.Download"&method="download"&version=1&cache_key="40808_1633659236"&unit_id=[40808]`.
- No FotoTeam album API in the README (cmeans issue #258 lists one — conflict).

**3. zeichensatz issue #19** (https://github.com/zeichensatz/SynologyPhotosAPI/issues/19): on DSM 7.3.2
Update 1 / Photos 1.8.2 the FotoTeam thumbnail URL gave HTTP 404; `/synofoto/api/v2/t/Thumbnail/get` "with
the same parameters" worked (single report, parameters not given).

**4. esp32-photoframe-server issue #55** (https://github.com/aitjcize/esp32-photoframe-server/issues/55,
DSM 7.4.1): Shared Space items have `owner_user_id: 0`; `SYNO.Foto.Browse.Item list` with `album_id` lists
items of both spaces; `SYNO.FotoTeam.Browse.Item get` returns Shared Space items, `SYNO.Foto.Browse.Item get`
does not; thumbnails with `type="item"` worked for 838/838 Shared Space photos in an album.

**5. cmeans/mcp-synology issue #258** (https://github.com/cmeans/mcp-synology/issues/258): Photos parses all
parameter values as JSON; `SYNO.Foto.Setting.TeamSpace` manages Shared Space folders/permissions; error 160
for a user without Photos app permission (unverified).

**Error 801** is not documented in any source; on the test NAS it came for an account without Shared Space
access.

**No live probe was done for this feature** (developer's decision). The developer enables Shared Space in
Synology Photos (admin), gives the test account access and adds photos (subfolders, EXIF-rotated photos)
before the final test.

### Key files and directories
- `backend/internal/connector/synology/types.go` — API names/versions, `Folder`, `FolderContent`, `Item`,
  `ItemPage`.
- `backend/internal/connector/synology/client.go` — `getFolder(id)`, `listFolders(id, offset, limit)`,
  `listItems(filterParam, filterValue, offset, limit)`, `thumbnail(id, cacheKey, size, passphrase)`,
  `original(id, passphrase)`, `APIError` (codes), `call`, `download`, `withSession`.
- `backend/internal/connector/synology/service.go` — `Folder`, `FolderItems` (root handling with
  `RootFolderID`), `Thumbnail`, `imageSource.Image` / `preview`, `isRefusal`, `assetRef`, `parseAssetRef`,
  `parseCanonicalID`, `itemPage`, `listAll`.
- `backend/internal/connector/synology/handler.go` — routes, `folder` / `folderAssets` handlers,
  `toFolderResponse`, `toAssetPageResponse`, `folderParam`, `pageParam`.
- `frontend/src/app/core/api/synology.api.ts`, `frontend/src/app/core/models/synology.ts`
  (`SYNOLOGY_ROOT_FOLDER`, `SynologyFolder`, `synologyThumbnailUrl` — fallback key uses the part after the last
  `:`).
- `frontend/src/app/features/editor/import/synology-import-dialog.{ts,html,scss}` — tabs `albums` / `folders`
  / `shared`; folder state `trail`, `folder`, `openFolder`, `loadAssetPage`, `rootFolderName`.
- `doc/architecture.md` (Synology section, API table), `README.md` (says Shared Space is not supported).

### Existing patterns to follow
- Personal Space folders: `Service.Folder` / `FolderItems`, handlers `folder` / `folderAssets`, "Folders" tab.
- Shared-album asset id handling (`s:` prefix in `parseAssetRef`) for the new `t:` prefix.
- Layering per `doc/architecture.md`; UI texts English with i18n ids.

### Commands
```sh
make dev-up && make dev-shell                 # host: start + enter the dev container
make backend-run                              # container: Go server on :8080
make frontend-serve                           # container: ng serve on :4200 (proxy /api -> :8080)
cd backend && go build ./... && go vet ./...  # backend verification
cd frontend && npx ng build                   # frontend verification
```

### Environment / prerequisites
- Test NAS `https://bollyeahnas.synology.me:60333`, developer's account; credentials never in repo files.
- Shared Space enabled and test account with access (developer, before the final test).

### Domain terms
- **Shared Space / Team Space:** shared folder tree of Synology Photos, API family `SYNO.FotoTeam.*`.
- **Space:** Personal Space (`SYNO.Foto.*`) or Shared Space (`SYNO.FotoTeam.*`) in the client.
- **Shared Space asset id:** `t:<itemId>`.
- Other terms: see the earlier plans.

### External references
- https://github.com/zeichensatz/SynologyPhotosAPI (+ issue #19) — unofficial.
- https://github.com/aitjcize/esp32-photoframe-server/issues/55 — unofficial, DSM 7.4.1.
- https://github.com/cmeans/mcp-synology/issues/258 — unofficial.

## Decision log

- **Final test (developer, 2026-11-17):** with Shared Space enabled and access for the test account, the tab
  shows, folder navigation, thumbnails and import work with the API forms below (FotoTeam v1, root
  `get`/`list` without `id`, thumbnail `type="unit"`, download `unit_id=[id]`). Feature approved.
- **Probe (developer, 2026-11-17):** developer enables Shared Space and gives the test account access; plan
  without a live probe, verify in the final test. — *Rejected:* probe first (lower rework risk); stop here.
- **No access (developer):** the dialog checks availability when it opens and **hides** the tab on error 801;
  other errors → tab visible, error shown when it is opened (agent default, not objected) — *Rejected:* tab
  always visible with a message (developer prefers a hidden tab; cost: one NAS request per dialog open).
- **Scope (developer):** folder tree only. — *Rejected:* also fix Shared Space photos inside own albums
  (more unverified behaviour, touches the "Albums" tab).
- **Architecture:** space parameter in the existing client calls instead of copies; routes under
  `.../synology/shared-space/...` mirroring `folders/...`; asset id `t:<itemId>`; availability route
  `GET .../synology/shared-space` → `{"available": bool}`.
- **API forms used (best known, unverified):** `SYNO.FotoTeam.Browse.Folder` v1 `get`/`list` (root without
  `id`, like Personal Space; `list_parents` is the alternative if this fails), `SYNO.FotoTeam.Browse.Item` v1
  `list` with `folder_id`, `SYNO.FotoTeam.Thumbnail` v1 `get` with `type="unit"` and the item id,
  `SYNO.FotoTeam.Download` v1 `download` with `unit_id=[id]`. Alternatives if the final test fails:
  thumbnail `type="item"`, versions from `SYNO.API.Info`, `/synofoto/api/v2/t/Thumbnail/get`.
- **Original fallback:** same as Personal Space (non-JPEG/PNG/WebP original → `xl` with `Fallback=true`).
- **Space type (step 1):** `space` struct of API refs (not an enum switch); Personal Space built from the
  existing constants so it cannot drift.
- **801 handling (step 1):** only a non-login `APIError` 801 gives `available:false`; other errors → 502.
  On the folder routes 801 shows the generic message "Synology request SYNO.FotoTeam.Browse.Folder failed
  (error code 801)" — accepted, because the tab is hidden on 801.
- **`t:` ids (step 1):** exactly one positive canonical id (`t:0`, `t:01`, `t:`, `t:1:2` → 400); original
  rule like Personal Space (non-decodable type → `xl` fallback; refusal → upstream error, no fallback).
- **Workflow (developer, 2026-11-17):** all steps with sub-agents, no review stop; developer tests at the end.
- **Branch:** `main`, no commits unless the developer asks.
- **Testing:** no automated tests (`AGENTS.md`); builds + final manual test.

## Testing strategy

No automated tests, manual review only. After every step: `cd backend && go build ./... && go vet ./...` and
`cd frontend && npx ng build`. Optional temporary Go test with an `httptest` fake NAS (deleted afterwards).
Final manual test by the developer against the test NAS with Shared Space enabled.

## Steps

### Step 1 — Backend: space parameter, routes, `t:` ids, import
- **Status:** done (reviewed 2026-11-17)
- **What:** space parameter in the client calls (API name + version per space); `Service.SharedSpaceAvailable`
  (root `get`; error 801 → `false`), `SharedSpaceFolder`, `SharedSpaceFolderItems` (mirroring `Folder` /
  `FolderItems`); routes `GET .../synology/shared-space`, `.../shared-space/folders/{folderId}`,
  `.../shared-space/folders/{folderId}/assets?page=N` (asset ids `t:<itemId>`); `parseAssetRef` accepts
  `t:<itemId>`; thumbnail route and `imageSource.Image` use the FotoTeam API for `t:` ids.
- **Acceptance criteria:** builds and vet pass; Personal Space and shared albums unchanged; with Shared Space
  access the routes return folders, photos and thumbnails; without access `available: false`.
- **Notes:** (implemented 2026-11-17)
  - `types.go`: FotoTeam API constants (Browse.Folder, Browse.Item, Thumbnail, Download, all v1); `apiRef{name,
    version}` with `params(method)`; `space` struct (`browseFolder`, `browseItem`, `thumbnail`, `download`)
    with values `personalSpace` (built from the existing constants) and `sharedSpace`; `codeNoSharedSpace = 801`.
  - `client.go`: `getFolder`, `listFolders`, `listItems`, `thumbnail`, `original` take `sp space`.
  - `service.go`: private `folder` / `folderItems` with a space (used by `Folder`, `FolderItems` and the new
    `SharedSpaceFolder`, `SharedSpaceFolderItems`); `SharedSpaceAvailable`; `itemPage` takes a space;
    `assetRef.SharedSpace` + `space()`, `t:<itemId>` in `String()` / `parseAssetRef`.
  - `handler.go`: routes `GET .../synology/shared-space`, `.../shared-space/folders/{folderId}`,
    `.../shared-space/folders/{folderId}/assets`; helpers `writeFolder`, `writeFolderAssets`;
    `toAssetPageResponse(p, origin assetRef)` sets the id form.
  - Verified: build, vet, gofmt; temporary `httptest` fake NAS (deleted): Personal Space params unchanged,
    FotoTeam names/versions, 801 → `available:false`, `t:` parsing, HEIC → `xl` fallback.

### Step 2 — Frontend: "Shared Space" tab
- **Status:** done (reviewed 2026-11-17)
- **What:** `SynologyApi.sharedSpace`, `sharedSpaceFolder`, `sharedSpaceFolderAssets`; availability check
  when the dialog opens; fourth tab "Shared Space" (hidden when `available: false`); folder navigation
  generalized with a space parameter; root label "Shared Space"; i18n ids `@@import.synology.tabs.sharedSpace`,
  `@@import.synology.sharedSpace.root`.
- **Acceptance criteria:** `npx ng build` passes; tab hidden without access; with access folder navigation,
  paging, import (preview/original), "Imported" marks work; other tabs unchanged.
- **Notes:** (implemented 2026-11-17)
  - `core/api/synology.api.ts`: `sharedSpace`, `sharedSpaceFolder`, `sharedSpaceFolderAssets`.
  - `core/models/synology.ts`: `SynologySharedSpace {available}`; doc comments for `t:` ids.
  - `synology-import-dialog.{ts,html}`: availability check in the constructor with its own subscription
    (`takeUntilDestroyed`), independent of `load()`/`loading`; `sharedSpaceAvailable` `null` (pending, tab
    hidden) → `true`/`false`; on error `true`. `FolderSpace = 'personal' | 'sharedSpace'` +
    `FOLDER_SPACE_OF_TAB`; one trail per space (private signal, `trail` computed from the tab); one `folder`
    signal (reloaded on tab switch); helpers `folderRequest`, `folderAssetsRequest`; `rootFolderName`
    computed ("Personal Space" / "Shared Space"); root id `root` for both spaces.
  - New i18n ids: `@@import.synology.tabs.sharedSpace`, `@@import.synology.sharedSpace.root`.
  - Verified: `npx ng build` (no errors/warnings), prettier clean. Not tested in the browser.

### Step 3 — Documentation
- **Status:** done (reviewed 2026-11-17)
- **What:** `doc/architecture.md` (Shared Space in the Synology section, routes, `t:` id, space parameter,
  unverified API forms); `README.md` (Shared Space supported). After the developer's final test: plan to
  `done`, move to `doc/agent-plans/done/`.
- **Acceptance criteria:** the developer reviews the docs.
- **Notes:** (implemented 2026-11-17)
  - `doc/architecture.md`: package/file tables (`space`, FotoTeam constants, `SharedSpaceAvailable`), scope
    incl. Shared Space, asset id `t:<itemId>`, new subsection "Shared Space (Team Space)" with UNVERIFIED API
    forms + alternatives and link to `agent-plans/done/synology-shared-space.md`, frontend table (4th tab),
    data model, API table (3 routes, thumbnail accepts `t:`), domain term.
  - `README.md`: feature list and Synology section mention the Shared Space; admin must enable it and grant
    access; "no Shared Space" removed.

## Open questions

- Meaning of error 801 is still undocumented (assumed: no Shared Space access). The thumbnail path
  `/synofoto/api/v2/t/Thumbnail/get` reported for DSM 7.3.2 was not needed on the test NAS.

## Current state / Next action

Feature done and approved by the developer (2026-11-17) after the final manual test. Plan moved to
`doc/agent-plans/done/`. No open work. Not committed yet (commit only on the developer's request).
