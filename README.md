# Collage-o-mat

A Photo collage web app inspired by CollageIt! Pro, in Go / Angular.

![Main screen screenshot](doc/screens/main-screen.jpg)

## Features

* **Import photos** (Immich, Synology and Google Photos in preview or original size) from:
  * [**Immich**](https://immich.app/) server albums ([setup](#connect-an-immich-server))
  * [**Synology Photos**](https://www.synology.com/dsm/feature/photos) (DSM 7 or newer): albums, folders, albums shared with the account, Shared Space ([setup](#connect-a-synology-photos-nas))
  * [**Google Photos**](https://photos.google.com/): selection in the Google Photos picker, own Google OAuth client ([setup](#connect-google-photos))
  * local files (upload)
* Page presets (A5, A4, A3, Letter, 30 × 30 cm) or custom size, DPI setting
* **Arrange photos automatically** in several modes (grid, center mode, random heap, masonry, free placement)
* Settings dialog per arrangement mode, quick re-roll with the same settings
* Random photo order for grid and center mode
* Swap two photos, set the centre photo
* Background (color, gradient, image)
* Individual photo border, border margins, paddings
* Free placement and rotation
* Crop photos inside their frame (pan, zoom)
* Photo adjustments (non-destructive): brightness, contrast, colour tint (e.g. sepia, greyscale)
* Display lengths in mm or px
* **Snap grid** to align photos and texts
* **Text elements** with 16 bundled fonts
* Undo/redo and auto-save
* Duplicate a collage (full, independent copy with all photos and texts)
* Export final image to png, jpg
* **single-binary server**: just deploy one single binary to your server / container!

## Connect an [Immich](https://immich.app/) server

Collageomat can directly import photos from Immich albums. You define an Immich Connector in Collageomat and 
provide the Immich server URL and an API key.

The API Key needs the following permissions:

`asset.read`, `asset.download`, `asset.view`, `album.read`

## Connect a Synology Photos NAS

Collageomat can import photos from **Synology Photos on DSM 7 or newer** (Photo Station / DSM 6 is not
supported). You define a Synology Connector in Collageomat and provide the NAS URL (e.g.
`https://nas.example.com:5001`), an account and its password. Collageomat shows the albums and folders of
the account's **Personal Space**, the albums that other NAS users shared with the account (tab
"Shared with me") and the folders of the **Shared Space** (tab "Shared Space").

* DSM has no API keys: the connector logs in with account + password. 2-factor authentication is not
  supported.
* Use a **dedicated, read-only NAS account** without 2FA that has access to Synology Photos only.
* The "Shared Space" tab is shown only if the account has access to the Shared Space. The NAS admin must
  enable the Shared Space in Synology Photos and give the account access to it.
* For a self-signed certificate, the connector has the option "Skip TLS certificate verification".

## Connect Google Photos

Collageomat can import photos from your Google Photos library. Google does not let third-party apps browse
a library any more. You select the photos in Google's own **Google Photos picker** page:

1. In the editor, select *Import → <your Google Photos connector>* and click *Open Google Photos*.
2. A popup window opens. Sign in to Google (only when needed, see below) and select the photos.
3. Click *Done*. The popup closes, and Collageomat shows the selected photos. Select *Pick more photos* to
   add more, then import them in preview size (long edge 2048 px) or original size.

Collageomat does not store a Google token. Each import starts with a Google sign-in in the popup. If you
gave consent before and use only one Google account in the browser, Google forwards you at once. The
access token stays in the server memory for 30 minutes, so more imports in that time need no sign-in.

### Create a Google OAuth client

Google requires a registered app (OAuth client) for each installation. Each Collageomat user creates an
own client in an own (free) Google Cloud project and enters it in the connector. You do this one time.

1. Open the [Google Cloud Console](https://console.cloud.google.com/) with your Google account and create
   a new project (e.g. "Collageomat").
2. **Enable the API:** go to *APIs & Services → Library*, search for **"Google Photos Picker API"** and
   click *Enable*. (Do not use the "Google Picker API" — that is a different API.)
3. **Configure the consent screen:** go to *Google Auth Platform* (*APIs & Services → OAuth consent
   screen*) and click *Get started*:
   * *App information:* app name (e.g. "Collageomat"), your e-mail as support e-mail.
   * *Audience:* **External**.
   * *Contact information:* your e-mail. Accept the policy and click *Create*.
4. **Add yourself as test user:** in *Google Auth Platform → Audience*, keep the publishing status
   **Testing** and add your Google account (the one with your photos) under *Test users*. Only test users
   can sign in (max. 100).
5. **Add the scope:** in *Google Auth Platform → Data Access*, click *Add or remove scopes* and add
   `https://www.googleapis.com/auth/photospicker.mediaitems.readonly` (filter for "photospicker"). Click
   *Save*.
6. **Create the client:** in *Google Auth Platform → Clients*, click *Create client*:
   * *Application type:* **Web application**, name e.g. "Collageomat".
   * *Authorized JavaScript origins:* leave empty.
   * *Authorized redirect URIs:* add the **redirect URI** that the Collageomat connector form shows, e.g.
     `https://collage.example.com/api/googlephotos/oauth/callback`. It must match exactly (scheme, host,
     port, path).
   * Click *Create* and copy the **Client ID** and the **Client secret**. Keep the secret safe.
7. In Collageomat, go to *Connectors → Add connector → Google Photos* and enter the client ID
   and the client secret. Click *Test* to check them.

Notes:

* **Redirect URI:** Google accepts only `https://` URIs, except `http://localhost`. If you open
  Collageomat with a different address (another host name or port), add that redirect URI in Google too
  and save the connector again from that address.
* **Testing status:** Google shows the warning "Google hasn't verified this app". This is normal for your
  own app: click *Continue*. In the Testing status, Google asks for your consent again after 7 days. You do
  not need to publish or verify the app.
* **Popups:** allow popups for Collageomat in the browser, or the picker cannot open.
* **Videos** cannot be imported; selected videos are skipped. One selection can have up to 2000 items.
* The selected photos stay available for about 1 hour (Google limit). After that, select them again.

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
| `COLLAGEOMAT_SECRET` | — (required) | Key for the encrypted connector API keys and passwords. Do not change it later. |
| `COLLAGEOMAT_DATA_DIR` | `/data` | SQLite database and photos |
| `COLLAGEOMAT_LISTEN` | `:8080` | Listen address |
| `COLLAGEOMAT_COOKIE_SECURE` | `true` | Set `false` only without HTTPS |
| `COLLAGEOMAT_COOKIE_NAME` | `collageomat_session` | Name of the session cookie |

The container runs as uid/gid 10001. For a bind mount on a Linux host, `chown 10001:10001 <dir>` first.
