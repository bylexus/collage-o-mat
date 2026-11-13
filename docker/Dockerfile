# Prod image: Angular SPA (Node 26) -> Go 1.27 binary with embedded SPA -> Alpine runtime.
# Build stages run on $BUILDPLATFORM (native, no QEMU); Go cross-compiles for $TARGETOS/$TARGETARCH.
# Build from the repo root: make image | make publish

# --- Frontend: ng build (production) ---
FROM --platform=$BUILDPLATFORM node:26.13.1-alpine3.24 AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN set -e; \
    npx ng build; \
    n=$(ls -d dist/*/browser | wc -l); \
    if [ "$n" -ne 1 ]; then echo "expected exactly one dist/*/browser directory, found $n" >&2; exit 1; fi; \
    mv dist/*/browser /spa

# --- Backend: Go binary with embedded SPA ---
FROM --platform=$BUILDPLATFORM golang:1.27.4-alpine3.24 AS backend
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
COPY --from=frontend /spa/ ./internal/web/dist/
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags='-s -w' -o /out/collageomat ./cmd/collageomat

# --- Runtime ---
FROM alpine:3.24.4
RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S -g 10001 collageomat \
    && adduser -S -D -H -u 10001 -G collageomat -h /data -s /sbin/nologin collageomat \
    && mkdir -p /data \
    && chown collageomat:collageomat /data
COPY --from=backend /out/collageomat /app/collageomat
ENV COLLAGEOMAT_DATA_DIR=/data \
    COLLAGEOMAT_LISTEN=:8080
VOLUME /data
EXPOSE 8080
USER 10001:10001
ENTRYPOINT ["/app/collageomat"]
CMD ["serve"]
