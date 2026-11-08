import { Component, computed, inject } from '@angular/core';
import { AuthService } from '../../core/auth.service';

/** Placeholder start page; replaced by the collage list in step 3. */
@Component({
  selector: 'app-home-page',
  template: `<h1 class="home-title" i18n="@@home.welcome">Welcome, {{ username() }}</h1>`,
  styles: `
    :host {
      display: block;
      padding: 24px 16px;
    }

    .home-title {
      margin: 0;
      font: var(--mat-sys-headline-small);
    }
  `,
})
export class HomePage {
  private readonly auth = inject(AuthService);
  protected readonly username = computed(() => this.auth.currentUser()?.username ?? '');
}
