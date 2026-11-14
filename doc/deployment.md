# Deployment

The prod artifact is one Docker image: `registry.alexi.ch/collageomat`. It contains only the Go binary with
the embedded SPA, on Alpine. Build and publish run on the **host** (not in the dev container).

## Image build (`docker/Dockerfile`)

Multi-stage build from the repo root. Build stages run on `$BUILDPLATFORM` (native, no QEMU); Go
cross-compiles for `$TARGETOS/$TARGETARCH`.

| Stage | Base | Work |
|---|---|---|
| `frontend` | `node:26.13.1-alpine3.24` | `npm ci`, `ng build`, checks exactly one `dist/*/browser` |
| `backend` | `golang:1.27.4-alpine3.24` | Copies the SPA to `internal/web/dist/`, `CGO_ENABLED=0 go build -trimpath -ldflags='-s -w'` |
| runtime | `alpine:3.24.4` | `ca-certificates`, `tzdata`, user/group `collageomat` 10001:10001, binary at `/app/collageomat` |

Runtime defaults: `COLLAGEOMAT_DATA_DIR=/data`, `COLLAGEOMAT_LISTEN=:8080`, `VOLUME /data`, `EXPOSE 8080`,
`ENTRYPOINT ["/app/collageomat"]`, `CMD ["serve"]`.

The build context is filtered by `.dockerignore` (no `.env`, `.git`, `data*`, `bin`, `doc`,
`node_modules`, build output). When you add a top-level file the build needs, check `.dockerignore`.

When you change the Go or Node version, update both `docker/Dockerfile` (pinned tags) and
`docker/Dockerfile.dev`, plus `backend/go.mod` / `.nvmrc` as needed.

## Build and publish

Makefile variables: `REGISTRY` (default `registry.alexi.ch`), `IMAGE` (`collageomat`),
`PLATFORMS` (`linux/amd64,linux/arm64`). Tags: `latest` and the short git SHA of `HEAD`.

```sh
make image     # local platform only, loaded into the local Docker (--load)
make publish   # linux/amd64 + linux/arm64, pushed to the registry (--push)
```

Prerequisites for `make publish`:

1. `docker login registry.alexi.ch` (done by the developer).
2. A buildx builder that can build multi-platform images (docker-container driver or containerd image
   store). The Makefile uses the current default builder and does not select one. The default OrbStack
   builder (docker driver) cannot build multi-platform.
3. A commit exists. The SHA tag is the `HEAD` commit, so uncommitted changes are in the image but not
   visible in the tag. Commit first.

Check the pushed image:

```sh
docker buildx imagetools inspect registry.alexi.ch/collageomat:latest
```

## Run

```sh
docker run -d --name collageomat -p 8080:8080 \
  -e COLLAGEOMAT_SECRET=<long random string> \
  -v collageomat-data:/data \
  registry.alexi.ch/collageomat:latest

docker exec -it collageomat /app/collageomat user add --username <name> --admin
docker exec -it collageomat /app/collageomat user passwd --username <name>
```

- Put a TLS reverse proxy in front. Set `-e COLLAGEOMAT_COOKIE_SECURE=false` only for plain HTTP, else
  login does not work.
- `COLLAGEOMAT_SECRET` must stay the same for the life of the data. A new secret makes stored connector
  API keys unreadable (the user must enter them again).
- The container runs as uid/gid 10001. A named volume works directly. For a bind mount on a Linux host,
  run `chown 10001:10001 <dir>` first.
- All environment variables: [development.md](development.md#environment-variables).

Local test of the prod image (data in `data-prod/`, never commit it):

```sh
make image
docker run --rm -p 8080:8080 -e COLLAGEOMAT_SECRET=x -e COLLAGEOMAT_COOKIE_SECURE=false \
  -v "$PWD/data-prod:/data" registry.alexi.ch/collageomat:latest
```

## Upgrade

1. `docker pull registry.alexi.ch/collageomat:latest` (or a SHA tag).
2. Recreate the container with the same volume and secret.
3. The database schema is migrated at start (GORM `AutoMigrate`). Make a backup of the data volume
   (`collageomat.db` + `photos/`) before an upgrade; there is no down-migration.
