import { Component } from '@angular/core';
import { APP_VERSION } from './app-version';

/** First year of the copyright range. */
const COPYRIGHT_START_YEAR = 2026;

/**
 * Copyright line: "© 2026 alexi.ch · Version <version>", or "© 2026–<current year> alexi.ch · ..." in
 * later years.
 */
@Component({
  selector: 'app-copyright-notice',
  template: `&copy; {{ years }}
    <a href="https://alexi.ch" target="_blank" rel="noopener noreferrer">alexi.ch</a>
    &middot; <span i18n="@@copyright.version">Version {{ version }}</span>`,
  styles: `
    :host {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }

    a {
      color: inherit;
    }
  `,
})
export class CopyrightNotice {
  protected readonly years = copyrightYears(new Date().getFullYear());
  protected readonly version = APP_VERSION;
}

function copyrightYears(currentYear: number): string {
  return currentYear > COPYRIGHT_START_YEAR
    ? `${COPYRIGHT_START_YEAR}–${currentYear}`
    : `${COPYRIGHT_START_YEAR}`;
}
