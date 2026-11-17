# User last activity

**Ticket/Source:** none (idea of the developer, 2026-11-17: "Admin panel, user list: show a last-login date.
If this date is not yet collected / saved, add it on the user's model.")
**Branch:** none (work on `main`, developer decision)
**Status:** done (reviewed 2026-11-17)

## Goal

The admin user list (Administration → Users) shows for each user the date of the last activity in the app.
Before this feature, the app did not store any login or activity date. The new value is stored on the
user row. Admins can then see which accounts are still in use.

## Scope

**In scope:**
- New nullable column `users.last_active_at` (field `auth.User.LastActiveAt`).
- Set it on a successful password login and (throttled, max. once per hour per user) on authenticated
  requests in the session middleware `RequireAuth`.
- Admin list API `GET /api/admin/users` (and create/update responses) returns `lastActiveAt`.
- New column "Last activity" in the admin user table (date only).
- Docs update `doc/architecture.md` (data model `users`, `auth` package row).

**Out of scope:** a separate "last password login" date, a "last seen" per session, display on the profile
page or in the edit dialog, sorting/filtering of the table, a backfill of old users from the `sessions`
table, a "Never" label.

## Rough Architecture / Concept

One nullable timestamp on `auth.User`, added by GORM AutoMigrate (no manual migration). The auth package
writes it in two places: in `Handler.login` (always, after the session is created) and in
`Handler.RequireAuth` (only if the value is NULL or older than 1 hour). `RequireAuth` already loads the user
with each request (`lookupSession` preloads `Session.User`), so the throttle check costs no extra query; only
the throttled `UPDATE` is extra. The write uses `UpdateColumn`, so that `users.updated_at` does not change.
A failed write is only logged; the request continues. The admin package passes the value through
(`UserSummary` embeds `auth.User`) to the JSON DTO. The frontend shows it with Angular `DatePipe`
`'mediumDate'`, or `—` for `null`.

Why "last activity" and not "last login": sessions have a sliding expiry (30 days, extended when less than
15 days remain, `backend/internal/auth/session.go`). A daily user thus can stay logged in for months without
a new password login, so a pure last-login date would make active users look inactive.

## Context for a new agent

- **Sources read:**
  - `AGENTS.md`: no automated tests; verify with `go build ./... && go vet ./...` (in `backend/`) and
    `npx ng build` (in `frontend/`), then give manual test steps. All UI texts English with i18n IDs
    (`i18n="@@<feature>.<key>"`, `$localize`). No new libraries. Follow `doc/architecture.md`.
  - `doc/architecture.md`: package table (line ~49 `auth`, ~57 `admin`), data model table (`users` row
    ~349), frontend admin feature (~336).
- **Key files and directories:**
  - `backend/internal/auth/models.go` — `User` model (add `LastActiveAt *time.Time`).
  - `backend/internal/auth/handler.go` — `login` (set value after `createSession`), `RequireAuth`
    (throttled update after `extendSession`).
  - `backend/internal/auth/session.go` — `lookupSession` (preloads `User`), `sessionLifetime`,
    `extendBelow` constants (place a new `activityInterval = time.Hour` constant near them or in
    handler.go).
  - `backend/cmd/collageomat/main.go` — `models()` list for AutoMigrate (`auth.User` is already in it; no
    change needed).
  - `backend/internal/admin/handler.go` — `userResponse` / `newUserResponse` (add
    `LastActiveAt *time.Time \`json:"lastActiveAt"\``).
  - `backend/internal/admin/service.go` — `UserSummary` embeds `auth.User` (no change needed).
  - `frontend/src/app/core/models/admin.ts` — `AdminUser` (add `lastActiveAt: string | null`).
  - `frontend/src/app/features/admin/users/admin-users.page.{ts,html,scss}` — table columns.
- **Existing patterns to follow:**
  - Date display: `frontend/src/app/features/collages/collages.page.html` (`{{ row.updatedAt | date: 'medium' }}`,
    `DatePipe` imported in the component).
  - Nullable JSON field: `AvatarVersion *int64 \`json:"avatarVersion"\`` in `admin.userResponse`.
  - Column update without touching `updated_at`: GORM `Model(&User{}).Where("id = ?", id).UpdateColumn(...)`.
- **Commands:**
  - Host: `make dev-up && make dev-shell`
  - Container: `cd backend && go build ./... && go vet ./...`
  - Container: `cd frontend && npx ng build`
  - Run: `make backend-run` and `make frontend-serve` → http://localhost:4200
- **Environment / prerequisites:** an admin account (`collageomat user add ... --admin`, see
  `backend/cmd/collageomat/user.go`) and a second user for the test.
- **Domain terms:** "Last activity" = last time the user logged in or used the app with a valid session
  (precision: 1 hour, shown as date only).
- **External references:** none.

## Decision log

- **Meaning of the date:** last activity (login + throttled update on authenticated requests), one column.
  — *Rationale:* sliding sessions make a pure password-login date misleading. Rejected: "last login only"
  (active users look inactive), "last login + last seen" two columns (more than needed).
- **Precision / display:** date only (`DatePipe 'mediumDate'`, e.g. "Nov 17, 2026"). — *Rationale:* developer
  choice; day precision is enough for the admin. Rejected: date + time with 5 min / 1 h throttle.
- **Write rule:** write if the stored value is NULL or older than 1 hour. — *Rationale:* a 24 h rule shows
  yesterday for a user active today; a "UTC day changed" rule shows the wrong day near local midnight
  (browser shows local time, CH = UTC+1/+2). 1 h gives a correct date in every timezone (at most 1 h late)
  for max. 24 small UPDATEs per user per day.
- **Write on login:** always set on a successful password login (no throttle). — *Rationale:* a login is
  activity; it is rare.
- **`updated_at`:** must not change by the activity write (`UpdateColumn`). — *Rationale:* `updated_at`
  means "account data changed".
- **Error handling:** a failed activity write is logged (`slog.Warn`/`slog.Error`) and does not block the
  request or the login. — *Rationale:* same as the session housekeeping in `login`.
- **NULL display:** `—` (em dash). — *Rationale:* correct for "never logged in" and for "not active since the
  upgrade". Rejected: "Never" (wrong for old users), backfill from `sessions.updated_at` (only approximate,
  extra code for a one-time effect).
- **Migration:** GORM AutoMigrate adds the nullable column; existing rows get NULL. No manual migration.
- **Column position:** after "Status", before "Collages".
- **Branch:** work on `main`.
- **Workflow:** developer allowed to implement all steps without review stops (sub-agents); the plan stays
  "in progress" until the developer has tested live.

## Testing strategy

No automated tests (project rule). Build checks: `go build ./... && go vet ./...` and `npx ng build`. Manual
test by the developer (see step acceptance criteria).

## Steps

### Step 1 — Backend: store and return last activity
- **Status:** done (reviewed 2026-11-17)
- **What:** `auth.User.LastActiveAt *time.Time` (column `last_active_at`, nullable). Set to now (UTC) in
  `Handler.login` after the session is created. In `RequireAuth`, after `extendSession`: if
  `sess.User.LastActiveAt` is nil or older than 1 h, `UpdateColumn("last_active_at", now)` and also set the
  value on `sess.User` (the context user). Errors only logged. `admin.userResponse` gets
  `LastActiveAt *time.Time \`json:"lastActiveAt"\``. Update `doc/architecture.md` (`users` data model row,
  `auth` package row).
- **Acceptance criteria:** `go build ./... && go vet ./...` pass. After a server start with an existing DB,
  `users` has the column `last_active_at` (NULL for old rows). After login, `GET /api/admin/users` returns
  `lastActiveAt` with the login time for that user and `null` for users without activity. A further request
  within 1 h does not change the value; `updated_at` stays unchanged.
- **Notes:** `auth.User.LastActiveAt *time.Time` added (models.go). New constant `activityInterval = time.Hour`
  and helper `Handler.touchActivity(userID, now)` (`UpdateColumn`, no `updated_at` change) in session.go.
  `login` calls it after `createSession` (error: `slog.Warn`, login continues) and sets
  `user.LastActiveAt` for the response struct. `RequireAuth` calls it after `extendSession` if the value is
  NULL or `>= activityInterval` old (error: `slog.Warn`; on success it sets `sess.User.LastActiveAt`).
  `admin.userResponse.LastActiveAt` (`json:"lastActiveAt"`) filled from the embedded `auth.User`.
  `doc/architecture.md`: `auth` package row and `users` data model row updated. `go build`, `go vet`,
  `gofmt -l` pass. No deviation from the plan.

### Step 2 — Frontend: "Last activity" column
- **Status:** done (reviewed 2026-11-17)
- **What:** `AdminUser.lastActiveAt: string | null` (RFC 3339, doc comment). In `AdminUsersPage`: import
  `DatePipe`, new column `lastActive` after `active` in `columns`; header "Last activity"
  (`i18n="@@admin.users.column.lastActivity"`); cell `{{ row.lastActiveAt | date: 'mediumDate' }}` or `—`
  for `null`. Update `doc/architecture.md` frontend admin row (table columns).
- **Acceptance criteria:** `npx ng build` passes. Administration → Users shows "Last activity" after
  "Status"; the date of today for the logged-in admin; `—` for a user that never logged in.
- **Notes:** `AdminUser.lastActiveAt: string | null` with doc comment (core/models/admin.ts).
  `AdminUsersPage`: `DatePipe` imported, column `lastActive` after `active`. Template: new
  `matColumnDef="lastActive"` after the "Status" column, header "Last activity"
  (`@@admin.users.column.lastActivity`), cell `date: 'mediumDate'` or `—` in an `@if`/`@else`.
  No SCSS change. `doc/architecture.md` frontend admin row updated. `npx ng build` passes. No deviation
  from the plan.

## Open questions

None.

## Current state / Next action

Done. Both steps implemented and tested live by the developer (2026-11-17). No open work.
