# Encrypted photo storage per collage

**Ticket/Source:** none (rough idea of the developer, 2026-11-14)
**Branch:** none
**Status:** planning

## Goal

The server copies photos into its own storage (`<DATA_DIR>/photos/<collageId>/<photoId>.<ext>`): Immich
imports store a copy of the Immich preview, local uploads store a re-encoded JPEG. These can be private
photos, and some users do not want plain copies on the server disk. The user can therefore choose, per
collage, to store the photos of that collage encrypted. The user sets a separate password for that collage
(not the login password). When the collage is opened, the app asks for this password; without it, the
photos cannot be read.

Developer's original wording: "the user should be able to choose if its photos are stored encrypted on the
server: as the server copies possible private photos to its own storage, some users may be concerned. so
the user may select to encrypt them with a separate password he can set per collage (it is then asked when
a collage is opened)."

## Scope

**In scope (expected):**
- Per-collage option "encrypt photos" with a collage password.
- Photo files of such a collage are stored encrypted on disk (imports and uploads).
- The editor asks for the password when an encrypted collage is opened; wrong password → clear error.
- Photo file serving for an encrypted collage only after the collage was unlocked.

**Out of scope:** to be decided in the grilling. Expected: protection against a malicious server
operator / a compromised running server (see Concept), encryption of the Immich source itself, password
recovery, encryption of the whole database, encryption of non-photo data (to decide: texts, name).

## Rough Architecture / Concept

Not decided yet (planning phase). Proposal for the grilling:

### Threat model (must be confirmed first)

The server must read the photos in plain form anyway: it downloads Immich previews (the browser never
talks to Immich), and it decodes, rotates and downscales uploads (`backend/internal/photo/process.go`). So
real end-to-end encryption (only the browser knows the key) would need a different import/upload path
(browser fetches through the proxy, encrypts in the browser, server stores blobs only) and still gives the
server the plain image during the Immich proxy step. Therefore the proposed target is **encryption at
rest**: it protects the files and the DB on disk, in backups, against other server users and against a
person with disk access only. It does **not** protect against the operator of the running server (who
could log the password or the plain bytes). The UI/doc text must say this honestly.

### Keys (proposal)

- **Data key (DEK):** one random 32-byte AES-256 key per encrypted collage.
- **Key-encryption key (KEK):** derived from the collage password with Argon2id
  (`golang.org/x/crypto/argon2` — `golang.org/x/crypto` is already a dependency in `backend/go.mod`, so no
  new library) and a random salt per collage.
- `collages` gets new typed columns (e.g. `encrypted bool`, `key_salt`, `kdf_params`, `wrapped_key` = DEK
  sealed with the KEK by AES-GCM). A wrong password fails the GCM open of `wrapped_key` → "wrong password".
- Why wrapping: password change re-wraps only the DEK (no re-encryption of all files); a duplicated
  collage (`doc/agent-plans/duplicate-collage.md`) can copy the encrypted files and the wrapped key as is.
- The existing `backend/internal/secretbox` (key = SHA-256 of `COLLAGEOMAT_SECRET`) is **not** suitable as
  is: a fast hash is not a password KDF. Its AES-GCM code can be reused/generalized (new constructor from a
  raw key) — to decide.

### File encryption

- Photo files are small (Immich preview, uploads ≤ 2560 px JPEG), so whole-file AES-256-GCM
  (`nonce ‖ ciphertext`) in memory is enough; no streaming format. Associated data e.g. collage id + photo
  id, so files cannot be swapped between photos/collages unnoticed.
- Write: in `photo.Service.createPhoto` (`backend/internal/photo/service.go`) before `DiskStorage.Save`
  (`backend/internal/photo/storage.go`). Read: `photo.Service.OpenFile` decrypts into memory and returns a
  `bytes.Reader` (implements `io.ReadSeeker` for `http.ServeContent`).
- File name/extension could stay (`<collageId>/<photoId>.<ext>`) or get `.enc` — to decide.

### Unlock and key lifetime (the hard part)

- The editor loads images with `<img src="/api/collages/{id}/photos/{photoId}/file">`
  (`frontend/src/app/core/models/photo.ts:78`, `frontend/src/app/features/editor/canvas/image-cache.ts`).
  An `<img>` cannot send a custom header, so the password cannot travel with each file request.
- Proposal: `POST /api/collages/{id}/unlock` with `{password}`; the server unwraps the DEK and keeps it **in
  memory only**, keyed by (session, collage id), with an idle timeout. Never in the DB, never in a cookie.
  Server restart, logout, session expiry or timeout → locked again; the editor asks again.
- Locked collage: `GET /api/collages/{id}` returns metadata + `encrypted: true, locked: true` (and no
  photos? to decide); file requests return e.g. 423 Locked / 403 with a distinct error code.
- Import and upload into an encrypted collage also need the unlocked DEK.

### Caching (security relevant)

- Photo files are served today with `Cache-Control: private, max-age=31536000, immutable`
  (`backend/internal/photo/handler.go`, `fileCacheControl`). For encrypted collages this must become
  `no-store`, else the browser disk cache keeps plain copies. Consequence: images are re-downloaded more
  often (acceptable?).

### Turning encryption on/off for an existing collage

- On: encrypt all existing files of the collage (one-time, can take time for many photos; needs atomic
  replace per file — `DiskStorage.Save` is already atomic via temp file + rename).
- Off: decrypt all files back. Change password: re-wrap the DEK only.
- Or: allow the choice only when the collage is created (simpler) — to decide.

### Frontend (expected)

- Create dialog (`frontend/src/app/features/collages/collage-create-dialog.*`): checkbox "Encrypt photos"
  + password + repeat.
- Collages list (`collages.page.html`): lock icon for encrypted collages.
- Editor (`frontend/src/app/features/editor/`): before loading, a password dialog when `locked`; retry on
  wrong password; cancel → back to the list.
- Export (`features/editor/export/`) uses the same file URLs → works while unlocked.
- All texts in English with i18n ids (`@@collages.encrypt.*`, `@@editor.unlock.*`).

## Open questions (for the grilling)

1. Threat model: is "encryption at rest" (server sees plain bytes while running) acceptable, or is real
   client-side end-to-end encryption required (much larger change: import/upload flow, canvas loading,
   processing in the browser)?
2. Enable only at creation, or also later on an existing collage (bulk encrypt/decrypt)? Change password?
3. What is encrypted: only photo files, or also texts (`collage_texts.props`), collage name, settings,
   photo props? (Texts may also be private; the name is shown in the list while locked.)
4. Key lifetime: idle timeout value; per session or per browser tab; lock on leaving the editor? Explicit
   "lock" button?
5. Forgotten password: data is lost (no recovery) — confirm, and the warning text in the create dialog.
6. Password rules (min length?) and rate limiting of unlock attempts (reuse the idea of
   `backend/internal/auth/loginlimit.go`?).
7. Argon2id parameters (memory/time) vs. server resources (small self-hosted boxes, arm64).
8. Behaviour of duplicate (`doc/agent-plans/duplicate-collage.md`): copy encrypted files + same wrapped key
   (same password), or require unlock and allow a new password?
9. Background image (`BackgroundSettings.imageId` in `frontend/src/app/core/models/collage.ts`) is a
   collage photo → automatically covered; any other place that shows photo bytes without the editor
   (future thumbnails in the list)?
10. HTTP status / error codes for "locked" and "wrong password".
11. Metadata leak: `photos.source_asset_id` (Immich id or `sha256:<hex>` of the upload) and image size stay
    plain — acceptable? The upload hash allows to check if a known image is in the collage.
12. Interaction with `doc/agent-plans/done/user-storage-quota.md`: count encrypted size (+28 bytes per file)?

## Context for a new agent

- **Read first:** `doc/architecture.md` (layering, data model, API, security); `doc/development.md`;
  `doc/agent-plans/duplicate-collage.md` (copies photo files per collage); `doc/agent-plans/done/user-storage-quota.md`.
- **Facts from the code (2026-11-14):**
  - Photo files: `DiskStorage` (`backend/internal/photo/storage.go`) with `Save` (atomic, temp + rename),
    `Open` (returns `io.ReadSeekCloser`), `Remove`, `RemoveDir`; paths relative to the photo dir, built by
    `fileName(collageID, photoID, ext)` / `collageDir` in `backend/internal/photo/service.go`.
  - Write path: `Import` → `importAll` → `importOne` → `createPhoto`; `Upload` → `readUpload` →
    `processLimited` → `createPhoto`. Read path: `OpenFile` → handler `file` with `http.ServeContent`.
  - `fileCacheControl = "private, max-age=31536000, immutable"` in `backend/internal/photo/handler.go`.
  - `secretbox` (`backend/internal/secretbox/secretbox.go`): AES-256-GCM, key = SHA-256(secret), output
    base64(nonce ‖ ciphertext). Used for connector configs.
  - `Collage` model (`backend/internal/collage/model.go`): `ID, UserID, Name, Settings (JSON), CreatedAt,
    UpdatedAt`. Typed columns only for identity/ownership/file data → encryption fields are typed columns,
    not JSON settings.
  - `Session` (`backend/internal/auth/models.go`): token hash in DB; good key for an in-memory unlock map.
  - `golang.org/x/crypto` is already in `backend/go.mod` (bcrypt) → `argon2` needs no new module.
  - Frontend loads images by URL in `<img>` (`image-cache.ts`: `ImageCache.get`, `loadImage`).
- **Commands:** in `backend/`: `go build ./... && go vet ./...`; in `frontend/`: `npx ng build`; dev via
  `make dev-up`, `make backend-run`, `make frontend-serve` (see `Makefile`).
- **External references (to check in the grilling):** RFC 9106 (Argon2), OWASP Password Storage Cheat
  Sheet (Argon2id parameters), Go `crypto/cipher` GCM docs.

## Decision log

(empty — fill during grilling)

## Testing strategy

To be decided (project rule: no automated tests, manual review per step). Manual: create an encrypted
collage, import/upload, check that files on disk are not readable images (`file <path>`), restart the
server → password asked again, wrong password refused, export works when unlocked.

## Steps

To be defined after the grilling.

## Current state / Next action

Plan stub written 2026-11-14. Next: grilling, starting with open question 1 (threat model).
