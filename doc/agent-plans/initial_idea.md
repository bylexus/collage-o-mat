# Initial Idea for Collage-o-mat

Collage-o-mat should become a web application for creating photo collages, in the same spirit as the program "Collage It Pro" (for mac).

## Whishlist

- a "Collage" is an arragement of photos on a "page" (e.g. A4 page). The user should be able to create multiple collages.
- a Collage consists of:
  - a set of assigned photos
  - settings, like collage page size, color settings for page color, arrangement mode of photos, photo borders, overlay texts
  - overlay texts (a user can add text as overlay), number of photos
- a collage supports multiple auto-arrangement modes
  - mosaik: arrange different sized photos optimally
  - masonry: masonry layout (like css masonry)
  - grid: all photos in a configurable row/col setting
  - center: one big photo in the center, smaller ones around it in a masonry arrangement
  - heap: like thrown on a table, all photos are arranged slighty rotated / random placed
- after photos were auto-arranged by its mode settings (a one-time operation, e.g. when photos are imported),
  the user should be able to edit them: size, position, rotation, border settings (size, color). So the photos are single objects that just get initially placed, but can be re-arranged after. resizing an image: keep aspect, or cover mode (if user pulls the frame to another aspect than the photo, the frame should be covered) Or the user wants to resize / move the photo WITHIN the frame: e.g. if he only wants a smaller part of a larger photo displayed in the frame.
- images can be loaded by "connectors": a connector connects to an external image source (e.g. "Immich", as first implementation, or "local" for loading local files) to import images to be used. Connectors consist of 2 parts:
  - a UI part that allows the configuration of the connector
  - a server part that does the work
  - Example:
    the Immich connector allows to enter an immich url and api key to connect to an immich server. then it allows the user to import certain albums. this import work is done on the server.
- user roles:
  - normal user
  - admin user: like normal user, but has an additional User admin view
- export: A collage should be exportable to a final image (png, jpg). the collage settings define the size of the final image


## Software Architecture

- Frontend:
  - Angular (newest, 22) as JavaScript SPA Framework
  - SPA
  - ~~PrimeVue~~ Angular Material + CDK as component library (PrimeVue is Vue-only; PrimeNG 22 needs a yearly license key)
  - Konva.js (canvas) for the collage editor and the export
  - Angular i18n (`@angular/localize`), English only for now
- Backend:
  - Golang api web server (stdlib `net/http` ServeMux, own small middleware)
  - GORM for ORM
  - sqlite as db (pure-Go driver `github.com/glebarez/sqlite`, no CGO), postgres later (keep code GORM-only, no raw SQL)
- backend api golang server also serves frontend, embedded in the binary (`go:embed`)
- Authentication:
  - simple username/password login, session cookie, server-side session (own DB session table, bcrypt passwords)
- dev: a docker container, orchestrated by compose. just uses a shell, where goland and npm commands / makefiles can be executed
- prod: multiarch docker image (arm64, amd64, Alpine runtime), published to registry.alexi.ch/collageomat:latest (+ git SHA tag)
- central makefile for all commands (dev, build, publish etc.)
- Immich API: https://api.immich.app/
    - my own instance: https://immich.alexi.ch/


## PoC featureset

for a first PoC, the following featureset should be implemented:

- base app (frontend, backend) including authentication, orm, sqlite
- creating / managing collages
- immich connector, using my own instance
- photo import within a collage
- auto-arrangement modes: grid and center image
- edit collage after auto-arrangement: move, rotate, resize photos, border settings, background color setting of collage
- implement users and roles, but do not implement the user management already. ~~this can be done directly on the db~~ users are created with a CLI subcommand (`collageomat user add`).
- docker dev container with dev commands to build / serve frontend / backend
- added: export to PNG/JPG, overlay texts, prod multiarch image


## Decisions (PoC)

Detailed plan: [poc-implementation.md](poc-implementation.md)

- photos: Immich JPEG/WebP preview (~1440px) is copied to server disk; Immich asset ID is stored for a later high-res export
- photos belong to one collage (deleted with it); no user-level library
- photo row: file columns + one JSON column (frame, rotation, z-order, crop, border); collage row: name + one JSON settings column; texts: own table with JSON column
- page model: mm + DPI (presets A5/A4/A3/Letter/30x30cm/custom, portrait/landscape); export pixels = mm × DPI
- frame/crop: corner resize keeps aspect, edge resize changes aspect with "cover"; crop mode to pan/zoom the image inside the frame
- arrangement runs in the frontend (TypeScript), after each import and with a "Re-arrange" button (overwrites manual edits, confirm dialog)
- grid: rows/cols auto or fixed, gap/margin in mm, equal cells, cover crop, extra photos stacked beside the page
- center: centre photo (size in %) in the middle, remaining ring split in 4 bands, each filled as a justified row/column
- borders: collage default + per-photo override + "apply to all"; drawn inside the frame
- editor: select, move, rotate, resize, crop, delete, z-order buttons, undo/redo (in memory), debounced auto-save (one PUT of the full layout)
- overlay texts: multi-line, 4 bundled fonts, size, colour, bold/italic, align, shadow, outline
- export: in the browser (Konva), uses the previews
- connectors: per user, config as JSON, Immich API key encrypted (AES-GCM, key from `COLLAGEOMAT_SECRET`)
- Immich import: choose album, then select photos from thumbnails; synchronous import (4 parallel downloads)
- access: collages and connectors are visible to their owner only (also not to admins)
- collage list: list + create/rename/delete, no thumbnails
- tests: no automated tests for the PoC, manual review only
