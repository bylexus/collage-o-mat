# User profile and user menu

**Ticket/Source:** none (rough idea of the developer, 2026-11-14)
**Branch:** none
**Status:** planning

## Goal

A logged-in user can change their own password in the web app (today this is only possible with the CLI
`collageomat user passwd`). The toolbar gets a round user button instead of the logout button. A click on
it opens a dropdown menu with "Profile" (opens the new profile page) and "Log out".

## Scope

**In scope:** profile page with "change password" for the current user; backend endpoint for it; round
user button with a dropdown menu (Profile / Log out) in the toolbar, replacing the logout icon button.
**Out of scope:** to be decided in the grilling. Expected: change the username, avatar images, e-mail,
"forgot password" / reset links, admin resets the password of other users (see
`doc/agent-plans/admin-section.md`), user preferences (e.g. display units, see
`doc/agent-plans/display-units.md`).

## Rough Architecture / Concept

Not decided yet (planning phase). Expected:

- **Backend:** new endpoint in `backend/internal/auth/handler.go`, e.g.
  `POST /api/auth/password` (behind `RequireAuth`) with body `{ currentPassword, newPassword }`. It checks
  the current password (`checkPassword` in `password.go`), validates the new one (`ValidatePassword`),
  stores the hash. Reuse/refactor `SetPassword` (`users.go`; today by username, deletes **all** sessions of
  the user) — decide if the current session survives. Wrong current password → 4xx via `apperr`; consider
  the login rate limit (`loginlimit.go`) against brute force of the current password.
- **Frontend:**
  - `core/api/auth.api.ts` + `core/auth.service.ts`: `changePassword(...)`.
  - New feature `features/profile/` with a profile page (route e.g. `profile`, `authGuard`) in
    `app.routes.ts`: shows the username (and admin role), form with current password, new password,
    repeat new password (Material form fields, client-side checks: same min/max length as the backend,
    repeat must match), success notification (`shared/` notifications), error message helper.
  - Toolbar (`app.html` / `app.ts`): replace the `logout` icon button with a round button
    (`matIconButton` with `account_circle` icon, or initials of the username — to decide) and a
    `mat-menu` with "Profile" (routerLink `/profile`) and "Log out" (existing `logout()`). Decide if the
    username text and the admin badge stay in the toolbar or move into the menu header.
- All texts English and i18n-marked (`i18n="@@profile.<key>"`, `@@toolbar.<key>`).

## Open questions (for the grilling)

- Endpoint shape and name (`POST /api/auth/password` vs. `PUT /api/me/password`)?
- After a password change: keep the current session and delete only the other sessions, or log out
  everywhere (incl. the current session → back to login)?
- Require the current password? (Expected: yes.)
- Rate limit for wrong current passwords (reuse the login limiter)?
- User button: icon (`account_circle`) or round avatar with the initials? Tooltip = username?
- Username and admin badge: keep them in the toolbar, or show them only in the menu header?
- Does "About" stay a separate toolbar icon or move into the menu?
- Profile page content beyond the password (show username, role, created date)?
- New-password rules: only the existing length rules, or more (confirm field only)?

## Context for a new agent

- **Read first:** `doc/architecture.md` (layering, `apperr`, API conventions), `AGENTS.md`.
- **Facts from the code (2026-11-14):**
  - `auth.User` (`backend/internal/auth/models.go`): `ID, Username, PasswordHash, IsAdmin, CreatedAt,
    UpdatedAt`; `Session` table with token hash.
  - `auth.SetPassword(db, username, password)` (`backend/internal/auth/users.go`): validates, hashes,
    updates `password_hash`, deletes all sessions of the user. Used by the CLI `user passwd`
    (`backend/cmd/collageomat/user.go`).
  - `ValidatePassword` (`backend/internal/auth/password.go`): min `minPasswordLen` runes, max
    `maxPasswordLen` bytes; `checkPassword(hash, password)`, `hashPassword`.
  - Routes in `backend/internal/auth/handler.go`: `POST /api/auth/login`, `POST /api/auth/logout`,
    `GET /api/auth/me` (behind `requireAuth`). Login rate limit in `loginlimit.go`.
  - Frontend toolbar `frontend/src/app/app.html`: nav links (Collages, Connectors), username text, admin
    badge, About icon link, logout icon button (`logout()` in `app.ts` → `AuthService.logout()`).
  - Routes `frontend/src/app/app.routes.ts`: `login`, `collages`, `collages/:id`, `settings/connectors`,
    `about`; guards in `core/auth.guard.ts`.
- **Commands:** in `backend/`: `go build ./... && go vet ./...`; in `frontend/`: `npx ng build`; dev via
  `make dev-up`, `make backend-run`, `make frontend-serve`.

## Decision log

(empty — fill during grilling)

## Testing strategy

To be decided (project: no automated tests, manual review per step). Manual: change the password with a
wrong / correct current password, too short new password, mismatched repeat; log in with the new
password; check other sessions; menu works with mouse and keyboard.

## Steps

To be defined after the grilling.
