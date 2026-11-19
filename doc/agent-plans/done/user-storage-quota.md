# Storage quota per user

**Ticket/Source:** none (idea of the developer, 2026-11-14; grilled 2026-11-19)
**Branch:** none
**Status:** done

## Goal

Each user can store only a limited total amount of photo file bytes on the server. The size of every
stored photo file is saved in the `photos` table. A new photo (local upload, connector import, duplicated
collage) is refused with a clear error when it would make the user's total larger than the user's limit.
The limit is a server-wide default (the existing admin system setting, default 2 GB) that the admin can
override per user. Admins see "used / max" per user in the admin user list; every user sees their own
usage on the Profile page. A CLI command recalculates the stored sizes from the files on disk.

## Scope

**In scope:**
- Column `photos.size_bytes` (`photo.Photo.SizeBytes`), set for uploads, imports and duplicates.
- CLI `collageomat photos recalc-size --username <name> | --all` (sets `size_bytes` from the files).
- Column `users.max_storage_bytes` (`auth.User.MaxStorageBytes`, nullable = server default).
- Enforcement on upload, import (all connector types) and duplicate collage; HTTP 409 with a message.
- Admin user list column "Storage" (used / max); limit fields in the admin edit **and** create dialogs.
- Remove the hint "Not enforced yet" on the admin Settings tab.
- `GET /api/profile/storage` and a storage text on the Profile page.
- Docs: `doc/architecture.md`, `doc/development.md`, `doc/deployment.md`.

**Out of scope:**
- An env var for the limit (rejected, see decision log).
- A `--max-storage` flag for the `user add` CLI.
- Avatars in the quota (stored in the DB, max. small).
- Limits on the number of collages/photos; a disk-wide limit.
- Automatic backfill of `size_bytes` at server start (CLI only).
- Partial-import results ("n not imported") — the import stops like on any other error.

## Rough Architecture / Concept

- **Sizes:** `Photo.SizeBytes int64` = bytes of the stored file. `createPhoto` sets `len(img.data)`;
  `CollagePhotos.copyPhoto` sets the number of bytes really copied (counting reader around the source
  file). Existing rows have 0 until the admin runs `photos recalc-size`.
- **Limit:** `auth.User.MaxStorageBytes *int64`: `nil` = server default
  (`settings.Settings.MaxUserStorageBytes`, DB system setting, default `2_000_000_000`), a value = own
  limit; `0` = unlimited in both places.
- **New package `backend/internal/quota`:** resolves the effective limit of a user (own value or setting)
  and gives `Usage(ctx, userID) (used, limit int64, err)`. It gets the used bytes and the user's own
  value through small interfaces (implemented by `photo.GormStore` and a tiny store on `users`), and the
  default through `*settings.Service`. No package imports cycle: `photo` defines its own interface for the
  limit, `main.go` wires `quota.Service` into it.
- **Atomic enforcement:** in `photo.GormStore.CreateWithFile` (one transaction): insert the row (with
  `size_bytes`) → sum `size_bytes` of all photos of the user (join `collages.user_id`) → if limit > 0 and
  sum > limit: roll back and return the quota `apperr.Conflict` → write the file → save `file_name`.
  Inserting first means the transaction already holds the SQLite write lock when it reads the sum, so
  parallel uploads/import workers cannot both pass the check, and there is no read→write lock upgrade
  (which in WAL mode gives `SQLITE_BUSY` that `busy_timeout` does not retry).
- **Pre-checks (fast fail, not the guarantee):** import refuses at once if used ≥ limit (before any
  download); duplicate refuses if used + sum of the source collage's `size_bytes` > limit (before any
  copy; the copy itself also goes through `CreateWithFile`, the whole duplicate is one transaction and is
  rolled back as today).
- **Error:** `apperr.Conflict` → HTTP 409, `{"error": "storage limit reached: 1.95 GB of 2 GB used, the
  photo needs 3.1 MB"}` (duplicate: "...the copy needs ..."). The frontend shows server messages as they
  are (`frontend/src/app/shared/error-message.ts`), so no frontend change for errors.
- **APIs:** admin user list/create/update return `usedStorageBytes`, `maxStorageBytes` (own value or
  null) and `effectiveMaxStorageBytes`; create/update accept `maxStorageBytes` (number ≥ 0 or null);
  `GET /api/profile/storage` returns `{usedBytes, limitBytes}` (`limitBytes` 0 = unlimited).

## Context for a new agent

- **Sources read:**
  - `AGENTS.md`: Go 1.27 stdlib `net/http`, GORM + `glebarez/sqlite`; Angular 22 standalone + signals +
    Material; no automated tests; verify with `go build ./... && go vet ./...` and `npx ng build`; all
    UI texts English and i18n-marked (`i18n="@@<feature>.<key>"`, `$localize`); no new libraries without
    approval; no commits unless asked.
  - `doc/architecture.md`: layering (handler → service → store, GORM only in `store.go`), `apperr`
    kinds, data model, API list.
  - `doc/agent-plans/done/admin-section.md`: built the system setting `maxUserStorageBytes` (DB only,
    default 2 GB in code, decimal GB in the UI, 0 = unlimited, "Not enforced yet" hint that this feature
    removes) and decided that this feature reads the limit from `settings.Service.Get` instead of an env
    var. Per-user overrides were out of scope there; this feature adds them.
  - `doc/agent-plans/encrypted-photos.md` (planning, not built): if built later, encrypted files are
    larger; `size_bytes` must then be the stored (encrypted) size.
- **Key files and directories (facts from the code, 2026-11-19):**
  - `backend/internal/photo/model.go` — `Photo` (no size column yet).
  - `backend/internal/photo/service.go` — `Import` → `importAll` (4 workers, first error stops) →
    `importOne` → `createPhoto`; `Upload` → `readUpload` → process → `createPhoto`. `createPhoto` calls
    `store.CreateWithFile` and writes `img.data` with `files.Save`. `Service.collages.Get(ctx, userID,
    collageID)` checks ownership.
  - `backend/internal/photo/store.go` — `GormStore.CreateWithFile` (tx: create row → writeFile → update
    `file_name`), count queries (`CountAllByCollage`).
  - `backend/internal/photo/collage_photos.go` — `CollagePhotos.CopyAllForCollage` / `copyPhoto`
    (used by duplicate; `files.Save(p.FileName, in)` stream copy).
  - `backend/internal/photo/storage.go` — `DiskStorage` (`os.Root`): `Save`, `Open`, `Remove`,
    `RemoveDir`; `FileStorage` interface in `service.go`.
  - `backend/internal/collage/duplicate.go` — `Service.Duplicate` (one `tx.InTx`, cleanup of files on
    error); `collage.Photos` interface in the collage package.
  - `backend/internal/collage/user_usage.go` — `UserUsage.CountsByUser` (implements `admin.Usage`).
  - `backend/internal/auth/models.go` — `User` (`IsAdmin`, `IsActive`, `LastActiveAt`).
  - `backend/internal/admin/{handler,service,store}.go` — user list/create/update/delete;
    `updateRequest` has required `isAdmin`/`isActive` (pointers, 400 if missing); `UserSummary`;
    `GormStore.UpdateUser` uses a map update.
  - `backend/internal/settings/service.go` — `Settings{MaxUserStorageBytes int64}`, `Defaults()`
    (`2_000_000_000`), `Service.Get`. Comment "It is not enforced yet" must be updated.
  - `backend/internal/profile/{handler,service}.go` — `/api/profile/*` routes.
  - `backend/internal/apperr/apperr.go`, `backend/internal/httpapi/errors.go` — `Conflict` → 409.
  - `backend/cmd/collageomat/main.go` — composition root, `models()`, command switch (`serve`, `user`,
    `help`), `usage` text; `backend/cmd/collageomat/user.go` — CLI pattern (`flag.NewFlagSet`,
    `config.FromEnv`, `openDB`, `db.Close`).
  - `frontend/src/app/core/models/admin.ts` — `AdminUser`, `CreateUserRequest`, `UpdateUserRequest`,
    `SystemSettings`; `frontend/src/app/core/api/admin.api.ts`, `profile.api.ts`.
  - `frontend/src/app/features/admin/users/` — `admin-users.page.{html,ts}` (mat-table, `columns`),
    `user-edit-dialog.ts`, `user-create-dialog.ts`, `user-dialog.scss`.
  - `frontend/src/app/features/admin/settings/admin-settings.page.{html,ts}` — GB field,
    `BYTES_PER_GB = 1_000_000_000`, hint `@@admin.settings.storage.notEnforced`.
  - `frontend/src/app/features/profile/profile.page.{html,scss,ts}` — header with
    `<p class="page-subtitle" i18n="@@profile.memberSince">`.
- **Existing patterns to follow:** cross-package adapters through small interfaces wired in `main.go`
  (`collage.UserUsage`, `photo.CollagePhotos`); grouped count queries in `photo/store.go`; CLI in
  `cmd/collageomat/user.go`; GB conversion in `admin-settings.page.ts`.
- **Commands:**
  - `cd backend && go build ./... && go vet ./...`
  - `cd frontend && npx ng build`
  - Dev: `make dev-up && make dev-shell`, then `make backend-run` and `make frontend-serve`
    (http://localhost:4200).
  - CLI in dev: `cd backend && go run ./cmd/collageomat photos recalc-size --all`
  - DB check: `sqlite3 data/collageomat.db "select id, collage_id, size_bytes from photos"`
- **Environment / prerequisites:** dev container; an admin user (`collageomat user add --username admin
  --admin`); optional Immich connector (`/.env` has a test key).
- **Domain terms:** *quota / storage limit* = max. sum of `photos.size_bytes` of all collages of a user;
  *server default* = system setting `maxUserStorageBytes`; *own limit* = `users.max_storage_bytes`;
  *effective limit* = own limit if set, else server default; GB = 10⁹ bytes.
- **External references:** SQLite WAL / `SQLITE_BUSY_SNAPSHOT` on lock upgrade in deferred transactions:
  https://www.sqlite.org/wal.html , https://www.sqlite.org/rescode.html#busy_snapshot

## Decision log

- **Source of the server default:** the existing DB system setting `maxUserStorageBytes` (Admin >
  Settings), no env var. — *Rationale:* one source of truth, changeable at runtime, already built and
  decided in `admin-section.md`. *Rejected:* env var only (needs restart, removes built UI); env var
  seeding the DB value (two sources, confusing). The developer's first idea "env var, default 2 GB" was
  withdrawn on 2026-11-19.
- **Per-user limit:** nullable `users.max_storage_bytes`; NULL = server default, number = own limit,
  0 = unlimited. — *Rationale:* changing the default affects all users without own value. *Rejected:*
  copying the default into every user at creation.
- **What counts:** the size of every stored photo file (uploads after re-encode, imports from all
  connectors, duplicated collages). Avatars do not count. — *Rationale:* matches disk use; uploads-only
  could be bypassed by imports. *Rejected:* uploads only; original uploaded bytes.
- **Batch import over the limit:** each photo is checked before insert; the first photo over the limit
  stops the import (no new downloads), photos imported before stay; error 409 with used/max. Plus a
  pre-check: already at/over limit → refuse before any download. — *Rationale:* same as today's error
  behaviour, no API change. *Rejected:* partial success with "notImported" count; all-or-nothing.
- **Duplicate collage:** pre-check used + source collage bytes > limit → refuse the whole duplicate
  before copying (stays all-or-nothing). *Rejected:* no quota on duplicate.
- **Error form:** `apperr.Conflict` → 409 with an English server message (like all server messages);
  frontend unchanged. *Rejected:* new 507 kind with i18n texts in the frontend.
- **Existing rows:** `size_bytes` default 0; backfill only by running the CLI once after the upgrade
  (documented in `doc/deployment.md`). *Rejected:* automatic backfill at server start.
- **CLI:** `collageomat photos recalc-size --username <name>` or `--all` (exactly one required). Sets
  `size_bytes` from the file size on disk. Missing file: warning, row unchanged, counted. Output per user:
  photos updated, missing files, used / limit. May run while the server runs (SQLite WAL).
  *Rejected:* `user recalc-storage`.
- **Who sees usage:** admins in the user list and dialogs; every user on the Profile page.
- **Admin list column "Storage":** text "1.23 GB / 2 GB"; "/ unlimited" for 0; small "(default)" hint
  when the user has no own limit; red text when used ≥ limit (and limit > 0). Decimal GB (10⁹).
  *Rejected:* additional progress bar.
- **Lowering a limit below the used value:** existing photos stay; only new photos are refused.
- **Admin dialogs:** edit **and** create dialog get checkbox "Use server default (<x> GB)" + field
  "Storage limit (GB)" (enabled when unchecked, decimal, ≥ 0, 0 = unlimited). An admin may change their
  own limit. PATCH `/api/admin/users/{id}`: `maxStorageBytes` is required (number ≥ 0 or `null`), like
  `isAdmin`/`isActive`; POST: optional, missing/null = default.
- **Very small sizes in GB:** "< 0.01 GB" for 0 < bytes < 0.005 GB — confirmed by the developer
  2026-11-19.
- **Collage list size (step 7):** per-collage size as 2nd line in the "Photos" column; MB below 1 GB,
  GB above. *Rejected:* always GB (most collages would show "0.03 GB" or "< 0.01 GB").
- **Profile page:** usage as text in the same line as "Member since …", right-aligned (flexbox
  `justify-content: space-between`, wraps to a new line on small screens), e.g. "1.23 GB of 2 GB used";
  unlimited: "1.23 GB used (no limit)". *Rejected:* separate card with progress bar.
- **Race safety:** check inside the `CreateWithFile` transaction after the insert (write lock held).
  *Rejected:* check before the insert (race between parallel workers; read→write lock upgrade gives
  `SQLITE_BUSY`); per-user mutex in the service (not needed with the insert-first order).
- **Workflow:** the developer allowed implementing all steps in sub-agents without review stops; the
  plan stays `in progress` until the developer has tested everything.

## Testing strategy

No automated tests (project rule in `AGENTS.md`). After each step: `go build ./... && go vet ./...`
and/or `npx ng build`. The developer tests manually at the end (steps below).

## Steps

### Step 1 — Photo size column, set on create/copy, CLI recalc
- **Status:** done (reviewed 2026-11-19)
- **What:**
  - `photo.Photo.SizeBytes int64` with tag `gorm:"not null;default:0"` (column `size_bytes`).
  - `createPhoto`: `SizeBytes = int64(len(img.data))`.
  - `copyPhoto`: count the bytes copied (small counting `io.Reader` wrapper) and store them in
    `SizeBytes` inside the `CreateWithFile` callback before `file_name` is saved (update both columns).
  - `FileStorage.Size(relPath) (int64, error)` (+ `DiskStorage.Size` via `root.Stat`; missing file →
    error matching `fs.ErrNotExist`).
  - CLI `photos recalc-size` in new file `backend/cmd/collageomat/photos.go` (dispatcher `runPhotos`,
    added to the command switch and `usage` in `main.go`): `--username` or `--all`; for the user(s) list
    the photos (join collages), stat each file, update `size_bytes` when different; print a summary per
    user (updated, unchanged, missing). The DB work goes through a new exported function/service in the
    `photo` package (no GORM in `cmd`, apart from `openDB`). In step 1 the summary prints used bytes
    only; step 2 adds the limit.
- **Acceptance criteria:** build/vet pass; a new upload or import has `size_bytes` = file size on disk
  (`ls -l data/photos/<collage>/<id>.jpg`); a duplicate copies the sizes; setting a row to 0 and running
  `photos recalc-size --all` restores it; `--username unknown` gives an error; neither/both flags give
  a usage error.
- **Status note:** implemented 2026-11-19 (sub-agent), build/vet pass; developer approved 2026-11-19.
- **Notes:** `Photo.SizeBytes` (`photo/model.go`); `createPhoto` sets `len(img.data)`; `copyPhoto` counts
  bytes with `countingReader` (`photo/collage_photos.go`); `GormStore.CreateWithFile` saves `file_name` +
  `size_bytes` with a map `Updates`. `FileStorage.Size` / `DiskStorage.Size` (`root.Stat`, `%w`).
  New store methods `ListUsers(ctx, username)` ("" = all; unknown → error), `ListByUser`, `UpdateSize`
  (`UpdateColumn`, keeps `updated_at`). `photo.RecalcSizes(ctx, *GormStore, FileStorage, username)` in
  new `photo/recalc.go`. CLI `runPhotos`/`runPhotosRecalcSize` in new `cmd/collageomat/photos.go`; output
  e.g. `alice: 1 updated, 0 unchanged, 1 missing, used 12.35 kB (12345 bytes)`. The `photo` package now
  imports `auth` (no cycle). Temporary `formatBytes` in `cmd` (step 2 moves formatting to `quota`). Used
  bytes include rows with a missing file at their stored size.

### Step 2 — Per-user limit and enforcement
- **Status:** done (reviewed 2026-11-19)
- **What:**
  - `auth.User.MaxStorageBytes *int64` (column `max_storage_bytes`, nullable).
  - Package `backend/internal/quota`: `Service` with `Limit(ctx, userID) (int64, error)` and
    `Usage(ctx, userID) (used, limit int64, err error)`; interfaces for used bytes (photo store:
    `UsedBytesByUser(ctx, userID)`, and later all users `UsedBytesAllUsers(ctx) map[uint]int64` for the
    admin list), own limit (small GORM store on `users`), default (`*settings.Service`). A helper that
    formats the 409 message (GB with 2 decimals, MB for the needed size).
  - `photo.Service` gets a quota dependency (interface defined in `photo`): `CreateWithFile` receives the
    user id and the effective limit (read once per request before the work) and checks the sum after the
    insert in the same transaction; over limit → rollback, `apperr.Conflict`.
  - Import pre-check (used ≥ limit → refuse before any download); upload uses the in-tx check only.
  - Duplicate: pre-check with the sum of the source collage's `size_bytes`; the copy also uses the in-tx
    check. `collage.Photos` / `CopyAllForCollage` get what they need (user id, limit).
  - CLI summary prints used / limit.
  - `settings.Settings` doc comment: remove "It is not enforced yet".
- **Acceptance criteria:** with Settings limit = 0.001 GB (1 MB): upload until refused → 409 message in
  the UI; Immich import of many assets stops with the message, earlier photos stay; duplicate of a big
  collage is refused, nothing copied; delete photos → upload works again; limit 0 → no limit; a user
  with `max_storage_bytes` set in SQLite uses that value instead of the default.
- **Status note:** implemented 2026-11-19 (sub-agent), build/vet/gofmt clean, smoke test with a temp
  data dir passed (uploads, duplicate, own limit, import pre-check, 6 parallel uploads → 1×200 5×409, no
  `SQLITE_BUSY`). Immich mid-import stop not tested (no connector in the temp setup). developer approved 2026-11-19.
- **Notes:** New `backend/internal/quota/{service,store}.go`: `Service.Limit`, `Service.Usage`; interfaces
  `Store`, `UsedBytes`, `Settings`; helpers `Exceeds`, `Full`, `FullError`, `PhotoError`, `CopyError`,
  `FormatBytes`, `FormatLimit`. `auth.User.MaxStorageBytes *int64`. `photo.GormStore.CreateWithFile(ctx, p,
  q Quota, writeFile)`; new `UsedBytesByUser`, `SizeByCollage`. `photo.Quota{UserID, Limit}`, interface
  `photo.Quotas`; `photo.NewService(..., quotas)`. `collage.Photos.CopyAllForCollage(ctx, src, dst,
  userID, limit)` + `SizeByCollage`; `collage.Quotas`; `collage.NewService(store, photos, quotas, tx)`;
  `checkDuplicateQuota` runs before the duplicate transaction (own `FindForUser`, 404 first). `photo` and
  `collage` import `quota` only for the pure helpers. **Deviation:** the in-tx check runs after
  `writeFile` + the final `file_name`/`size_bytes` update (insert → write → update → sum → rollback if
  over) because a copy knows its size only after copying; one code path for upload/import/copy. A refused
  photo's file is written first and removed by the existing cleanup. Error "used" = sum without the new
  photo. Import pre-check message: "storage limit reached: X of Y used" (no "needs" part).

### Step 3 — Backend APIs (admin + profile)
- **Status:** done (reviewed 2026-11-19)
- **What:**
  - Admin `userResponse`: `usedStorageBytes`, `maxStorageBytes` (own value or null),
    `effectiveMaxStorageBytes`. `admin.Usage` (or a new interface) also returns used bytes per user (one
    grouped query, not per user).
  - `createRequest.maxStorageBytes` (optional, null = default); `updateRequest.maxStorageBytes` required
    (`json.RawMessage`/presence check: missing → 400, `null` → default, number ≥ 0 → own limit, < 0 →
    validation error). `GormStore.CreateUser`/`UpdateUser` write `max_storage_bytes` (map update so that
    NULL is written).
  - `GET /api/profile/storage` → `{"usedBytes": n, "limitBytes": n}` (effective limit, 0 = unlimited).
- **Acceptance criteria:** curl: list shows the fields; PATCH without `maxStorageBytes` → 400; PATCH
  with null/number works and the limit is enforced; POST with/without the field; profile endpoint
  returns the values for the logged-in user.
- **Status note:** implemented 2026-11-19 (sub-agent), build/vet/gofmt clean, curl smoke test passed.
  developer approved 2026-11-19.
- **Notes:** `quota`: `UsedBytes.UsedBytesAllUsers`, `Service.DefaultLimit`, `Service.UsedBytesAllUsers`,
  helper `Effective(own *int64, def int64) int64`. `photo.GormStore.UsedBytesAllUsers` (one grouped
  query). `admin.Quotas` interface (implemented by `*quota.Service`), `admin.NewService(store, collages,
  usage, quotas, avatars, tx)`; `UserSummary.UsedStorageBytes`, `.EffectiveMaxStorageBytes`;
  `CreateUser(..., maxStorageBytes *int64)`; `Update.MaxStorageBytes`; `GormStore.UpdateUser(ctx, id,
  isAdmin, isActive, maxStorageBytes, passwordHash)` (map update, nil → NULL). Handler type
  `nullableInt64` tells missing from null. PATCH missing field → 400 "isAdmin, isActive and
  maxStorageBytes are required"; < 0 → 400 "maxStorageBytes must be 0 (unlimited) or more"; non-integer →
  400 "invalid JSON body". `profile.Storage` interface, `profile.NewService(store, passwords, storage,
  decoder)`, `Service.StorageUsage`, route `GET /api/profile/storage` → `{usedBytes, limitBytes}`.
  `main.go`: `settingsSvc`/`quotaSvc` created before `profileSvc`; `quotaSvc` has its own stateless
  `photo.NewGormStore(gdb)`.

### Step 4 — Frontend admin
- **Status:** done (reviewed 2026-11-19)
- **What:**
  - `core/models/admin.ts`: new fields on `AdminUser`, `CreateUserRequest`, `UpdateUserRequest`;
    remove "Not enforced yet" from the `SystemSettings` doc comment.
  - User list: column "Storage" after "Photos" (decision log format, red when full, "(default)" hint).
  - Edit and create dialogs: checkbox "Use server default (<x> GB)" + GB field (0 = unlimited). The
    dialogs need the current server default (load `SystemSettings` via the admin API in the page and
    pass it in the dialog data).
  - Settings tab: remove the hint `@@admin.settings.storage.notEnforced`.
  - Shared GB formatting helper (one place, used by list, dialogs, profile).
  - All texts i18n-marked.
- **Acceptance criteria:** `npx ng build` passes; list shows used/max; edit dialog sets/clears an own
  limit; create dialog with own limit; Settings tab without the hint.
- **Status note:** implemented 2026-11-19 (sub-agent), `npx ng build` clean, prettier run. developer approved 2026-11-19.
- **Notes:** New `frontend/src/app/shared/storage-size.ts` (single GB helper, `BYTES_PER_GB` moved here,
  `Intl.NumberFormat($localize.locale)`, max. 2 decimals; deviation: a size > 0 below 0.005 GB shows
  "< 0.01 GB", i18n `@@shared.storage.lessThanGb`). New `features/admin/users/storage-limit.ts` (checkbox +
  GB field logic shared by edit and create dialogs). `core/models/admin.ts` new fields;
  `core/models/user.ts` `StorageUsage`. Users page loads users + system settings together (either fails →
  existing load error + Retry; both reloaded after create/edit). Red = `--mat-sys-error`. Settings tab:
  hint and unused `.note` style removed. New i18n ids: `@@shared.storage.{gb,lessThanGb,unlimited}`,
  `@@admin.users.{column.storage,storage,storageDefault}`,
  `@@admin.user.{useDefaultStorage,storageLimit,storageLimitHint,storageLimitRequired,storageLimitMin}`.
  No `.xlf` files are kept in the repo.

### Step 5 — Frontend profile
- **Status:** done (reviewed 2026-11-19)
- **What:** `profile.api.ts` `storage()`; Profile header: "Member since …" left, storage text right in
  the same line (flex, `space-between`, wrap on small screens). Text "1.23 GB of 2 GB used" /
  "1.23 GB used (no limit)", i18n-marked.
- **Acceptance criteria:** text shows correct values; on a narrow window it wraps below "Member since".
- **Status note:** implemented 2026-11-19 together with step 4 (same sub-agent). developer approved 2026-11-19.
- **Notes:** `profile.api.ts` `storage()`; `features/profile/profile.page.{html,scss,ts}`; text hidden
  while loading or on error. i18n ids `@@profile.storage.{used,unlimited}`.

### Step 6 — Documentation
- **Status:** done (reviewed 2026-11-19)
- **What:** `doc/architecture.md` (data model `size_bytes`, `max_storage_bytes`, `quota` package, API
  fields, 409), `doc/development.md` (CLI `photos recalc-size`), `doc/deployment.md` (upgrade note: run
  `collageomat photos recalc-size --all` once after updating to this version).
- **Acceptance criteria:** docs match the code.
- **Status note:** implemented 2026-11-19 (sub-agent). developer approved 2026-11-19.
- **Notes:** `doc/architecture.md` (package table incl. new `quota` row, new section "Storage quota", data
  model, API, frontend table); `doc/development.md` (table "CLI commands without a make target");
  `doc/deployment.md` (run line `docker exec -it collageomat /app/collageomat photos recalc-size --all`,
  version note in the upgrade section); `AGENTS.md` (repository layout: `quota` added).

### Step 7 — Size per collage in the collage list
- **Status:** done (reviewed 2026-11-19)
- **What:** (added by the developer 2026-11-19 after steps 1–6) the collage list API returns the
  stored bytes per collage (`sizeBytes`, one grouped `SUM(size_bytes)` query like `CountByCollages`);
  duplicate result too. Frontend `features/collages/collages.page.html`: 2nd line in the "Photos" column
  with the size. Unit: MB below 1 GB, GB from 1 GB (decimal, 1 MB = 10⁶, max. 2 decimals, e.g.
  "24.6 MB", "1.23 GB"); helper in `frontend/src/app/shared/storage-size.ts`. Admin list and profile stay
  in GB. Docs: API field in `doc/architecture.md`.
- **Acceptance criteria:** build/vet/ng build pass; collage list shows count + size; upload/delete a
  photo and reload → size changes.
- **Status note:** implemented 2026-11-19 (sub-agent), build/vet/gofmt/ng build clean. developer approved 2026-11-19.
- **Notes:** `collage.Photos.CountByCollages` replaced by `StatsByCollages(ctx, ids)
  (map[uint]PhotoStats, error)` (`PhotoStats{Count, SizeBytes}`); `photo.GormStore.StatsByCollages`
  (one grouped query `COUNT(*)`, `COALESCE(SUM(size_bytes),0)`, type `photo.CollageStats`). `Summary.SizeBytes`,
  helper `summary()` (List, Rename); duplicate reads the stats of the new collage after the copy. JSON
  `sizeBytes` in list/create/rename/duplicate responses. Frontend: `CollageSummary.sizeBytes`,
  `formatStorageSize()` + `BYTES_PER_MB` in `shared/storage-size.ts` (i18n `@@shared.storage.mb`),
  2nd line with class `.size-hint` in `collages.page.{html,scss,ts}`. A size below 5 KB shows "0 MB"
  (not relevant for real photos).

## Open questions

- Not tested yet: an Immich import that stops in the middle at the limit (same `CreateWithFile` path).
- Risk: if `encrypted-photos.md` is built later, `size_bytes` must be the encrypted file size.

## Current state / Next action

Feature done. All 7 steps implemented 2026-11-19 and tested live and approved by the developer on
2026-11-19. Verified: `go build ./... && go vet ./...`, `gofmt -l .`, `npx ng build` clean. Nothing
committed (work on `main`, uncommitted). No temporary changes to revert. No next action.
