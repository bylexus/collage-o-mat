import { Routes } from '@angular/router';
import { authGuard, loginGuard } from './core/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [loginGuard],
    loadComponent: () => import('./features/login/login.page').then((m) => m.LoginPage),
  },
  { path: '', pathMatch: 'full', redirectTo: 'collages' },
  {
    path: 'collages',
    canActivate: [authGuard],
    loadComponent: () => import('./features/collages/collages.page').then((m) => m.CollagesPage),
  },
  {
    path: 'collages/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./features/editor/editor.page').then((m) => m.EditorPage),
  },
  {
    path: 'settings/connectors',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/connectors/connectors.page').then((m) => m.ConnectorsPage),
  },
  { path: '**', redirectTo: '' },
];
