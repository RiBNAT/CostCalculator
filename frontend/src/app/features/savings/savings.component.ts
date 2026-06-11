import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';
import { forkJoin } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { PeriodStateService } from '../../core/period-state.service';
import { AccountStatus } from '../../core/models';
import { MoneyPipe } from '../../core/money.pipe';
import { formatTaka } from '../../core/amount-expr';

@Component({
  selector: 'app-savings',
  standalone: true,
  imports: [CommonModule, MatIconModule, BaseChartDirective, MoneyPipe],
  template: `
    <div class="page">
      <h1 class="page-title">Savings</h1>
      <p class="page-subtitle">{{ state.selected()?.name }} · total {{ total() | money }}</p>

      <div class="cards-grid sav-grid">
        @for (s of savings(); track s.account.id) {
          <div class="card sav-card">
            <div class="sav-head"><mat-icon>account_balance</mat-icon> {{ s.account.name }}</div>
            <div class="sav-balance">{{ s.current | money }}</div>
            <div class="sav-delta" [class.pos]="s.current - s.opening > 0">
              {{ s.current - s.opening | money: true }} this period
            </div>
          </div>
        } @empty {
          <div class="card empty-hint">No savings accounts yet — add them in Settings</div>
        }
      </div>

      <div class="card chart-card">
        <h3>Total savings across periods</h3>
        @if ((history().labels?.length ?? 0) > 1) {
          <canvas baseChart type="line" [data]="history()" [options]="lineOptions"></canvas>
        } @else {
          <div class="empty-hint">Needs at least two periods of data</div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .sav-grid { grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); margin-bottom: 16px; }
      .sav-head { display: flex; align-items: center; gap: 8px; color: var(--ink-soft); font-weight: 600; font-size: 13px; }
      .sav-head mat-icon { font-size: 18px; width: 18px; height: 18px; }
      .sav-balance { font-size: 24px; font-weight: 800; margin: 8px 0 2px; font-variant-numeric: tabular-nums; }
      .sav-delta { font-size: 12px; color: var(--ink-soft); }
      .sav-delta.pos { color: var(--good); }
      .chart-card h3 { margin: 0 0 14px; font-size: 15px; font-weight: 700; }
      .chart-card canvas { max-height: 300px; }
    `,
  ],
})
export class SavingsComponent {
  private api = inject(ApiService);
  readonly state = inject(PeriodStateService);

  readonly savings = signal<AccountStatus[]>([]);
  readonly history = signal<ChartConfiguration<'line'>['data']>({ labels: [], datasets: [] });

  readonly lineOptions: ChartConfiguration<'line'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (ctx) => '৳' + formatTaka((ctx.raw as number) * 100) } },
    },
    scales: { y: { ticks: { callback: (v) => '৳' + formatTaka((v as number) * 100) } } },
    elements: { line: { tension: 0.35 } },
  };

  readonly total = computed(() => this.savings().reduce((t, s) => t + s.current, 0));

  constructor() {
    effect(() => {
      const p = this.state.selected();
      if (!p) return;
      this.api.periodSummary(p.id).subscribe((s) => this.savings.set(s.savings ?? []));
    }, { allowSignalWrites: true });
    effect(() => {
      const periods = [...this.state.periods()].sort((a, b) => a.startDate.localeCompare(b.startDate));
      if (!periods.length) return;
      forkJoin(periods.map((p) => this.api.periodSummary(p.id))).subscribe((summaries) => {
        this.history.set({
          labels: periods.map((p) => p.name),
          datasets: [
            {
              data: summaries.map((s) => (s.savings ?? []).reduce((t, x) => t + x.current, 0) / 100),
              borderColor: '#3949ab',
              backgroundColor: 'rgba(57, 73, 171, 0.12)',
              fill: true,
              pointRadius: 3,
            },
          ],
        });
      });
    }, { allowSignalWrites: true });
  }
}
