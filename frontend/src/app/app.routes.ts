import { Routes } from '@angular/router';
import { adminGuard, authGuard, loginGuard } from './core/auth.guard';
import { AppShell } from './layout/app-shell';

export const routes: Routes = [
  // Own layout, without the main toolbar.
  {
    path: 'login',
    canActivate: [loginGuard],
    loadComponent: () => import('./features/login/login.page').then((m) => m.LoginPage),
  },
  // All signed-in pages: rendered inside the AppShell (main toolbar).
  {
    path: '',
    component: AppShell,
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'collages' },
      {
        path: 'collages',
        loadComponent: () =>
          import('./features/collages/collages.page').then((m) => m.CollagesPage),
      },
      {
        path: 'collages/:id',
        loadComponent: () => import('./features/editor/editor.page').then((m) => m.EditorPage),
      },
      {
        path: 'settings/connectors',
        loadComponent: () =>
          import('./features/connectors/connectors.page').then((m) => m.ConnectorsPage),
      },
      {
        path: 'profile',
        loadComponent: () => import('./features/profile/profile.page').then((m) => m.ProfilePage),
      },
      {
        path: 'admin',
        canActivate: [adminGuard],
        loadComponent: () => import('./features/admin/admin.page').then((m) => m.AdminPage),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'users' },
          {
            path: 'users',
            loadComponent: () =>
              import('./features/admin/users/admin-users.page').then((m) => m.AdminUsersPage),
          },
          {
            path: 'settings',
            loadComponent: () =>
              import('./features/admin/settings/admin-settings.page').then(
                (m) => m.AdminSettingsPage,
              ),
          },
        ],
      },
      {
        path: 'about',
        loadComponent: () => import('./features/about/about.page').then((m) => m.AboutPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
