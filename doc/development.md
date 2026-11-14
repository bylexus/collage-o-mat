# Development

All tools (Go 1.27, Node 26, npm, make, git, sqlite3) run in a Docker dev container. The host needs only
Docker (with compose and buildx) and `make`. `make` without a target lists all targets.

## Dev container

Defined in `compose.yaml` (service `dev`) and `docker/Dockerfile.dev`.

- The repository is mounted at `/workspace`.
- Named volumes: `go-mod-cache` (`/go/pkg/mod`), `frontend-node-modules` (`/workspace/frontend/node_modules`).
  Host and container `node_modules` are separate.
- Ports: `8080` (Go server), `4200` (`ng serve`).

```sh
# Host
make dev-up      # build and start the dev container
make dev-shell   # open a shell in the dev container
make dev-down    # stop and remove the dev container
```

## Make targets (inside the dev container, `/workspace`)

| Target | Command / effect |
|---|---|
| `make install` | `npm ci` (frontend) + `go mod download` (backend). First time and after dependency changes |
| `make backend-run` | `go run ./cmd/collageomat serve` on `:8080` |
| `make frontend-serve` | `ng serve --host 0.0.0.0 --proxy-config proxy.conf.json` on `:4200`, `/api` proxied to `:8080` |
| `make build` | `ng build`, copy `frontend/dist/*/browser` to `backend/internal/web/dist/`, `CGO_ENABLED=0 go build -o bin/collageomat` |
| `make user-add USERNAME=<name> [ADMIN=1]` | Create a user (asks for the password) |
| `make user-passwd USERNAME=<name>` | Set a new password (logs the user out) |

Normal workflow: run `make backend-run` and `make frontend-serve` in two shells, open
http://localhost:4200. After `make build`, `./bin/collageomat serve` serves the full app on
http://localhost:8080.

Without a frontend build, `backend/internal/web/dist/` holds only `.gitkeep` and the Go server answers
non-API paths with "frontend not built". This is normal for `make backend-run` + `ng serve`.

## Environment variables

Read in `backend/internal/config/config.go`.

| Variable | Default | Dev container | Meaning |
|---|---|---|---|
| `COLLAGEOMAT_SECRET` | — (required for `serve`) | `dev-only-secret` | Encrypts connector configs. Changing it makes stored API keys unreadable |
| `COLLAGEOMAT_DATA_DIR` | `./data` | `/workspace/data` | SQLite file `collageomat.db` and `photos/` |
| `COLLAGEOMAT_LISTEN` | `:8080` | — | Listen address |
| `COLLAGEOMAT_COOKIE_SECURE` | `true` | `false` | `Secure` flag of the session cookie |
| `COLLAGEOMAT_COOKIE_NAME` | `collageomat_session` | — | Session cookie name (valid cookie token) |

Local data:

- `data/` — dev database and photos (git-ignored). Inspect with `sqlite3 data/collageomat.db`.
- `data-prod/` — data of a locally started prod image (see [deployment.md](deployment.md)).
- `/.env` — local Immich test URL and API key for manual tests. Git-ignored, never commit it.

## Verification

No automated tests exist (decision of the developer). Before handing over a change:

```sh
cd backend && gofmt -l . && go build ./... && go vet ./...
cd frontend && npx ng build
```

Then give the developer concrete manual test steps (URLs, clicks, expected results).

## Conventions

See [architecture.md](architecture.md) for the backend layering and frontend structure. Also:

- Go: stdlib style, doc comments on exported identifiers, `gofmt`/`go vet` clean.
- Angular: standalone components, signals, `inject()`, `@if`/`@for`, Angular Material.
- i18n: every UI text has an `i18n="@@<feature>.<key>"` attribute or uses `$localize`.
- Keep dependencies small. New libraries need the developer's approval.

## Feature plans

Larger features are planned in `doc/agent-plans/<slug>.md` (goal, scope, decision log, steps with status).
Finished plans move to `doc/agent-plans/done/`. Read the related plan before you change a feature.
