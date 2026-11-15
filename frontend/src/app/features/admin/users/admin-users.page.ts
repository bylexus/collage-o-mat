import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { AdminApi } from '../../../core/api/admin.api';
import { AuthService } from '../../../core/auth.service';
import { AdminUser } from '../../../core/models/admin';
import { errorMessage } from '../../../shared/error-message';
import { NotificationService } from '../../../shared/notification.service';
import { UserAvatar } from '../../../shared/user-avatar';
import { AdminDialogs } from './admin-dialogs.service';

/** Admin tab "Users": list of all users with create, edit and delete. */
@Component({
  selector: 'app-admin-users-page',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatTooltipModule,
    UserAvatar,
  ],
  templateUrl: './admin-users.page.html',
  styleUrl: './admin-users.page.scss',
})
export class AdminUsersPage {
  private readonly api = inject(AdminApi);
  private readonly auth = inject(AuthService);
  private readonly dialogs = inject(AdminDialogs);
  private readonly notification = inject(NotificationService);

  protected readonly users = signal<AdminUser[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly columns = [
    'avatar',
    'username',
    'admin',
    'active',
    'collageCount',
    'photoCount',
    'actions',
  ];

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.users.set(await firstValueFrom(this.api.listUsers()));
    } catch (err) {
      this.loadError.set(
        errorMessage(err, $localize`:@@admin.users.loadError:Could not load the users.`),
      );
    } finally {
      this.loading.set(false);
    }
  }

  protected isSelf(user: AdminUser): boolean {
    return user.id === this.auth.currentUser()?.id;
  }

  protected avatarUrl(user: AdminUser): string | undefined {
    return user.avatarVersion === null ? undefined : this.api.avatarUrl(user.id, user.avatarVersion);
  }

  protected async create(): Promise<void> {
    const created = await this.dialogs.create((request) =>
      firstValueFrom(this.api.createUser(request)),
    );
    if (created) {
      this.notification.success($localize`:@@admin.users.created:User created`);
      await this.load();
    }
  }

  protected async edit(user: AdminUser): Promise<void> {
    const result = await this.dialogs.edit({
      user,
      isSelf: this.isSelf(user),
      save: (request) => firstValueFrom(this.api.updateUser(user.id, request)),
      remove: () =>
        this.dialogs.confirmDelete(user, () => firstValueFrom(this.api.deleteUser(user.id))),
    });
    if (result === 'saved') {
      this.notification.success($localize`:@@admin.users.saved:User saved`);
    } else if (result === 'deleted') {
      this.notification.success($localize`:@@admin.users.deleted:User deleted`);
    } else {
      return;
    }
    await this.load();
  }
}
