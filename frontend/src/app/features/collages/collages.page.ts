import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CollageApi } from '../../core/api/collage.api';
import { CollageSummary, pageLabel } from '../../core/models/collage';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { errorMessage } from '../../shared/error-message';
import { NotificationService } from '../../shared/notification.service';
import { CollageDialogs } from './collage-dialogs.service';

/** A list row: the collage plus its display text for the page. */
interface CollageRow extends CollageSummary {
  pageLabel: string;
}

/** Start page: the user's collages with create, rename, duplicate and delete. */
@Component({
  selector: 'app-collages-page',
  imports: [
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatTooltipModule,
  ],
  templateUrl: './collages.page.html',
  styleUrl: './collages.page.scss',
})
export class CollagesPage {
  private readonly api = inject(CollageApi);
  private readonly dialogs = inject(CollageDialogs);
  private readonly confirm = inject(ConfirmService);
  private readonly notification = inject(NotificationService);
  private readonly router = inject(Router);

  private readonly collages = signal<CollageSummary[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly rows = computed<CollageRow[]>(() =>
    this.collages().map((c) => ({
      ...c,
      pageLabel: pageLabel(c.settings.page, c.settings.displayUnit),
    })),
  );
  protected readonly columns = ['name', 'page', 'photoCount', 'updatedAt', 'actions'];
  /** Ids of the collages with a running duplicate request (their Duplicate button is disabled). */
  protected readonly duplicatingIds = signal<ReadonlySet<number>>(new Set());

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.collages.set(await firstValueFrom(this.api.list()));
    } catch (err) {
      this.loadError.set(
        errorMessage(err, $localize`:@@collages.loadError:Could not load the collages.`),
      );
    } finally {
      this.loading.set(false);
    }
  }

  protected async create(): Promise<void> {
    const request = await this.dialogs.create();
    if (!request) {
      return;
    }
    try {
      const created = await firstValueFrom(this.api.create(request));
      this.putFirst(created);
      this.notification.success($localize`:@@collages.created:Collage created`);
    } catch (err) {
      this.notification.error(errorMessage(err));
    }
  }

  protected async rename(collage: CollageSummary): Promise<void> {
    const name = await this.dialogs.rename(collage.name);
    if (name === undefined || name === collage.name) {
      return;
    }
    try {
      this.putFirst(await firstValueFrom(this.api.rename(collage.id, name)));
      this.notification.success($localize`:@@collages.renamed:Collage renamed`);
    } catch (err) {
      this.notification.error(errorMessage(err));
    }
  }

  protected async duplicate(collage: CollageSummary): Promise<void> {
    const name = await this.dialogs.duplicate(collage.name);
    if (name === undefined) {
      return;
    }
    this.setDuplicating(collage.id, true);
    try {
      const { skippedPhotos, ...copy } = await firstValueFrom(this.api.duplicate(collage.id, name));
      this.putFirst(copy);
      this.notification.success(duplicatedMessage(skippedPhotos));
    } catch (err) {
      this.notification.error(errorMessage(err));
    } finally {
      this.setDuplicating(collage.id, false);
    }
  }

  protected async delete(collage: CollageSummary): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: $localize`:@@collages.delete.title:Delete collage?`,
      message: $localize`:@@collages.delete.message:"${collage.name}:name:" and all its photos will be deleted. This cannot be undone.`,
      confirmLabel: $localize`:@@collages.delete.confirm:Delete`,
      destructive: true,
    });
    if (!confirmed) {
      return;
    }
    try {
      await firstValueFrom(this.api.delete(collage.id));
      this.collages.update((list) => list.filter((c) => c.id !== collage.id));
      this.notification.success($localize`:@@collages.deleted:Collage deleted`);
    } catch (err) {
      this.notification.error(errorMessage(err));
    }
  }

  protected open(collage: CollageSummary): void {
    void this.router.navigate(['/collages', collage.id]);
  }

  private setDuplicating(id: number, busy: boolean): void {
    this.duplicatingIds.update((ids) => {
      const next = new Set(ids);
      if (busy) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  /** Inserts or replaces a collage at the top (the list is sorted by last change). */
  private putFirst(collage: CollageSummary): void {
    this.collages.update((list) => [collage, ...list.filter((c) => c.id !== collage.id)]);
  }
}

/** Success text after a duplicate, with the number of skipped photos (missing file) if any. */
function duplicatedMessage(skipped: number): string {
  if (skipped === 0) {
    return $localize`:@@collages.duplicated:Collage duplicated`;
  }
  return skipped === 1
    ? $localize`:@@collages.duplicatedWithSkippedOne:Collage duplicated. 1 photo skipped (file missing).`
    : $localize`:@@collages.duplicatedWithSkipped:Collage duplicated. ${skipped}:count: photos skipped (file missing).`;
}
