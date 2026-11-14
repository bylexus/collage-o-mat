# AGENTS.md

Collage-o-mat: a self-hosted web app to make photo collages. Photos come from an Immich server or from a
local upload. The user arranges them on a page (grid, center, free placement) and exports PNG/JPG.

One Go binary serves the JSON API (`/api/...`) and the embedded Angular SPA. Data is one SQLite file and
photo files in a data directory. The prod artifact is one Docker image.

## Stack

- Backend: Go 1.27, stdlib `net/http`, GORM + pure-Go SQLite (`glebarez/sqlite`, no CGO) — `backend/`
- Frontend: Angular 22 (standalone, signals), Angular Material, Konva — `frontend/`
- Dev tools: Docker dev container (Go + Node 26 + make), `Makefile` at the repo root
- Prod: multi-arch image `registry.alexi.ch/collageomat` (`docker/Dockerfile`)

## Repository layout

| Path | Content |
|---|---|
| `backend/cmd/collageomat/` | `main.go` (composition root, `serve`), `user.go` (`user add/passwd` CLI) |
| `backend/internal/<domain>/` | One package per domain: `auth`, `collage`, `photo`, `connector`, `connector/immich` |
| `backend/internal/{httpapi,apperr,db,jsoncol,config,secretbox,web}` | Shared building blocks |
| `frontend/src/app/core/` | API services (only place with `HttpClient`), DTO models, auth |
| `frontend/src/app/features/` | Pages: `login`, `collages`, `connectors`, `editor` (canvas, arrange, export, ...) |
| `frontend/src/app/shared/` | Confirm dialog, notifications, error message helper |
| `docker/` | `Dockerfile` (prod), `Dockerfile.dev` (dev container) |
| `doc/agent-plans/` | Feature plans; finished plans in `doc/agent-plans/done/` |
| `data/`, `data-prod/`, `bin/` | Local runtime data and build output — never commit |

## Most used commands

```sh
make dev-up && make dev-shell          # host: start + enter the dev container
make install                           # container: npm ci + go mod download
make backend-run                       # container: Go server on :8080
make frontend-serve                    # container: ng serve on :4200 (proxies /api to :8080)
make build                             # container: SPA + Go binary -> bin/collageomat
make image | make publish              # host: build prod image | build amd64+arm64 and push
```

## Rules for agents

- Do not commit, push or merge unless the developer asks for it in that moment.
- No automated tests exist. Verify with `go build ./... && go vet ./...` (in `backend/`) and
  `npx ng build` (in `frontend/`), then give the developer manual test steps.
- Follow the layering and conventions in [doc/architecture.md](doc/architecture.md). Do not add libraries
  without the developer's approval.
- All UI texts are English and marked for i18n (`i18n="@@<feature>.<key>"`, `$localize`).
- Never commit secrets. `/.env` holds a local Immich test key and is git-ignored.
- If a command or path is blocked by the sandbox, report the exact command/path to the developer.
- New features: write a plan in `doc/agent-plans/<slug>.md`; move it to `done/` when finished.

## Documentation

- [doc/architecture.md](doc/architecture.md) — architecture, backend/frontend structure, data model, API
- [doc/development.md](doc/development.md) — dev container, make targets, env vars, verification
- [doc/deployment.md](doc/deployment.md) — prod image build, publish, run, upgrade
- [doc/agent-plans/done/poc-implementation.md](doc/agent-plans/done/poc-implementation.md) — full PoC plan
  and decision log (history; the docs above are the current state)
