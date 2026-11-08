import { Component, computed, input, output, signal } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { ImmichAlbum, immichThumbnailUrl } from '../../../core/models/immich';

/** Step "choose album" of the import dialog, with a name filter (presentational). */
@Component({
  selector: 'app-album-list',
  imports: [MatFormFieldModule, MatIconModule, MatInputModule, MatListModule],
  template: `
    @if (albums().length === 0) {
      <p class="album-message" i18n="@@import.albums.empty">No albums found.</p>
    } @else {
      <mat-form-field class="album-filter" subscriptSizing="dynamic">
        <mat-label i18n="@@import.albums.filter">Filter albums</mat-label>
        <input matInput #filterInput type="search" (input)="filter.set(filterInput.value)" />
        <mat-icon matSuffix>search</mat-icon>
      </mat-form-field>
      <mat-action-list>
        @for (album of filteredAlbums(); track album.id) {
          <button mat-list-item type="button" (click)="selected.emit(album)">
            @if (album.thumbnailAssetId) {
              <img
                matListItemAvatar
                [src]="thumbnailUrl(album.thumbnailAssetId)"
                alt=""
                loading="lazy"
              />
            } @else {
              <mat-icon matListItemIcon>photo_album</mat-icon>
            }
            <span matListItemTitle>{{ album.name }}</span>
            <span matListItemLine i18n="@@import.albums.count">
              {album.assetCount, plural, =1 {1 item} other {{{ album.assetCount }} items}}
            </span>
          </button>
        } @empty {
          <p class="album-message" i18n="@@import.albums.noMatch">No albums match the filter.</p>
        }
      </mat-action-list>
    }
  `,
  styles: `
    .album-filter {
      width: 100%;
    }

    .album-message {
      margin: 16px 0;
      color: var(--mat-sys-on-surface-variant);
    }

    img[matListItemAvatar] {
      object-fit: cover;
    }
  `,
})
export class AlbumList {
  readonly connectorId = input.required<number>();
  readonly albums = input.required<readonly ImmichAlbum[]>();
  readonly selected = output<ImmichAlbum>();

  protected readonly filter = signal('');
  protected readonly filteredAlbums = computed(() => {
    const text = this.filter().trim().toLocaleLowerCase();
    return text === ''
      ? this.albums()
      : this.albums().filter((album) => album.name.toLocaleLowerCase().includes(text));
  });

  protected thumbnailUrl(assetId: string): string {
    return immichThumbnailUrl(this.connectorId(), assetId);
  }
}
