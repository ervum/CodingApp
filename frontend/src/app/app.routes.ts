import type { Routes } from '@angular/router';
import { authGuard, defaultStudioRedirectGuard } from './core/auth/auth.guard';
import { guestGuard } from './core/auth/guest.guard';
import { studioContextGuard } from './core/state/studio-context.guard';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    title: 'Sign in · RobDev',
    loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'register',
    canActivate: [guestGuard],
    title: 'Create account · RobDev',
    loadComponent: () => import('./features/auth/register.page').then((m) => m.RegisterPage),
  },
  {
    path: '',
    pathMatch: 'full',
    canActivate: [authGuard, defaultStudioRedirectGuard],
    loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPage),
  },
  {
    path: 's/:studioSlug',
    canActivate: [authGuard, studioContextGuard],
    loadComponent: () =>
      import('./layout/studio-shell/studio-shell.component').then((m) => m.StudioShellComponent),
    children: [
      {
        path: 'home',
        title: 'Home · RobDev',
        loadComponent: () => import('./features/home/home.page').then((m) => m.HomePage),
      },
      {
        path: 'lead',
        title: 'Lead · RobDev',
        data: { fixedAgent: 'lead' },
        loadComponent: () => import('./features/team/team.page').then((m) => m.TeamPage),
      },
      {
        path: 'team',
        title: 'Team · RobDev',
        loadComponent: () => import('./features/team/team.page').then((m) => m.TeamPage),
      },
      {
        path: 'team/:agentKey',
        title: 'Team · RobDev',
        loadComponent: () => import('./features/team/team.page').then((m) => m.TeamPage),
      },
      {
        path: 'tasks',
        title: 'Tasks · RobDev',
        loadComponent: () => import('./features/tasks/tasks.page').then((m) => m.TasksPage),
      },
      {
        path: 'review',
        title: 'Review · RobDev',
        loadComponent: () => import('./features/review/review.page').then((m) => m.ReviewPage),
      },
      {
        path: 'output',
        title: 'Output · RobDev',
        loadComponent: () => import('./features/output/output.page').then((m) => m.OutputPage),
      },
      {
        path: 'workspace',
        title: 'Workspace · RobDev',
        loadComponent: () =>
          import('./features/workspace/workspace.page').then((m) => m.WorkspacePage),
      },
      {
        path: 'games',
        title: 'Games · RobDev',
        loadComponent: () => import('./features/games/games.page').then((m) => m.GamesPage),
      },
      {
        path: 'games/:gameSlug',
        title: 'Game · RobDev',
        loadComponent: () =>
          import('./features/games/games.page').then((m) => m.GamesPage),
      },
      {
        path: 'pitches',
        title: 'Pitches · RobDev',
        loadComponent: () => import('./features/pitches/pitches.page').then((m) => m.PitchesPage),
      },
      {
        path: 'pitches/:pitchId',
        title: 'Pitch · RobDev',
        loadComponent: () => import('./features/pitches/pitches.page').then((m) => m.PitchesPage),
      },
      {
        path: 'market',
        title: 'Market · RobDev',
        loadComponent: () => import('./features/market/market.page').then((m) => m.MarketPage),
      },
      {
        path: 'library',
        title: 'Library · RobDev',
        loadComponent: () => import('./features/library/library.page').then((m) => m.LibraryPage),
      },
      {
        path: 'usage',
        title: 'Usage & Costs · RobDev',
        loadComponent: () => import('./features/usage/usage.page').then((m) => m.UsagePage),
      },
      {
        path: 'settings',
        title: 'Settings · RobDev',
        loadComponent: () =>
          import('./features/settings/settings.page').then((m) => m.SettingsPage),
      },
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'home',
      },
    ],
  },
  {
    path: '**',
    redirectTo: '',
  },
];
