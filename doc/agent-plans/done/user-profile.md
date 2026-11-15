# User profile

**Ticket/Source:** none (idea of the developer, 2026-11-14, refined 2026-11-15)
**Branch:** none (work on `main`, developer decision)
**Status:** done (reviewed 2026-11-15)

## Goal

A logged-in user gets an own profile page (route `/profile`). On it the user can:

- change the own password (today only possible with the CLI `collageomat user passwd`),
- set or remove an avatar image. The avatar is shown in the round profile button of the main toolbar. Without
  an avatar, the button shows the first letter of the username (upper case).

The toolbar profile button replaces the logout icon button. A click opens a menu with the username, the
admin badge, "Profile" and "Log out".

## Scope

**In scope:**
- Profile page `/profile`: info header (username, Admin badge, "member since" date), card "Avatar", card
  "Change password".
- Backend endpoints under `/api/profile/...` in a new domain package `backend/internal/profile`.
- Avatar upload: JPEG/PNG/WebP, the server crops it to a centered square and scales it down to at most
  500×500 px, stored as JPEG in a new DB table.
- Toolbar: round profile button (avatar or letter) with a `mat-menu`.
- Shared image package `backend/internal/imaging` (extracted from `backend/internal/photo/process.go`).
- Docs update (`doc/architecture.md`).

**Out of scope:** change the username, e-mail, "forgot password" / reset links, admin resets the password of
other users (see `doc/agent-plans/admin-section.md`), delete the own account, user preferences, avatars of
other users (no API to read another user's avatar), crop dialog in the browser.

## Rough Architecture / Concept

- **Backend `internal/imaging`** (new shared package): the generic image code moves out of
  `internal/photo/process.go`: Content-Type → format check, header check (format, pixel limit 60 MP), decode,
  EXIF orientation, flatten on white, scale (long edge limit, never upscale), JPEG encode. New: square center
  crop. New `imaging.DecodeLimiter` (the slot channel that today is `decodeSlots` in
  `internal/photo/service.go`, 2 slots). One limiter is created in `backend/cmd/collageomat/main.go` and passed
  to the photo service and the profile service, so the server never decodes more than 2 images at the same
  time. *Why:* DRY, no domain-to-domain import, real server-wide memory guard.
- **Backend `internal/profile`** (new domain package, `model.go` / `store.go` / `service.go` / `handler.go`
  like `internal/collage`):
  - Model `Avatar`, table `user_avatars`: `UserID` (primary key, FK to `users.id`, `OnDelete:CASCADE`),
    `Data []byte` (BLOB), `MimeType`, `CreatedAt`, `UpdatedAt`. Added to `models()` in `main.go`.
    *Why own table:* `RequireAuth` loads the `users` row on every API request; a BLOB there would be read
    every time. A DB table keeps the backup one SQLite file and needs no file cleanup.
  - The service declares a `Passwords` interface (consumer-side, per architecture rules), implemented in
    `internal/auth`, wired in `main.go`.
- **Backend `internal/auth` changes:**
  - `RequireAuth` also puts the session ID into the request context (e.g. `auth.SessionID(r)`).
  - New exported type that implements `profile.Passwords`: change password of user ID X with the current
    password, keep session ID Y. It uses the **same** `LoginLimiter` instance as the login (key
    `LoginKey(username, clientIP)`): blocked → `apperr.ErrTooManyRequests` (429, message like the login
    "Too many failed logins. Try again in N minutes."); wrong current password → `limiter.Fail` and
    `apperr.Validation("current password is wrong")` (400 — **not 401**, because the frontend
    `auth.interceptor.ts` logs the user out on 401); success → `limiter.Reset`, `ValidatePassword`, hash,
    update `password_hash`, delete all sessions of the user **except** the current one, in one transaction.
  - `/api/auth/me` (and the login response) gets `createdAt` (RFC 3339) and `avatarVersion` (number, unix
    milliseconds of the avatar `updated_at`, or `null`). `auth` declares an `AvatarVersions` interface
    (`AvatarVersion(ctx, userID) (*int64, error)` or similar), implemented by `profile`, injected via
    `auth.NewHandler` in `main.go`. No import cycle: `auth` never imports `profile`.
- **New `apperr.ErrTooManyRequests`** mapped to 429 in `httpapi.WriteServiceError` (with message).
- **API:**
  - `PUT /api/profile/password` body `{ "currentPassword": "...", "newPassword": "..." }` → 204.
  - `PUT /api/profile/avatar` raw image body (`image/jpeg|png|webp`), max 10 MiB (413 if larger), max 60 MP
    → 200 with the user DTO (same shape as `/api/auth/me`).
  - `DELETE /api/profile/avatar` → 200 with the user DTO (also when no avatar was set).
  - `GET /api/profile/avatar?v=<version>` → own avatar JPEG, `Cache-Control: private, max-age=31536000,
    immutable`; 404 if not set.
  - `httpapi.RequireJSON` (`backend/internal/httpapi/middleware.go`) gets a second exception: `PUT
    /api/profile/avatar` may send `image/jpeg|png|webp`.
- **Frontend:**
  - `core/api/profile.api.ts` (`ProfileApi`): `changePassword`, `uploadAvatar(file)`, `deleteAvatar()`,
    `avatarUrl(version)`.
  - `core/models/user.ts`: `createdAt: string`, `avatarVersion: number | null`.
  - `AuthService`: method to set the current user after an avatar change (from the returned DTO).
  - `features/profile/profile.page.{ts,html,scss}` on route `profile` (child of `AppShell` in
    `app.routes.ts`).
  - Toolbar `layout/app-shell.html`: round button → `mat-menu`.

## Context for a new agent

- **Sources read:** `AGENTS.md` (rules: no commits, no new libraries, i18n, verify with build/vet, plans in
  `doc/agent-plans/`), `doc/architecture.md` (layering: only `store.go` uses `*gorm.DB`; services return
  `apperr` errors; cross-domain only via consumer-declared interfaces wired in `main.go`; frontend: only
  `core/api` uses `HttpClient`, page components hold state).
- **Key files:**
  - `backend/internal/auth/handler.go` — routes login/logout/me, `RequireAuth`, `userResponse`.
  - `backend/internal/auth/session.go` — sessions, cookie, `lookupSession`.
  - `backend/internal/auth/users.go` — `CreateUser`, `SetPassword` (CLI; deletes all sessions).
  - `backend/internal/auth/password.go` — `ValidatePassword` (min 8 runes, max 72 bytes), `hashPassword`,
    `checkPassword`.
  - `backend/internal/auth/loginlimit.go` — `LoginLimiter` (3 failures / 15 min → 15 min block), `LoginKey`,
    `ClientIP`.
  - `backend/internal/auth/context.go` — `UserFromContext`, `UserID`.
  - `backend/internal/photo/process.go` — image processing to extract; `backend/internal/photo/service.go`
    — `decodeSlots`, `processLimited`, `readUpload`; `backend/internal/photo/handler.go` — upload handler.
  - `backend/internal/httpapi/middleware.go` — `RequireJSON`, `isUploadPath`.
  - `backend/internal/httpapi/` error mapping `WriteServiceError`; `backend/internal/apperr/`.
  - `backend/cmd/collageomat/main.go` — composition root, `models()`, `newDomainModules`.
  - `frontend/src/app/app.routes.ts`, `frontend/src/app/layout/app-shell.{html,scss,ts}`,
    `frontend/src/app/core/auth.service.ts`, `frontend/src/app/core/api/auth.api.ts`,
    `frontend/src/app/core/auth.interceptor.ts` (401 → logout), `frontend/src/app/core/models/user.ts`,
    `frontend/src/app/shared/notification.service.ts`, `frontend/src/app/shared/error-message.ts`.
- **Existing patterns:** domain package layout `backend/internal/collage/`; raw-body upload
  `backend/internal/photo/handler.go` `upload`; page component `frontend/src/app/features/connectors/`.
- **Commands:** `cd backend && go build ./... && go vet ./...`; `cd frontend && npx ng build`. Dev: `make
  dev-up && make dev-shell`, then `make backend-run` and `make frontend-serve` (http://localhost:4200).
- **Domain terms:** Avatar = profile image of a user; avatar version = unix ms of the avatar `updated_at`,
  used as cache buster in the image URL.

## Decision log

- **Avatar size "max 500×500":** server center-crops to a square and scales down to at most 500×500 (never
  upscales), JPEG. — *Rationale:* round button; any photo works without user error. Rejected: keep aspect,
  reject large images, browser crop dialog (more UI work).
- **Avatar storage:** own table `user_avatars` (BLOB). — *Rationale:* one-file backup, no file cleanup, not
  loaded by `RequireAuth`. Rejected: BLOB on `users` (loaded each request), file in data dir.
- **API / package:** `/api/profile/*` in new package `internal/profile`. — *Rationale:* follows the domain
  package pattern; `auth` stays small. Rejected: all under `/api/auth/*`.
- **Sessions after password change:** keep the current session, delete all other sessions of the user.
- **Current password:** required.
- **Brute force:** reuse the login `LoginLimiter` (same instance and key; login and password change share the
  counter). Blocked → 429.
- **Wrong current password status:** 400, not 401 (the frontend interceptor logs out on 401).
- **Toolbar:** round button opens a `mat-menu`: header with username + Admin badge, "Profile", "Log out".
  Username text and admin badge leave the toolbar. Tooltip = username. The About icon stays.
- **Profile page:** info header (username, Admin badge, member since) + card "Avatar" (large round preview,
  "Upload image" = file picker, saves immediately; "Remove" only when set) + card "Change password"
  (current, new, repeat; client checks: min 8 chars, max 72 UTF-8 bytes, repeat must match).
- **Letter fallback colour:** theme colours `--mat-sys-primary-container` / `--mat-sys-on-primary-container`.
  Rejected: colour from a username hash.
- **Image code sharing:** extract `internal/imaging`. Rejected: profile imports photo; copy the code.
- **Avatar upload limits:** JPEG/PNG/WebP, max 10 MiB body, max 60 MP.
- **Decode memory guard:** one shared `imaging.DecodeLimiter` (2 slots) for photo and profile. Rejected: own
  limiter in profile.
- **Workflow:** no feature branch; all steps implemented without per-step review; the developer tests at the
  end. Coding is done by sub-agents.

## Testing strategy

No automated tests (project rule). Each step: `go build ./... && go vet ./...` and/or `npx ng build`. The
developer tests manually at the end:
- Photo upload still works (step 1 refactor).
- Password: wrong current password (400 message), 3× wrong → 429, too short new password, repeat mismatch
  (client), success → notification, current session stays, other browser is logged out, login with new
  password works.
- Avatar: upload large JPEG/PNG/WebP → square, ≤ 500 px; > 10 MiB → error; non-image → error; remove →
  letter shown; toolbar updates without reload.
- Toolbar menu with mouse and keyboard; Profile and Log out work.

## Steps

### Step 1 — Extract `internal/imaging` + shared `DecodeLimiter`
- **Status:** done (reviewed 2026-11-15)
- **What:** move generic image code from `photo/process.go` into `internal/imaging`; add square center crop;
  move the decode slot logic into `imaging.DecodeLimiter`; create it in `main.go` and pass it to
  `photo.NewService`. No behaviour change for photos.
- **Acceptance criteria:** build/vet pass; photo upload works as before.
- **Notes:** New `backend/internal/imaging/imaging.go` (`Format(contentType)`, `Process(data, format,
  Options{MaxEdge, Square, Quality}) (Result, error)`, `MaxPixels`) and `limiter.go` (`NewDecodeLimiter(n)`,
  `(*DecodeLimiter).Do(ctx, fn)`). `photo/process.go` keeps only photo constants (`MaxUploadBytes`, edge 2560,
  quality 90) and `(*Service).processUpload`. The square crop is done before the EXIF orientation (same
  centre; ±1 px for odd size differences). Client error messages unchanged.

### Step 2 — Backend: profile package + password change
- **Status:** done (reviewed 2026-11-15)
- **What:** `internal/profile` package skeleton; `PUT /api/profile/password`; session ID in context;
  `Passwords` implementation in `auth` with shared limiter; `apperr.ErrTooManyRequests` → 429; `createdAt` in
  the user DTO.
- **Acceptance criteria:** curl: wrong current → 400, 3× → 429, success → 204, other sessions deleted, own
  session alive.
- **Notes:** `backend/internal/auth/passwordchange.go`: `PasswordChanger`, `NewPasswordChanger(db, limiter)`.
  One `LoginLimiter` is created in `main.go` and given to `auth.NewHandler` (new parameter) and
  `NewPasswordChanger`. `auth.SessionID(r)` in `context.go`. `apperr.TooManyRequests/AsTooManyRequests`, mapped
  in `httpapi/errors.go`. curl smoke test passed (400 ×3, then 429; success 204; other session 401).
  `createdAt` is serialized with the local offset (valid RFC 3339).

### Step 3 — Backend: avatar
- **Status:** done (reviewed 2026-11-15)
- **What:** `user_avatars` model/store; `PUT/DELETE/GET /api/profile/avatar`; `RequireJSON` exception;
  `avatarVersion` in the user DTO via `auth.AvatarVersions`.
- **Acceptance criteria:** curl upload of a large photo → GET returns ≤ 500×500 square JPEG; `/api/auth/me`
  shows `avatarVersion`; DELETE → GET 404, `avatarVersion: null`.
- **Notes:** `profile/model.go` (`Avatar`), `profile/store.go` (`GormStore`: `FindAvatar`, `AvatarUpdatedAt`,
  `UpsertAvatar` with ON CONFLICT, `DeleteAvatar`), service constants `MaxAvatarBytes = 10<<20`,
  `MaxAvatarEdge = 500`. `auth.UserResponse` (exported) + `auth.NewUserResponse(ctx, user, avatars)`;
  `auth.NewHandler` takes `AvatarVersions` (the profile service). In `main.go` the decoder and the profile
  service are created before the auth handler; `newDomainModules` receives both. GET uses
  `http.ServeContent` + `nosniff`. curl smoke test passed (500×500, 415, 413, 400, 404 after delete).

### Step 4 — Frontend: profile page
- **Status:** done (reviewed 2026-11-15)
- **What:** `ProfileApi`, user model fields, `AuthService` update method, `features/profile/` page with
  header, avatar card, password card; route `profile`. i18n `@@profile.<key>`.
- **Acceptance criteria:** `npx ng build` passes; page works at `/profile`.
- **Notes:** `AuthService.setUser(user)`. Reusable `shared/user-avatar.ts` (`app-user-avatar`, inputs `user`,
  `size`). Additions: 56 px avatar in the page header; hidden read-only `username` input for password
  managers; hint text under the avatar buttons. No explicit `OnPush` (no component in the codebase sets it).
  No i18n extraction workflow exists (only `sourceLocale: en`).

### Step 5 — Frontend: toolbar profile button + menu
- **Status:** done (reviewed 2026-11-15)
- **What:** round button (avatar or letter) with `mat-menu` (header username + badge, Profile, Log out) in
  `layout/app-shell.*`; remove username text, badge and logout button from the toolbar. i18n
  `@@toolbar.<key>`.
- **Acceptance criteria:** `npx ng build` passes; menu works; avatar updates after upload without reload.
- **Notes:** Uses `UserAvatar`. aria-label `@@toolbar.profileMenu` ("Profile menu"); tooltip = username (not
  i18n). Menu badge reuses `@@toolbar.adminBadge`.

### Step 6 — Docs
- **Status:** done (reviewed 2026-11-15)
- **What:** `doc/architecture.md`: packages (`profile`, `imaging`), API table, data model (`user_avatars`),
  frontend table (`features/profile`). Set status done, move this plan to `doc/agent-plans/done/`.
- **Acceptance criteria:** docs match the code.
- **Notes:** `doc/development.md` and `README.md` needed no change. No 429 row added (the doc has no
  per-error status table); 429 is in the Security section.

## Open questions

(none)

## Current state / Next action

Feature done. The developer tested all steps manually and approved them on 2026-11-15. No open action.
Nothing is committed yet (no branch, work on `main`).
