# More fonts for texts

**Ticket/Source:** none (idea of the developer, 2026-11-14)
**Branch:** none (work on `main`, not committed)
**Status:** in progress

## Goal

The text overlays get more fonts to choose from: 3 popular Google Fonts for each of the categories serif,
sans-serif, handwriting and display (12 new fonts, 16 in total). The fonts are bundled with the app
(self-hosted, like the current fonts) and show in the font select of the text panel, on the canvas and in
the export.

## Scope

**In scope:** add 12 developer-approved Google Fonts (via `@fontsource` npm packages) to the text font
choice; flat alphabetical list in the font select.

**Out of scope:**
- Loading fonts at runtime from Google (privacy, offline self-hosting).
- User upload of own fonts; a font browser/search over all Google Fonts.
- Backend changes (the backend does not validate `fontFamily`; it stores `props` as JSON).
- Disabling the bold/italic toggles for fonts without such a face (the browser synthesizes them).
- Grouping the select by category (rejected, see decision log).
- Removing fonts / fallback logic for unknown stored fonts (no font gets removed).

## Rough Architecture / Concept

Frontend only, same pattern as the existing 4 text fonts:

- Each font is a self-hosted `@fontsource/<font>` npm package (Google Fonts, OFL licensed).
- The CSS files of the bundled faces are registered in `frontend/angular.json` → `styles`. `@fontsource`
  CSS uses `unicode-range` subsets and the browser downloads a face only when it is used, so the extra
  fonts cost only build output size, not page load.
- The family names go into `TEXT_FONT_FAMILIES` (`frontend/src/app/core/models/text.ts`); the font select
  in the text panel, the canvas and the export read this list / the stored family name.
- Canvas and export load faces on demand (`frontend/src/app/features/editor/canvas/font-loader.ts`,
  `document.fonts.load`), so no change is needed there.

## Context for a new agent

- **Sources read:** `AGENTS.md` (no new libraries without approval — the 12 packages are approved; verify
  with `go build`/`go vet` and `npx ng build`; UI texts i18n), this plan.
- **Key files and directories:**
  - `frontend/src/app/core/models/text.ts` — `TEXT_FONT_FAMILIES` (`as const` array, value = CSS font
    family) and type `TextFontFamily`. Before this feature: `['Inter', 'Lora', 'Caveat', 'Bebas Neue']`.
  - `frontend/angular.json` → `projects…architect.build.options.styles` — `@fontsource/<pkg>/<weight>.css`
    and `<weight>-italic.css` entries (around line 59–72).
  - `frontend/package.json` — `@fontsource/*` dependencies (`^5.3.0` for the existing ones).
  - `frontend/src/app/features/editor/text-panel/text-properties-panel.html` (lines 18–21) — `mat-select`
    over `fontFamilies`; trigger and each option already render in their own font (`[style.font-family]`).
  - `frontend/src/app/features/editor/text-panel/text-properties-panel.ts` — `fontFamilies = TEXT_FONT_FAMILIES`.
  - `frontend/src/app/features/editor/text-props.ts` — default text props (`fontFamily: 'Inter'`).
  - `frontend/src/app/features/editor/canvas/text-view.ts` — `textFontFace()` builds the CSS font
    shorthand `${style} ${weight} 16px "${fontFamily}"` for loading.
  - `frontend/src/app/features/editor/canvas/font-loader.ts` — `FontLoader`, `loadFonts()`.
- **Existing patterns to follow:** the existing `@fontsource/inter` / `lora` / `caveat` / `bebas-neue`
  entries in `package.json` and `angular.json`.
- **Commands:**
  - `cd frontend && npm install @fontsource/<pkg>…` (in the dev container: `make dev-up && make dev-shell`)
  - `cd frontend && npx ng build`
  - Run: `make backend-run` and `make frontend-serve` (container), open http://localhost:4200
- **Domain terms:** "text" = overlay text of a collage (`CollageText`, `props` JSON); "face" = one
  weight/style combination of a font.
- **External references:** https://fontsource.org (package names, available weights/styles per font),
  https://fonts.google.com (categories, popularity).

## Decision log

- **Font list:** approved by the developer (2026-11-14). 12 new `@fontsource` dependencies:

  | Category | Font | Package | Static faces available |
  |---|---|---|---|
  | Serif | Playfair Display | `@fontsource/playfair-display` | 400–900 + italic |
  | Serif | Merriweather | `@fontsource/merriweather` | 300/400/700/900 + italic |
  | Serif | EB Garamond | `@fontsource/eb-garamond` | 400–800 + italic |
  | Sans-serif | Montserrat | `@fontsource/montserrat` | 100–900 + italic |
  | Sans-serif | Open Sans | `@fontsource/open-sans` | 300–800 + italic |
  | Sans-serif | Poppins | `@fontsource/poppins` | 100–900 + italic |
  | Handwriting | Dancing Script | `@fontsource/dancing-script` | 400–700, no italic |
  | Handwriting | Pacifico | `@fontsource/pacifico` | 400 only |
  | Handwriting | Indie Flower | `@fontsource/indie-flower` | 400 only |
  | Display | Lobster | `@fontsource/lobster` | 400 only |
  | Display | Abril Fatface | `@fontsource/abril-fatface` | 400 only |
  | Display | Righteous | `@fontsource/righteous` | 400 only |

  — *Rationale:* popular Google Fonts per category, excluding fonts the app already uses (Inter, Lora,
  Caveat, Bebas Neue, Roboto for the UI). Rejected alternatives: Libre Baskerville, PT Serif, Lato,
  Raleway, Satisfy, Great Vibes, Shadows Into Light, Alfa Slab One, Comfortaa.
- **Faces per font:** bundle 400, 700, 400-italic, 700-italic where the font has them; for fonts with
  only 400 bundle only 400; Dancing Script 400 + 700. — *Rationale:* same as the existing fonts; bold and
  italic toggles give real faces where they exist.
- **Missing bold/italic faces:** the browser synthesizes them (faux bold/italic); toggles stay enabled.
  — *Rationale:* same behaviour as Caveat (no italic) and Bebas Neue (400 only) today; no per-font
  metadata needed. Rejected: disabling toggles per font (more code, handling of stored texts); 400 only
  for all fonts (lower quality).
- **Order in the select:** one flat list, alphabetical A–Z (16 fonts). — *Rationale:* developer choice;
  simplest change. Rejected: `mat-optgroup` groups by category.
- **Font preview in the select:** already exists (each option and the trigger render in their own font);
  no change.
- **Default font:** stays `Inter`.
- **Removed fonts:** none are removed, so stored texts stay valid; no fallback logic.

## Testing strategy

No automated tests (project has none, see `AGENTS.md`). Verification: `cd frontend && npx ng build`,
then manual review by the developer.

## Steps

### Step 1 — Add the 12 fonts
- **Status:** in progress
- **What:**
  - `npm install` the 12 packages from the decision log in `frontend/` (version `^5.x`, like the others).
  - Add the CSS files to `frontend/angular.json` → `styles` (after the existing text fonts), faces as in
    the decision log ("Faces per font").
  - Set `TEXT_FONT_FAMILIES` in `frontend/src/app/core/models/text.ts` to the 16 family names, sorted
    A–Z: Abril Fatface, Bebas Neue, Caveat, Dancing Script, EB Garamond, Indie Flower, Inter, Lobster,
    Lora, Merriweather, Montserrat, Open Sans, Pacifico, Playfair Display, Poppins, Righteous. Update
    its doc comment if needed.
- **Acceptance criteria:**
  - `cd frontend && npx ng build` succeeds.
  - The font select shows the 16 fonts A–Z, each in its own font.
  - Each new font renders correctly on the canvas and in the PNG/JPG export; bold/italic use the real
    face where it exists, a synthesized one otherwise.
  - Existing collages with the old 4 fonts look unchanged.
- **Notes:** (fill in after implementation)

## Open questions

(none)

## Current state / Next action

Plan approved 2026-11-14. Step 1 is being implemented.
