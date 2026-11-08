import { Component, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { ImmichAsset, immichThumbnailUrl } from '../../../core/models/immich';

/**
 * Thumbnail grid of the step "choose photos" (presentational). A click toggles the selection of
 * an asset; assets that are already imported are marked and cannot be selected.
 */
@Component({
  selector: 'app-asset-grid',
  imports: [MatIconModule],
  template: `
    @for (asset of assets(); track asset.id) {
      @let imported = importedIds().has(asset.id);
      @let selected = selectedIds().has(asset.id);
      <button
        type="button"
        class="asset-tile"
        [class.selected]="selected"
        [class.imported]="imported"
        [disabled]="imported || disabled()"
        [attr.aria-pressed]="selected"
        [title]="asset.fileName"
        (click)="toggled.emit(asset.id)"
      >
        <img [src]="thumbnailUrl(asset.id)" [alt]="asset.fileName" loading="lazy" />
        @if (imported) {
          <span class="asset-badge" i18n="@@import.assets.imported">Imported</span>
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

      &.imported img {
        opacity: 0.4;
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
    }
  `,
})
export class AssetGrid {
  readonly connectorId = input.required<number>();
  readonly assets = input.required<readonly ImmichAsset[]>();
  readonly selectedIds = input.required<ReadonlySet<string>>();
  /** Assets that are already in the collage. */
  readonly importedIds = input.required<ReadonlySet<string>>();
  /** Disables all tiles (e.g. while the import runs). */
  readonly disabled = input(false);
  /** Emits the id of the clicked asset. */
  readonly toggled = output<string>();

  protected thumbnailUrl(assetId: string): string {
    return immichThumbnailUrl(this.connectorId(), assetId);
  }
}
