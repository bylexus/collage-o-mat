import { Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Photo, photoFileUrl } from '../../core/models/photo';

/** Grid of the photos of a collage with a delete button per photo (presentational). */
@Component({
  selector: 'app-photo-grid',
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    @for (photo of photos(); track photo.id; let index = $index) {
      <figure class="photo-tile">
        <img
          [src]="fileUrl(photo.id)"
          i18n-alt="@@editor.photo.alt"
          alt="Photo {{ index + 1 }}"
          loading="lazy"
        />
        <button
          matIconButton
          type="button"
          class="photo-delete"
          (click)="deleteRequested.emit(photo)"
          i18n-aria-label="@@editor.photo.delete"
          aria-label="Delete photo"
          i18n-matTooltip="@@editor.photo.delete"
          matTooltip="Delete photo"
        >
          <mat-icon>delete</mat-icon>
        </button>
      </figure>
    }
  `,
  styles: `
    :host {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 8px;
    }

    .photo-tile {
      position: relative;
      aspect-ratio: 1;
      margin: 0;
      overflow: hidden;
      border-radius: 8px;
      background-color: var(--mat-sys-surface-container-high);

      img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    }

    .photo-delete {
      position: absolute;
      top: 4px;
      right: 4px;
      background-color: color-mix(in srgb, var(--mat-sys-surface) 80%, transparent);
    }
  `,
})
export class PhotoGrid {
  readonly collageId = input.required<number>();
  readonly photos = input.required<readonly Photo[]>();
  readonly deleteRequested = output<Photo>();

  protected fileUrl(photoId: number): string {
    return photoFileUrl(this.collageId(), photoId);
  }
}
