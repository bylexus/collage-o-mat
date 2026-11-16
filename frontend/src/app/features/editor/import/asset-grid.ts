import { Component, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { SourceAsset } from '../../../core/models/source';

/**
 * Thumbnail grid of the step "choose photos" (presentational). A click toggles the selection of
 * an asset; assets that are already imported or that are not available in the chosen size are
 * marked and cannot be selected. Shared by the import dialogs of all connector types; `T` is the
 * type-specific asset.
 */
@Component({
  selector: 'app-asset-grid',
  imports: [MatIconModule],
  template: `
    @for (asset of assets(); track asset.id) {
      @let imported = importedIds().has(asset.id);
      @let unavailable = !imported && unavailableIds().has(asset.id);
      @let selected = selectedIds().has(asset.id);
      <button
        type="button"
        class="asset-tile"
        [class.selected]="selected"
        [class.imported]="imported"
        [class.unavailable]="unavailable"
        [disabled]="imported || unavailable || disabled()"
        [attr.aria-pressed]="selected"
        [title]="unavailable ? asset.fileName + ' – ' + unavailableReason() : asset.fileName"
        (click)="toggled.emit(asset.id)"
      >
        <img [src]="thumbnailUrl()(asset)" [alt]="asset.fileName" loading="lazy" />
        @if (imported) {
          <span class="asset-badge" i18n="@@import.assets.imported">Imported</span>
        } @else if (unavailable) {
          <span class="asset-badge unavailable-badge" i18n="@@import.assets.originalUnavailable">
            Not available in original size
          </span>
        } @else if (selected) {
          <mat-icon class="asset-check">check_circle</mat-icon>
        }
      </button>
    }
  `,
  styles: `
    :host {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
      gap: 8px;
    }

    .asset-tile {
      position: relative;
      aspect-ratio: 1;
      padding: 0;
      overflow: hidden;
      border: 0;
      border-radius: 8px;
      background-color: var(--mat-sys-surface-container-high);
      cursor: pointer;

      &:disabled {
        cursor: default;
      }

      &:focus-visible {
        outline: 3px solid var(--mat-sys-primary);
        outline-offset: 2px;
      }

      &.selected {
        outline: 3px solid var(--mat-sys-primary);
        outline-offset: -3px;
      }

      &.imported img,
      &.unavailable img {
        opacity: 0.4;
      }

      &.unavailable img {
        filter: grayscale(1);
      }

      img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    }

    .asset-check {
      position: absolute;
      top: 4px;
      right: 4px;
      border-radius: 50%;
      background-color: var(--mat-sys-surface);
      color: var(--mat-sys-primary);
    }

    .asset-badge {
      position: absolute;
      inset: auto 4px 4px;
      padding: 2px 4px;
      border-radius: 4px;
      background-color: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
      font: var(--mat-sys-label-small);

      &.unavailable-badge {
        background-color: var(--mat-sys-surface-container-highest);
        color: var(--mat-sys-on-surface-variant);
      }
    }
  `,
})
export class AssetGrid<T extends SourceAsset> {
  readonly assets = input.required<readonly T[]>();
  /** URL of the thumbnail of an asset (usable as `<img src>`). */
  readonly thumbnailUrl = input.required<(asset: T) => string>();
  readonly selectedIds = input.required<ReadonlySet<string>>();
  /** Assets that are already in the collage. */
  readonly importedIds = input.required<ReadonlySet<string>>();
  /** Assets that cannot be imported in the chosen size (greyed out, not selectable). */
  readonly unavailableIds = input<ReadonlySet<string>>(new Set());
  /** Tooltip reason of unavailable assets; the default lists the rules of the Immich import. */
  readonly unavailableReason = input(
    $localize`:@@import.assets.originalUnavailableReason:Not available in original size: AVIF, GIF and BMP files and images over 60 megapixels are not supported. Use the preview size.`,
  );
  /** Disables all tiles (e.g. while the import runs). */
  readonly disabled = input(false);
  /** Emits the id of the clicked asset. */
  readonly toggled = output<string>();
}
