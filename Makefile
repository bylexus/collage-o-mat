# Collage-o-mat - central Makefile.
# Host targets: dev-up, dev-shell, dev-down, image, publish, release.
# All other targets run inside the dev container (/workspace).

.DEFAULT_GOAL := help

WEB_DIST := backend/internal/web/dist

# Prod image (docker/Dockerfile)
REGISTRY  ?= registry.alexi.ch
IMAGE     ?= collageomat
IMAGE_REF := $(REGISTRY)/$(IMAGE)
GIT_SHA   := $(shell git rev-parse --short HEAD 2>/dev/null)
PLATFORMS ?= linux/amd64,linux/arm64
# publish uses the current default buildx builder. Configuring a builder that can build and push
# multi-platform images (docker-container driver, or containerd image store) is up to the user.
IMAGE_TAGS = -t $(IMAGE_REF):latest -t $(IMAGE_REF):$(GIT_SHA)

# Version shown in the UI (about page, login page copyright line). Set by `make release`.
VERSION_FILE := frontend/src/app/shared/app-version.ts

.PHONY: help dev-up dev-shell dev-down image publish release install backend-run frontend-serve build user-add user-passwd

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  %-16s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

## --- Host (macOS) ---

dev-up: ## [host] Build and start the dev container
	docker compose up -d --build dev

dev-shell: ## [host] Open a shell in the dev container
	docker compose exec dev bash

dev-down: ## [host] Stop and remove the dev container
	docker compose down

image: ## [host] Build the prod image for the local platform and load it (tags latest + git sha)
	@test -n "$(GIT_SHA)" || { echo "no git commit found (git rev-parse --short HEAD)" >&2; exit 1; }
	docker buildx build --load -f docker/Dockerfile $(IMAGE_TAGS) .

publish: ## [host] Build amd64+arm64 prod image and push (needs docker login + multi-platform buildx builder)
	@test -n "$(GIT_SHA)" || { echo "no git commit found (git rev-parse --short HEAD)" >&2; exit 1; }
	docker buildx build --platform $(PLATFORMS) -f docker/Dockerfile $(IMAGE_TAGS) --push .

release: ## [host] Set the UI version, commit it and tag the commit: make release VERSION=1.2.0
	@test -n "$(VERSION)" || { echo "usage: make release VERSION=<version>" >&2; exit 1; }
	@echo '$(VERSION)' | grep -Eq '^v?[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$$' || \
		{ echo "invalid version '$(VERSION)' (expected e.g. 1.2.0, v1.2.0, 1.2.0-rc.1)" >&2; exit 1; }
	@! git rev-parse -q --verify 'refs/tags/$(VERSION)' >/dev/null || \
		{ echo "tag '$(VERSION)' exists already" >&2; exit 1; }
	perl -pi -e "s/^export const APP_VERSION = .*/export const APP_VERSION = '$(VERSION)';/" $(VERSION_FILE)
	@grep -q "^export const APP_VERSION = '$(VERSION)';$$" $(VERSION_FILE) || \
		{ echo "could not set the version in $(VERSION_FILE)" >&2; exit 1; }
	git add -- $(VERSION_FILE)
	git commit -m "Release $(VERSION)" -- $(VERSION_FILE)
	git tag -a '$(VERSION)' -m "Release $(VERSION)"
	@echo "tagged $(VERSION). Push with: git push && git push origin '$(VERSION)'"

## --- Dev container ---

install: ## Install frontend (npm ci) and backend (go mod download) dependencies
	cd frontend && npm ci
	cd backend && go mod download

backend-run: ## Run the Go server (:8080)
	cd backend && go run ./cmd/collageomat serve

frontend-serve: ## Run ng serve with /api proxy (:4200)
	cd frontend && npx ng serve --host 0.0.0.0 --proxy-config proxy.conf.json

build: ## Build the SPA, embed it and build bin/collageomat
	cd frontend && npx ng build
	@set -e; \
	n=$$(ls -d frontend/dist/*/browser 2>/dev/null | wc -l | tr -d ' '); \
	if [ "$$n" != "1" ]; then \
		echo "expected exactly one frontend/dist/*/browser directory, found $$n" >&2; exit 1; \
	fi; \
	out=$$(ls -d frontend/dist/*/browser); \
	find $(WEB_DIST) -mindepth 1 -maxdepth 1 ! -name .gitkeep -exec rm -rf {} +; \
	cp -R "$$out"/. $(WEB_DIST)/; \
	echo "copied $$out -> $(WEB_DIST)"
	cd backend && CGO_ENABLED=0 go build -o ../bin/collageomat ./cmd/collageomat

user-add: ## Create a user: make user-add USERNAME=alex [ADMIN=1]
	@test -n "$(USERNAME)" || { echo "usage: make user-add USERNAME=<name> [ADMIN=1]" >&2; exit 1; }
	cd backend && go run ./cmd/collageomat user add --username '$(USERNAME)' $(if $(filter 1 true yes,$(ADMIN)),--admin)

user-passwd: ## Set a user's password: make user-passwd USERNAME=alex
	@test -n "$(USERNAME)" || { echo "usage: make user-passwd USERNAME=<name>" >&2; exit 1; }
	cd backend && go run ./cmd/collageomat user passwd --username '$(USERNAME)'
