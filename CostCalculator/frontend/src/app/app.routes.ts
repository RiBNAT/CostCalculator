import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { pendingChangesGuard } from './core/pending-changes.guard';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./features/auth/login.component').then((m) => m.LoginComponent) },
  {
    path: 'register',
    loadComponent: () => import('./features/auth/register.component').then((m) => m.RegisterComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () => import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'expenses',
        loadComponent: () => import('./features/expenses/expenses.component').then((m) => m.ExpensesComponent),
      },
      {
        path: 'transfers',
        loadComponent: () => import('./features/transfers/transfers.component').then((m) => m.TransfersComponent),
      },
      {
        path: 'budget',
        loadComponent: () => import('./features/budget/budget.component').then((m) => m.BudgetComponent),
        canDeactivate: [pendingChangesGuard],
      },
      {
        path: 'lends',
        loadComponent: () => import('./features/lends/lends.component').then((m) => m.LendsComponent),
      },
      {
        path: 'savings',
        loadComponent: () => import('./features/savings/savings.component').then((m) => m.SavingsComponent),
      },
      {
        path: 'planner',
        loadComponent: () => import('./features/planner/planner.component').then((m) => m.PlannerComponent),
      },
      {
        path: 'settings',
        loadComponent: () => import('./features/settings/settings.component').then((m) => m.SettingsComponent),
      },
      {
        path: 'import',
        loadComponent: () => import('./features/import/import.component').then((m) => m.ImportComponent),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
