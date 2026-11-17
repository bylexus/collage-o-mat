# Google Photos connector

**Ticket/Source:** none (rough idea of the developer, 2026-11-17)
**Branch:** none
**Status:** idea (no planning yet)

## Goal

New connector kind "Google Photos": the user connects a Google account and imports photos from Google Photos
into a collage, the same way as with the Immich and Synology connectors.

Developer's original wording: "new connector for Google Photos".

## Scope

**In scope (expected):**
- New connector kind next to `immich` and `synology` (`backend/internal/connector/`).
- Connect a Google account, select photos, import them into a collage.

**Out of scope:** to be decided in the grilling.

## Rough Architecture / Concept

Not decided yet. Known facts and points to check before planning:

- **API restriction:** since 2025-03-31 the Google Photos Library API gives access only to media that the
  app itself created. Reading the full library of the user is not possible any more. The replacement for
  "select existing photos" is the **Google Photos Picker API**: the app creates a picker session, the user
  selects photos in Google's own UI (`pickerUri`), the app polls the session and then lists the selected
  media items. Consequence: no browse/search of albums inside Collage-o-mat like for Immich/Synology — the
  selection happens in a Google page. To verify against the current Google docs.
- **Auth:** OAuth 2.0 (scope `photospicker.mediaitems.readonly`), needs a Google Cloud project with an OAuth
  client ID/secret and a registered redirect URI. For a self-hosted app, each server operator probably needs
  an own Google Cloud OAuth client (server config, env vars). Token storage (refresh token) encrypted with
  `secretbox`, like the existing connector secrets.
- **Media download:** media item `baseUrl` is valid only for a limited time and needs the access token;
  size parameters (e.g. `=w2560-h2560`) select the import size (compare `immich-import-size`).
- **Frontend:** connector form (start OAuth flow instead of URL/API key) and an import flow that opens the
  Google picker and waits for the selection, instead of the existing photo browser.

## Open questions

- Is the Picker API flow acceptable for the UX (selection in a Google page / popup)?
- OAuth client: one per server operator (env config) or other options?
- Redirect URI / callback route for self-hosted setups behind different hostnames.
- Token refresh and revocation handling.
