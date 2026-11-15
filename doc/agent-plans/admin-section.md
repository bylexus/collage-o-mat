# Admin section

**Ticket/Source:** none (rough idea of the developer, 2026-11-14; grilling 2026-11-15)
**Branch:** none (work on `main`, developer decides about commits)
**Status:** in progress (all steps implemented 2026-11-15; manual review by the developer open)

## Goal

Users with the admin role get an admin section in the web app. It has:

- **User management:** list users (with avatar, collage and photo counts), create, edit (admin role,
  active flag, set a new password), delete users with all their data.
- **System-wide settings:** settings stored in the database and changed in the UI. First setting: the photo
  storage limit per user. The limit is only **stored** in this feature; the separate feature
  `doc/agent-plans/user-storage-quota.md` enforces it later. The settings store must be easy to extend.

Non-admin users do not see the section and the API refuses their requests (403).

## Scope

**In scope:**
- `users.is_active` flag; inactive users cannot log in and their sessions are invalid.
- `RequireAdmin` middleware; admin API under `/api/admin/...`.
- User management API + UI (list, create, edit = admin/active/password, delete with all data and files).
- Generic key/value system settings store + API + UI with the first setting "storage limit per user".
- Toolbar button (icon only, tooltip) for admins, admin page with tabs "Users" and "Settings".
- Update `doc/architecture.md`.

**Out of scope:** self-registration, e-mail / password reset links, audit log, roles other than
admin/user, per-user overrides of settings, rename of users, quota enforcement (separate feature), CLI
changes (`user add` / `user passwd` stay as they are; users created by the CLI are active), env var for the
storage limit.

## Rough Architecture / Concept

- **Backend `auth`:** `User.IsActive` (AutoMigrate, DB default `true` so existing installations keep all
  users active). Login and `RequireAuth` refuse inactive users with the same generic 401 as a wrong
  password. New `RequireAdmin` middleware (after `RequireAuth`; `UserFromContext(ctx).IsAdmin` else 403).
- **Backend `internal/admin` (new package):** store (GORM over `auth.User` / `auth.Session`), service
  (rules: self-protection, at least one active admin, transactions), handler for `/api/admin/users...`.
  It gets `RequireAdmin` through its constructor (the `httpapi.Module` interface only passes
  `requireAuth`). Cross-domain access only through interfaces declared in `admin`:
  `Collages` (list + delete a user's collages; implemented by `*collage.Service`, so photo rows **and**
  photo directories are removed), `Usage` (collage and photo count per user; adapter in package
  `collage`), `Avatars` (avatar bytes + version of any user; implemented by `*profile.Service`).
- **Backend `internal/settings` (new package):** table `system_settings` (`key` PK, `value` JSON TEXT via
  `jsoncol`). Typed Go struct `Settings` with defaults; each field = one key; a missing key = default. A new
  setting = a new struct field + key, no migration. Handler `GET/PUT /api/admin/settings` (behind
  `RequireAdmin`). The quota feature will later call the settings service.
- **Frontend:** feature `features/admin/` with route `/admin` (tab nav `mat-tab-nav-bar`, child routes
  `users` (default) and `settings`), `adminGuard` in `core/auth.guard.ts`, `AdminApi` in `core/api/`,
  toolbar button in `layout/app-shell.html`.

**Why:** follows the existing layering (`doc/architecture.md`: domain packages with model/store/service/
handler, consumer-declared interfaces, wiring only in `main.go`). Key/value settings follow the
"typed keys + JSON values" principle and need no migration per setting. No new libraries.

## Context for a new agent

- **Sources read:**
  - `AGENTS.md`: no automated tests; verify with `go build ./... && go vet ./...` (in `backend/`) and
    `npx ng build` (in `frontend/`); all UI texts English and i18n-marked (`i18n="@@<feature>.<key>"`,
    `$localize`); no new libraries without approval; do not commit.
  - `doc/architecture.md`: package roles (`model.go` GORM only, `store.go` the only `*gorm.DB` user,
    `service.go` business rules without `net/http`, `handler.go` HTTP only implementing `httpapi.Module`);
    services return `apperr` errors (`ErrNotFound`, `Conflict(...)`, `Validation(...)`), mapped by
    `httpapi.WriteServiceError`; frontend: only `core/api` services use `HttpClient`, pages hold state,
    dialogs use `input()`/`output()` / dialog data and do no API calls.
  - `doc/agent-plans/user-storage-quota.md` (planning): will add `photos.size_bytes` and enforce a per-user
    limit. Its idea of an env var `COLLAGEOMAT_MAX_USER_STORAGE` is **superseded** by this plan (limit is
    DB-only, see decision log).
- **Facts from the code (2026-11-15):**
  - `auth.User` (`backend/internal/auth/models.go`): `ID, Username (64, unique), PasswordHash, IsAdmin,
    CreatedAt, UpdatedAt`. `auth.Session` with `UserID` FK `OnDelete:CASCADE`.
  - `auth.CreateUser(db, username, password, isAdmin)`, `auth.SetPassword(db, username, password)` (also
    deletes all sessions), `NormalizeUsername`, `ValidatePassword` in `backend/internal/auth/users.go` /
    `password.go`. CLI: `backend/cmd/collageomat/user.go`.
  - `auth.Handler` (`backend/internal/auth/handler.go`): `login` (generic 401 `msgInvalidLogin`, login
    limiter), `RequireAuth` (loads session + `sess.User` each request), `me`, `UserResponse` /
    `NewUserResponse`. Context helpers in `backend/internal/auth/context.go` (`UserFromContext`, `UserID`,
    `SessionID`).
  - FKs with `OnDelete:CASCADE` to `users`: `collages` (`collage/model.go`), `connectors`
    (`connector/model.go`), `user_avatars` (`profile/model.go`), `sessions`. `photos` cascade on collage
    delete, but **photo files on disk do not cascade**: `collage.Service.Delete(ctx, userID, id)`
    (`backend/internal/collage/service.go`) calls `Photos.DeleteAllForCollage` (rows + directory
    `photos/<collageId>/`) and then deletes the collage row. `collage.Service.List(ctx, userID)` lists the
    user's collages with photo counts. `photo.CollagePhotos.CountByCollages` gives photo counts per collage.
  - `profile.Service` (`backend/internal/profile/service.go`): `Avatar(ctx, userID)`,
    `AvatarVersion(ctx, userID)`; `profile/handler.go` `avatar` shows how the own avatar is served
    (immutable cache with `?v=`).
  - Router: `httpapi.NewRouter(static, requireAuth, modules...)` (`backend/internal/httpapi/router.go`);
    `Module.RegisterRoutes(mux, requireAuth)`. Wiring + `models()` list for AutoMigrate in
    `backend/cmd/collageomat/main.go`.
  - Config is env only (`backend/internal/config/config.go`).
  - Frontend: routes `frontend/src/app/app.routes.ts` (children of `AppShell` with `authGuard`); guards
    `frontend/src/app/core/auth.guard.ts`; `AuthService.currentUser()` signal; `User` DTO
    `frontend/src/app/core/models/user.ts` (`isAdmin`); toolbar `frontend/src/app/layout/app-shell.html`
    (About button: `matIconButton` with `mat-icon` `info`, `matTooltip`, `aria-label`, i18n ids
    `@@toolbar.*`); shared `ConfirmDialog`, `NotificationService`, `errorMessage(err)`, `UserAvatar` in
    `frontend/src/app/shared/`.
- **Existing patterns to follow:** backend domain package: `backend/internal/profile/` (model, store,
  service, handler, interface `Passwords` implemented in `auth`); cross-domain adapter:
  `backend/internal/photo/collage_photos.go`; frontend page with cards/forms: `features/profile/`; API
  service: `core/api/profile.api.ts`.
- **Commands:**
  - Backend verify: `cd backend && go build ./... && go vet ./...`
  - Frontend verify: `cd frontend && npx ng build`
  - Dev: host `make dev-up && make dev-shell`; container `make backend-run` (:8080), `make frontend-serve`
    (:4200, proxies `/api`).
  - Users: `go run ./cmd/collageomat user add --username <name> [--admin]` (in `backend/`, container).
- **Environment / prerequisites:** dev container; one admin and one normal user for manual tests.
- **Domain terms:** *admin* = `users.is_admin`; *active* = `users.is_active`; *self-protection* = an admin
  cannot change admin/active flags of, set the password of (via admin UI), or delete their own account.
- **External references:** GORM default values / zero values: https://gorm.io/docs/create.html#Default-Values

## Decision log

- **Order vs. quota feature:** the settings store and the storage-limit value are built now; enforcement
  comes with `user-storage-quota.md` later. — *Rationale:* developer choice; admin UI can be built
  independently. *Rejected:* users only (settings later), quota first, merge both features.
- **User actions:** list, create, set password, toggle admin, deactivate/activate (new `is_active` flag),
  delete. — *Rationale:* developer choice.
- **Rename:** no; the username is fixed after creation. — *Rationale:* login name must not change
  unexpectedly; YAGNI.
- **Inactive user:** deactivating deletes all sessions of the user; login gives the generic 401
  "invalid username or password" (no account enumeration); `RequireAuth` also rejects inactive users
  (defense in depth). *Rejected:* specific "account deactivated" message.
- **`is_active` migration:** AutoMigrate with DB default `true`, so all users of existing installations stay
  active (developer requirement). Model tag e.g. `gorm:"not null;default:true"`. **GORM pitfall:** on
  `Create`, GORM skips a bool zero value when a `default` tag exists → always set `IsActive: true`
  explicitly in `CreateUser`, and set `false` only with `Update("is_active", false)` /
  `Updates(map[string]any{...})`, never with a struct update.
- **Safety rules:** strict self-protection: an admin cannot delete, deactivate or demote their own account
  in the admin UI/API, and cannot set their own password there (own password: Profile page, needs the
  current password). In addition the server guarantees at least one active admin (check in the same
  transaction as the change). Violations → `apperr.Conflict` (409) with a clear message. *Rejected:*
  "last active admin only" rule.
- **Set password by admin:** the admin types the new password (+ repeat in the UI), same
  `ValidatePassword` rules; all sessions of the target user are deleted. *Rejected:* generated password,
  both.
- **Delete user:** hard delete of the account and all data: for each collage `collage.Service.Delete`
  (photo rows + photo directory), then delete the `users` row (FK cascade removes connectors, avatar,
  sessions, remaining rows). Repeatable after a partial failure. Confirmation: dialog where the admin must
  type the username before Delete is enabled. *Rejected:* confirm dialog with counts, plain confirm.
- **User list columns:** avatar, username, admin, active, collage count, photo count (plus the edit
  action). Avatar needs new endpoint `GET /api/admin/users/{id}/avatar?v=<avatarVersion>` (admin only).
  *Not chosen:* created-at column.
- **Settings storage:** key/value rows (`system_settings`: `key` PK, `value` JSON TEXT); typed `Settings`
  struct with defaults in Go; missing key = default. *Rejected:* typed single row (migration per setting),
  single JSON document.
- **Storage limit value:** DB only, no env var. Default 2 GB in code. Stored as bytes (`int64`, key e.g.
  `maxUserStorageBytes`). UI field in GB, decimal (1 GB = 10⁹ bytes), decimals allowed; `0` = unlimited;
  negative = validation error. *Rejected:* env var as initial default, env var overrides DB.
- **UI layout:** route `/admin` with tab nav bar; child routes `/admin/users` (default) and
  `/admin/settings`; `adminGuard` on the parent route (non-admin → redirect to `/`). *Rejected:* two cards
  on one page, separate routes without tabs.
- **Toolbar button:** `matIconButton` with Material icon `manage_accounts`, tooltip and aria-label
  "Administration" (i18n), routerLink `/admin`, `routerLinkActive`, placed directly left of the About
  (`info`) button, only rendered when `user.isAdmin`.
- **Row actions:** click on a row (or an edit button in the row) opens an **edit dialog**: Admin checkbox,
  Active checkbox, "New password" + "Repeat" (empty = unchanged), Save / Cancel, and a Delete button that
  opens the type-username dialog. *Rejected:* row menu, inline toggles.
- **Edit save:** one Save → one `PATCH /api/admin/users/{id}` `{isAdmin, isActive, newPassword?}` in one
  transaction. Own row: Admin/Active/Delete disabled, password fields hidden. *Rejected:* separate password
  request.
- **Create user:** dialog "New user": username, password + repeat, admin checkbox; new users are active.
- **Backend structure:** `auth` gets `IsActive` + `RequireAdmin`; new packages `internal/admin` and
  `internal/settings` (see Rough Architecture). *Rejected:* user management inside `auth` (older code
  without store/service split).
- **Settings UI:** GB field + hint "Not enforced yet" (the quota feature removes the hint).
- **Scope / CLI:** CLI stays unchanged (no `user activate`).

## Testing strategy

No automated tests (project rule in `AGENTS.md`). Per step: `go build ./... && go vet ./...` and/or
`npx ng build`, then manual test steps for the developer (curl and UI). Each admin endpoint is checked as
admin (works) and as normal user (403) and without session (401).

## Steps

### Step 1 — Backend: active flag
- **Status:** implemented 2026-11-15, manual review open
- **What:** `auth.User.IsActive bool` (`not null;default:true`). `CreateUser` sets `IsActive: true`.
  `login` treats an inactive user like a wrong password (generic 401, counts in the limiter as a fail).
  `RequireAuth` (session lookup) rejects sessions of inactive users (401). Expose `isActive` nowhere yet
  except where needed later.
- **Acceptance criteria:** after server start on an existing DB all users have `is_active = 1`. Set
  `is_active = 0` with sqlite → open session gets 401, login gets 401 "invalid username or password".
  CLI `user add` creates active users.
- **Notes:** `IsActive` tag `not null;default:true` → SQLite column `is_active numeric NOT NULL DEFAULT true`; an old DB without the column got `is_active = 1` for existing rows (tested). Login: inactive user = generic 401 and counts as a fail in the limiter. `auth.lookupSession` (`auth/session.go`) returns no session for inactive users, so `RequireAuth` answers 401 and clears the cookie. `auth.hashPassword` was exported as `auth.HashPassword` (used by `admin`).

### Step 2 — Backend: admin users API
- **Status:** implemented 2026-11-15, manual review open
- **What:** `auth.Handler.RequireAdmin` (403 `forbidden` for non-admins; used after `requireAuth`).
  Package `backend/internal/admin` (store, service, handler, interfaces `Collages`, `Usage`, `Avatars`;
  adapter for `Usage` in package `collage`). Endpoints:
  - `GET /api/admin/users` → list `{id, username, isAdmin, isActive, createdAt, avatarVersion,
    collageCount, photoCount}` ordered by username.
  - `POST /api/admin/users` `{username, password, isAdmin}` → created user DTO (201); duplicate → 409.
  - `PATCH /api/admin/users/{id}` `{isAdmin, isActive, newPassword?}` → user DTO; rules: self-protection,
    at least one active admin, deactivate or new password deletes the user's sessions; one transaction.
  - `DELETE /api/admin/users/{id}` → 204; self → 409; last active admin → 409; deletes collages through
    `collage.Service.Delete`, then the user row.
  - `GET /api/admin/users/{id}/avatar?v=` → JPEG (immutable cache), 404 if none.
  Wiring in `backend/cmd/collageomat/main.go`.
- **Acceptance criteria:** curl as admin: all endpoints work; rules give 409 with clear messages; deleted
  user's `data/photos/<collageId>/` directories are gone and connectors/avatar rows removed. As normal
  user: 403. Without session: 401.
- **Notes:** Files: `backend/internal/admin/{store,service,handler}.go`, `backend/internal/collage/user_usage.go` (`UserUsage` implements `admin.Usage`), new `Photos.CountAllByCollage` (one grouped query in `photo/store.go`, avoids the SQLite parameter limit), `collage` store `OwnerByCollage`. `RequireAdmin` is a method of `auth.Handler`, returns 403 `{"error":"forbidden"}`. PATCH: `isAdmin`/`isActive` are required (else 400); own row is accepted only without changes. Last-admin rule: change is applied, then active admins are counted in the same transaction; 0 → rollback + 409. Delete: tx 1 checks rules and deletes sessions; then each collage via `collage.Service.Delete` (404 ignored); tx 2 deletes the user row and checks the admin rule again; repeatable. `avatarVersion` in the list = one query per user via `profile.Service.AvatarVersion` (accepted: few users). Avatar endpoint copies the profile cache headers. Smoke test with curl passed (403/401/409/404, files removed).

### Step 3 — Backend: system settings
- **Status:** implemented 2026-11-15, manual review open
- **What:** package `backend/internal/settings`: model `SystemSetting` (`Key string` PK, `Value
  jsoncol.JSON`), table `system_settings`, added to `models()`. Service: `Get(ctx) (Settings, error)`
  (defaults for missing keys), `Update(ctx, Settings) (Settings, error)` (validation, upsert all keys in
  one transaction). `Settings{MaxUserStorageBytes int64}` default `2_000_000_000`, `0` = unlimited,
  `< 0` → validation error. Handler `GET /api/admin/settings`, `PUT /api/admin/settings` (full object,
  JSON `{maxUserStorageBytes}`), behind `RequireAdmin`.
- **Acceptance criteria:** GET on fresh DB returns default; PUT stores; value survives restart; negative →
  400; normal user → 403.
- **Notes:** Files: `backend/internal/settings/{model,store,service,handler}.go`, `SystemSetting` in `models()`. Keys = JSON names of `Settings` fields. PUT starts from the stored settings (a missing field keeps its value), unknown fields → 400. Smoke test passed (default, PUT, restart, -1 → 400, 0 ok).

### Step 4 — Frontend: admin shell, toolbar button, users list, create
- **Status:** implemented 2026-11-15, manual review open
- **What:** `adminGuard` (`core/auth.guard.ts`, non-admin → `/`); route `admin` (child of `AppShell`) with
  `features/admin/admin.page` (tab nav bar "Users" / "Settings", `router-outlet`), children `users`
  (default redirect) and `settings` (placeholder until step 6); toolbar button in
  `layout/app-shell.html` (see decision log); `core/api/admin.api.ts` + `core/models/admin.ts`; users tab:
  table (avatar via admin avatar URL, username, admin, active, collages, photos); "New user" button +
  dialog (username, password, repeat, admin). Errors via `NotificationService` + `errorMessage`.
- **Acceptance criteria:** button only for admins, left of the info button, tooltip "Administration";
  non-admin opening `/admin` is redirected; list shows all users with counts and avatars; create works,
  duplicate shows the server error.
- **Notes:** Files: `core/auth.guard.ts` (`adminGuard`), `app.routes.ts`, `layout/app-shell.html` (`@@toolbar.admin`), `core/models/admin.ts`, `core/api/admin.api.ts`, `features/admin/admin.page.*`, `features/admin/users/admin-users.page.*`, `admin-dialogs.service.ts`, `user-create-dialog.ts`, `password-validators.ts`, `user-dialog.scss`. `shared/user-avatar.ts` got an optional input `imageUrl` (default behaviour unchanged). Dialog error handling follows `ConnectorDialog`: the page passes a `save`/`remove` callback, the dialog stays open and shows the server message on error. Admin column is a badge (like the toolbar Admin badge); the active column is called "Status", inactive rows are dimmed. Password validators duplicate the private ones in `profile.page.ts` (profile page not changed, out of scope). No `ChangeDetectionStrategy` set, because no existing component sets it. No `messages*.xlf` file exists in the project.

### Step 5 — Frontend: edit dialog and delete
- **Status:** implemented 2026-11-15, manual review open
- **What:** edit dialog (Admin, Active, new password + repeat, Save, Cancel, Delete). Own row: Admin/Active
  /Delete disabled, password fields hidden. Delete opens a dialog where the username must be typed to
  enable Delete. List reloads after changes.
- **Acceptance criteria:** toggle admin/active, set password (target user logged out), delete (data gone),
  own-row restrictions, last-admin server error shown.
- **Notes:** `features/admin/users/user-edit-dialog.ts`, `user-delete-dialog.ts`. Delete from the edit dialog: the page's `remove` callback opens the delete dialog; after success the edit dialog closes with `'deleted'`.

### Step 6 — Frontend: settings tab + docs
- **Status:** implemented 2026-11-15, manual review open
- **What:** settings tab: field "Storage limit per user (GB)" (decimal, ≥ 0, 0 = unlimited) with hint "Not
  enforced yet", Save; converts GB ↔ bytes (10⁹). Update `doc/architecture.md` (packages `admin`,
  `settings`, `RequireAdmin`, `users.is_active`, table `system_settings`, API rows, routes `/admin/...`,
  frontend feature `admin`). Set plan status done and move this file to `doc/agent-plans/done/`.
- **Acceptance criteria:** value round-trips (save, reload page); invalid input blocked; docs match code.
- **Notes:** `features/admin/settings/admin-settings.page.*`. `doc/architecture.md` updated (packages, security, routes, toolbar, tables, API). Deviation: the plan file is NOT moved to `done/` yet, because the developer's manual review is still open.

## Open questions

- `doc/agent-plans/user-storage-quota.md` still mentions the env var `COLLAGEOMAT_MAX_USER_STORAGE`; when
  that feature is planned, it must read the limit from `settings.Service.Get` instead and remove the "Not
  enforced yet" hint.

## Current state / Next action

Plan approved 2026-11-15. The developer asked to implement all steps without a review stop after each step
(stop only for questions), with sub-agents. All 6 steps are implemented; `go build ./... && go vet ./...`
and `npx ng build` pass. Backend smoke-tested with curl; frontend not tested in a browser.
Next: manual review by the developer. After approval: set **Status:** done, step statuses to
`done (reviewed <date>)`, move this file to `doc/agent-plans/done/`. Nothing is committed.
Not tested: the "last active admin" 409 (only reachable in a race, because an admin cannot change the own
row); FK cascade of `connectors` on user delete (expected to work like `user_avatars`/`sessions`).
