import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * Root component. Renders the top-level route: the login page (own layout) or the
 * `AppShell` (toolbar layout) for all signed-in pages.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
  styles: ':host { display: block; height: 100%; }',
})
export class App {}
