import { Component, computed, inject, input } from '@angular/core';
import { ProfileApi } from '../core/api/profile.api';
import { User } from '../core/models/user';

/**
 * Round avatar of a user: the avatar image, or the first letter of the username (upper case) on the
 * primary container colour. Decorative only (empty `alt`); the parent gives the accessible name.
 */
@Component({
  selector: 'app-user-avatar',
  template: `
    @if (src(); as url) {
      <img [src]="url" alt="" />
    } @else {
      <span aria-hidden="true">{{ initial() }}</span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      overflow: hidden;
      border-radius: 50%;
      background-color: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
      font-family: var(--mat-sys-title-medium-font);
      font-weight: 500;
      line-height: 1;
      user-select: none;
    }

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  `,
  host: {
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
    '[style.font-size.px]': 'size() * 0.45',
  },
})
export class UserAvatar {
  private readonly api = inject(ProfileApi);

  readonly user = input.required<User>();
  /** Diameter in px. */
  readonly size = input(40);
  /**
   * Image URL for a user other than the logged-in user (e.g. the admin avatar URL). Used only if
   * the user has an avatar (`avatarVersion` not `null`); default: the own profile avatar URL.
   */
  readonly imageUrl = input<string>();

  protected readonly src = computed(() => {
    const version = this.user().avatarVersion;
    if (version === null) {
      return null;
    }
    return this.imageUrl() ?? this.api.avatarUrl(version);
  });
  protected readonly initial = computed(() => {
    const first = Array.from(this.user().username)[0] ?? '?';
    return first.toUpperCase();
  });
}
