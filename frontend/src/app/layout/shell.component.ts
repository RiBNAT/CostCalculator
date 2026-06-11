import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';

import { AuthService } from '../core/auth.service';
import { PeriodStateService } from '../core/period-state.service';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, MatIconModule, MatButtonModule, MatMenuModule, MatTooltipModule],
  template: `
    <div class="shell">
      <aside class="sidenav">
        <div class="brand">
          <span class="brand-mark">৳</span>
          <span class="brand-name">Ribnat</span>
        </div>
        <nav>
          @for (item of nav; track item.path) {
            <a [routerLink]="item.path" routerLinkActive="active" class="nav-link">
              <mat-icon>{{ item.icon }}</mat-icon>
              <span>{{ item.label }}</span>
            </a>
          }
        </nav>
        <div class="sidenav-footer">
          <a routerLink="/import" routerLinkActive="active" class="nav-link">
            <mat-icon>upload_file</mat-icon><span>Import Excel</span>
          </a>
        </div>
      </aside>

      <div class="main">
        <header class="topbar">
          <button mat-button [matMenuTriggerFor]="periodMenu" class="period-btn">
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
          </mat-menu>

          <span class="spacer"></span>

          <button mat-button [matMenuTriggerFor]="userMenu" class="user-btn">
            <span class="avatar">{{ initials() }}</span>
            {{ auth.user()?.name }}
            <mat-icon>expand_more</mat-icon>
          </button>
          <mat-menu #userMenu="matMenu">
            <button mat-menu-item routerLink="/settings"><mat-icon>settings</mat-icon>Settings</button>
            <button mat-menu-item (click)="logout()"><mat-icon>logout</mat-icon>Sign out</button>
          </mat-menu>
        </header>

        <main class="content"><router-outlet /></main>
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

      .main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
      .topbar {
        display: flex; align-items: center; gap: 12px;
        background: var(--surface);
        border-bottom: 1px solid #e7eaf3;
        padding: 8px 20px;
      }
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
    `,
  ],
})
export class ShellComponent implements OnInit {
  readonly auth = inject(AuthService);
  readonly state = inject(PeriodStateService);
  private router = inject(Router);

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

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
