# Admin section

**Ticket/Source:** none (rough idea of the developer, 2026-11-14)
**Branch:** none
**Status:** planning

## Goal

Users with the admin role get an admin section in the web app. It has:

- **User management:** list, create, edit (rename? admin role, password reset), delete users.
- **System-wide settings:** settings stored in the database and changed in the UI, not only by env vars.
  First setting: the photo storage limit per user (default for all users; see
  `doc/agent-plans/user-storage-quota.md`). More settings will follow, so the settings store must be easy to
  extend.

Non-admin users do not see the section and the API refuses their requests.

## Scope

**In scope:** admin-only area (route + API), user management, a generic system settings store with the
first setting "storage limit per user".
**Out of scope:** to be decided in the grilling. Expected: user self-registration, e-mail / password reset
links, audit log, roles other than admin/user, per-user overrides of settings (maybe later).

## Rough Architecture / Concept

Not decided yet (planning phase). Expected:

- **Backend, authorization:** a `RequireAdmin` middleware in `backend/internal/auth` (after `RequireAuth`,
  checks `UserFromContext(ctx).IsAdmin`, else 403 via `apperr`). All admin routes under `/api/admin/...`.
- **Backend, users:** new admin user endpoints (e.g. `GET/POST /api/admin/users`,
  `PATCH/DELETE /api/admin/users/{id}`, `POST /api/admin/users/{id}/password`). Reuse `auth.CreateUser` /
  `auth.SetPassword` (`backend/internal/auth/users.go`, today used by the `user add/passwd` CLI). Rules to
  decide: an admin cannot delete or demote their own account / the last admin; deleting a user deletes the user's sessions,
  collages, photos (files!) and connectors.
- **Backend, settings:** new domain package, e.g. `backend/internal/settings`: table `system_settings`
  (key/value JSON, or one row with typed columns) with a typed Go struct and defaults. Env var
  (`COLLAGEOMAT_MAX_USER_STORAGE` from the quota plan) as initial default/override — precedence to decide.
  The photo service reads the limit from this service instead of the config.
- **Frontend:** new feature `features/admin/` with pages "Users" and "Settings"; route(s) `admin/...` with a
  new `adminGuard` (`core/auth.guard.ts`, uses `currentUser().isAdmin`); toolbar link only for admins
  (`app.html` already shows an admin badge with `user.isAdmin`). API services in `core/` (only place with
  `HttpClient`). All texts i18n.
- **Order:** depends on / goes together with `doc/agent-plans/user-storage-quota.md` (the first setting).

## Open questions (for the grilling)

- User management: which actions (create, delete, rename, set password, toggle admin, disable/lock
  account)? Show usage per user (collages, photos, storage used)?
- Delete user: hard delete with all data and files, or disable? Confirm dialog with data summary?
- Safety rules: last admin cannot be removed/demoted; own account cannot be deleted?
- Password reset by admin: admin sets a new password, or a generated one shown once? Kill sessions of the
  user after reset?
- Settings storage: key/value table (flexible) or typed single-row table? Env var vs DB precedence?
- Per-user override of the storage limit now or later?
- Which further settings are expected soon (to shape the store)?
- Keep the CLI `user add/passwd` (bootstrap of the first admin)? Yes, expected.

## Context for a new agent

- **Read first:** `doc/architecture.md` (layering, domain packages, `apperr`, API conventions);
  `doc/agent-plans/user-storage-quota.md`.
- **Facts from the code (2026-11-14):**
  - `auth.User` (`backend/internal/auth/models.go`): `ID, Username (64, unique), PasswordHash, IsAdmin,
    CreatedAt, UpdatedAt`. `Session` table with token hash.
  - `auth.CreateUser(db, username, password, isAdmin)` and `auth.SetPassword(db, username, password)` in
    `backend/internal/auth/users.go`; CLI in `backend/cmd/collageomat/user.go` (`user add --admin`,
    `user passwd`).
  - `auth.Handler.RequireAuth` middleware and `GET /api/auth/me` (returns `id, username, isAdmin`) in
    `backend/internal/auth/handler.go`; `auth.UserFromContext` / `auth.UserID` in `context.go`.
    No admin check exists yet.
  - Config is env only (`backend/internal/config/config.go`); no settings table.
  - Frontend: routes in `frontend/src/app/app.routes.ts` with `authGuard` / `loginGuard`
    (`core/auth.guard.ts`); `User.isAdmin` in `core/models/user.ts`; toolbar in `app.html` shows an admin
    badge.
- **Commands:** in `backend/`: `go build ./... && go vet ./...`; in `frontend/`: `npx ng build`; dev via
  `make dev-up`, `make backend-run`, `make frontend-serve` (see `Makefile`).

## Decision log

(empty — fill during grilling)

## Testing strategy

To be decided (PoC: no automated tests, manual review per step). Manual: as admin and as normal user, check
UI visibility and API 403 for each admin endpoint.

## Steps

To be defined after the grilling.
