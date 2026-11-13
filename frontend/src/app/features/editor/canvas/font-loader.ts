// Web font loading for canvas texts. Plain class without Angular.

/**
 * Makes sure the web fonts of canvas texts get loaded and reports when they are ready.
 *
 * The fonts are declared with CSS `@font-face`; the browser loads a face only when the document
 * uses it, and drawing on a canvas does not reliably start the load. A canvas text drawn before
 * its face has loaded is measured and drawn with a fallback font. So:
 *
 * - `request(face)` calls `document.fonts.load(face)` once per face string and reports the face
 *   (`onLoaded(face)`) when the load has finished.
 * - Every `loadingdone` event of `document.fonts` (any face of the document finished loading, e.g.
 *   another unicode-range subset) is reported as `onLoaded(null)` = "any face may have changed".
 *
 * A failed load is ignored: the text keeps the fallback font.
 */
export class FontLoader {
  private readonly requested = new Set<string>();
  private readonly fonts: FontFaceSet | null =
    typeof document !== 'undefined' && document.fonts ? document.fonts : null;
  private destroyed = false;
  private readonly onLoadingDone = (): void => this.onLoaded(null);

  /** @param onLoaded called with the loaded face, or `null` if any face may have changed. */
  constructor(private readonly onLoaded: (face: string | null) => void) {
    this.fonts?.addEventListener('loadingdone', this.onLoadingDone);
  }

  /** Starts loading a face (CSS font shorthand, e.g. `italic 700 16px "Lora"`) once. */
  request(face: string): void {
    if (!this.fonts || this.requested.has(face)) {
      return;
    }
    this.requested.add(face);
    this.fonts.load(face).then(
      () => {
        if (!this.destroyed) {
          this.onLoaded(face);
        }
      },
      () => undefined,
    );
  }

  /** Stops reporting (pending loads still finish, but are not reported). */
  destroy(): void {
    this.destroyed = true;
    this.fonts?.removeEventListener('loadingdone', this.onLoadingDone);
  }
}
