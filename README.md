# Collage-o-mat

A Photo collage web app inspired by CollageIt! Pro

This app is a work-in-progress. Updates coming soon.

## Development

Requirements: Docker (with compose), `make`. All tools (Go 1.27, Node 26) run in the dev container.

On the host:

```sh
make dev-up      # build and start the dev container
make dev-shell   # open a shell in the dev container
make dev-down    # stop and remove the dev container
```

In the dev container (`/workspace`):

```sh
make install                         # npm ci + go mod download (first time, after dependency changes)
make user-add USERNAME=alex ADMIN=1  # create a user (password prompt); make user-passwd USERNAME=alex
make backend-run                     # Go backend on :8080
make frontend-serve                  # Angular dev server on :4200, proxies /api to :8080
```

Run `backend-run` and `frontend-serve` in two shells, then open http://localhost:4200.

`make build` builds the frontend, embeds it in the Go binary and writes `bin/collageomat`
(`./bin/collageomat serve` serves the app on http://localhost:8080).

The dev container sets the environment variables. Data (SQLite database, photos) is stored in `data/`.
`make` without a target lists all targets.

## Deploy

The prod image (`docker/Dockerfile`) is one Alpine image with the Go binary and the embedded frontend.
Build it on the host:

```sh
make image     # build for the local platform, tags registry.alexi.ch/collageomat:latest and :<git sha>
make publish   # build linux/amd64 + linux/arm64 and push both tags
```

`make publish` needs `docker login registry.alexi.ch` and a buildx builder that can build multi-platform
images (docker-container driver or containerd image store). The Makefile does not select a builder.

Run the image:

```sh
docker run -d --name collageomat -p 8080:8080 \
  -e COLLAGEOMAT_SECRET=<secret> \
  -v collageomat-data:/data \
  registry.alexi.ch/collageomat:latest
docker exec -it collageomat /app/collageomat user add --username alex --admin
```

| Variable | Default | Meaning |
|---|---|---|
| `COLLAGEOMAT_SECRET` | — (required) | Key for the encrypted connector API keys. Do not change it later. |
| `COLLAGEOMAT_DATA_DIR` | `/data` | SQLite database and photos |
| `COLLAGEOMAT_LISTEN` | `:8080` | Listen address |
| `COLLAGEOMAT_COOKIE_SECURE` | `true` | Set `false` only without HTTPS |

The container runs as uid/gid 10001. For a bind mount on a Linux host, `chown 10001:10001 <dir>` first.
