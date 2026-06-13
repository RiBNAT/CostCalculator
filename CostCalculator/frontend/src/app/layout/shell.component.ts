import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { forkJoin } from 'rxjs';

import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ConfirmService } from '../core/confirm-dialog.component';
import { PeriodStateService } from '../core/period-state.service';
import { ExpenseDialogComponent, ExpenseDialogData } from '../features/expenses/expense-dialog.component';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [
    CommonModule, RouterOutlet, RouterLink, RouterLinkActive, MatIconModule, MatButtonModule,
    MatMenuModule, MatTooltipModule, MatDialogModule, MatDividerModule, MatSnackBarModule,
  ],
  template: `
    <div class="shell">
      @if (menuOpen()) {
        <div class="backdrop" (click)="menuOpen.set(false)" aria-hidden="true"></div>
      }
      <aside class="sidenav" [class.open]="menuOpen()">
        <div class="brand">
          <span class="brand-mark">৳</span>
          <span class="brand-name">Cost Calculator</span>
        </div>
        <nav aria-label="Main navigation">
          @for (item of nav; track item.path) {
            <a [routerLink]="item.path" routerLinkActive="active" class="nav-link" (click)="menuOpen.set(false)">
              <mat-icon>{{ item.icon }}</mat-icon>
              <span>{{ item.label }}</span>
            </a>
          }
        </nav>
        <div class="sidenav-footer">
          <a routerLink="/import" routerLinkActive="active" class="nav-link" (click)="menuOpen.set(false)">
            <mat-icon>upload_file</mat-icon><span>Import Excel</span>
          </a>
        </div>
      </aside>

      <div class="main">
        <header class="topbar">
          <button mat-icon-button class="hamburger" (click)="menuOpen.set(!menuOpen())" aria-label="Toggle navigation menu">
            <mat-icon>menu</mat-icon>
          </button>

          <button mat-button [matMenuTriggerFor]="periodMenu" class="period-btn" aria-label="Select period">
            <mat-icon>calendar_month</mat-icon>
            {{ state.selected()?.name ?? 'No period' }}
            @if (state.selected(); as p) {
              <span class="chip" [class.open]="p.status === 'open'" [class.closed]="p.status === 'closed'">{{ p.status }}</span>
            }
            <mat-icon>expand_more</mat-icon>
          </button>
          <mat-menu #periodMenu="matMenu">
            @for (p of state.periods(); track p.id) {
              <button mat-menu-item (click)="state.select(p)">
                <span>{{ p.name }}</span>
                <span class="menu-dates">{{ p.startDate | date: 'd MMM' }} – {{ p.endDate | date: 'd MMM yy' }}</span>
              </button>
            }
            <mat-divider />
            @if (state.selected()?.status === 'open') {
              <button mat-menu-item (click)="closeSelected()">
                <mat-icon>lock</mat-icon>Close {{ state.selected()?.name }}
              </button>
            }
            <button mat-menu-item (click)="managePeriods()">
              <mat-icon>add</mat-icon>New period…
            </button>
          </mat-menu>

          <span class="spacer"></span>

          <button mat-button [matMenuTriggerFor]="userMenu" class="user-btn" aria-label="Account menu">
            <span class="avatar">{{ initials() }}</span>
            <span class="user-name">{{ auth.user()?.name }}</span>
            <mat-icon>expand_more</mat-icon>
          </button>
          <mat-menu #userMenu="matMenu">
            <button mat-menu-item routerLink="/settings"><mat-icon>settings</mat-icon>Settings</button>
            <button mat-menu-item (click)="logout()"><mat-icon>logout</mat-icon>Sign out</button>
          </mat-menu>
        </header>

        <main class="content"><router-outlet /></main>

        @if (state.selected()?.status === 'open') {
          <button mat-fab color="primary" class="quick-add-fab" (click)="quickAddExpense()"
                  aria-label="Add expense" matTooltip="Add expense">
            <mat-icon>add</mat-icon>
          </button>
        }

        <!-- mobile-only bottom navigation -->
        <nav class="bottom-nav" aria-label="Primary">
          @for (item of bottomNav; track item.path) {
            <a [routerLink]="item.path" routerLinkActive="active" class="bnav-link">
              <mat-icon>{{ item.icon }}</mat-icon>
              <span>{{ item.label }}</span>
            </a>
          }
        </nav>
      </div>
    </div>
  `,
  styles: [
    `
      .shell { display: flex; height: 100vh; }
      .sidenav {
        width: 232px;
        background: linear-gradient(180deg, #283593 0%, #1a237e 100%);
        color: #e8eaf6;
        display: flex;
        flex-direction: column;
        padding: 20px 12px;
        flex-shrink: 0;
      }
      .brand { display: flex; align-items: center; gap: 10px; padding: 4px 12px 24px; }
      .brand-mark {
        width: 34px; height: 34px; border-radius: 10px;
        background: rgba(255, 255, 255, 0.16);
        display: grid; place-items: center;
        font-weight: 800; font-size: 18px;
      }
      .brand-name { font-size: 19px; font-weight: 700; letter-spacing: 0.3px; }
      nav { display: flex; flex-direction: column; gap: 2px; flex: 1; }
      .nav-link {
        display: flex; align-items: center; gap: 12px;
        color: #c5cae9; text-decoration: none;
        padding: 10px 12px; border-radius: 10px;
        font-size: 14px; font-weight: 500;
        transition: background 0.15s, color 0.15s;
      }
      .nav-link mat-icon { font-size: 20px; width: 20px; height: 20px; }
      .nav-link:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
      .nav-link.active { background: rgba(255, 255, 255, 0.16); color: #fff; }
      .sidenav-footer { border-top: 1px solid rgba(255, 255, 255, 0.12); padding-top: 8px; }

      .main { flex: 1; display: flex; flex-direction: column; min-width: 0; position: relative; }
      .topbar {
        display: flex; align-items: center; gap: 12px;
        background: var(--surface);
        border-bottom: 1px solid #e7eaf3;
        padding: 8px 20px;
      }
      .hamburger { display: none; }
      .period-btn { font-weight: 600; }
      .period-btn .chip { margin-left: 8px; }
      .spacer { flex: 1; }
      .user-btn { font-weight: 600; }
      .avatar {
        width: 28px; height: 28px; border-radius: 50%;
        background: var(--primary); color: #fff;
        display: inline-grid; place-items: center;
        font-size: 12px; font-weight: 700; margin-right: 8px;
      }
      .menu-dates { margin-left: 12px; color: var(--ink-soft); font-size: 12px; }
      .content { flex: 1; overflow-y: auto; }

      .quick-add-fab {
        position: absolute; right: 24px; bottom: 24px; z-index: 40;
        box-shadow: 0 6px 20px rgba(26, 35, 126, 0.35);
      }

      .backdrop { display: none; }
      .bottom-nav { display: none; }

      @media (max-width: 960px) {
        .sidenav {
          position: fixed; inset: 0 auto 0 0; z-index: 100;
          transform: translateX(-100%);
          transition: transform 0.22s ease;
          box-shadow: 0 0 40px rgba(0, 0, 0, 0.3);
        }
        .sidenav.open { transform: none; }
        .backdrop {
          display: block; position: fixed; inset: 0; z-index: 99;
          background: rgba(15, 19, 40, 0.45);
        }
        .hamburger { display: inline-flex; }
        .user-name { display: none; }
        .avatar { margin-right: 0; }
        .topbar { padding: 6px 10px; gap: 4px; }
        .content { padding-bottom: 64px; }
        .quick-add-fab { right: 16px; bottom: 76px; }
        .bottom-nav {
          display: flex; flex-direction: row; position: fixed; left: 0; right: 0; bottom: 0; z-index: 60;
          background: var(--surface); border-top: 1px solid #e7eaf3;
          padding: 4px 2px calc(4px + env(safe-area-inset-bottom, 0px));
          justify-content: space-around;
        }
        .bnav-link {
          display: flex; flex-direction: column; align-items: center; gap: 2px; flex: 1;
          color: var(--ink-soft); text-decoration: none; font-size: 10px; font-weight: 600; padding: 6px 0;
        }
        .bnav-link mat-icon { font-size: 22px; width: 22px; height: 22px; }
        .bnav-link.active { color: var(--primary); }
      }
    `,
  ],
})
export class ShellComponent implements OnInit {
  readonly auth = inject(AuthService);
  readonly state = inject(PeriodStateService);
  private api = inject(ApiService);
  private router = inject(Router);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);
  private confirm = inject(ConfirmService);

  readonly menuOpen = signal(false);

  nav = [
    { path: '/dashboard', icon: 'dashboard', label: 'Dashboard' },
    { path: '/expenses', icon: 'receipt_long', label: 'Expenses' },
    { path: '/transfers', icon: 'swap_horiz', label: 'Transfers' },
    { path: '/budget', icon: 'savings', label: 'Budget' },
    { path: '/lends', icon: 'handshake', label: 'Lends' },
    { path: '/savings', icon: 'account_balance', label: 'Savings' },
    { path: '/planner', icon: 'event_available', label: 'Planner' },
    { path: '/settings', icon: 'settings', label: 'Settings' },
  ];

  // condensed set for the mobile bottom bar
  bottomNav = [
    { path: '/dashboard', icon: 'dashboard', label: 'Home' },
    { path: '/expenses', icon: 'receipt_long', label: 'Expenses' },
    { path: '/budget', icon: 'savings', label: 'Budget' },
    { path: '/savings', icon: 'account_balance', label: 'Savings' },
    { path: '/planner', icon: 'event_available', label: 'Planner' },
  ];

  ngOnInit(): void {
    this.state.load();
  }

  initials(): string {
    const name = this.auth.user()?.name ?? '';
    return name
      .split(' ')
      .map((p) => p[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }

  /** Quick-add an expense from anywhere; refreshes whatever page is showing. */
  quickAddExpense(): void {
    const p = this.state.selected();
    if (!p || p.status !== 'open') return;
    forkJoin({ categories: this.api.listCategories(), accounts: this.api.listAccounts() }).subscribe(
      ({ categories, accounts }) => {
        const data: ExpenseDialogData = { period: p, categories, accounts };
        this.dialog
          .open(ExpenseDialogComponent, { data, autoFocus: false, panelClass: 'app-dialog' })
          .afterClosed()
          .subscribe((saved) => {
            if (saved) {
              this.snack.open('Expense added', undefined, { duration: 2000 });
              this.state.refreshSelected();
            }
          });
      },
    );
  }

  closeSelected(): void {
    const p = this.state.selected();
    if (!p || p.status !== 'open') return;
    this.confirm
      .confirm({
        title: `Close ${p.name}?`,
        message: 'Closing snapshots account balances into the next period. You can reopen the latest period from Settings.',
        confirmLabel: 'Close period',
      })
      .subscribe((ok) => {
        if (!ok) return;
        this.api.closePeriod(p.id).subscribe({
          next: () => {
            this.snack.open(`${p.name} closed`, undefined, { duration: 2500 });
            this.state.refreshSelected();
          },
          error: (e) => this.snack.open(e?.error?.error?.message ?? 'Close failed', 'OK', { duration: 4000 }),
        });
      });
  }

  managePeriods(): void {
    this.router.navigate(['/settings'], { queryParams: { tab: 'periods' } });
  }

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
