import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';

import { ApiService } from '../../core/api.service';
import { PeriodStateService } from '../../core/period-state.service';
import { PeriodSummary } from '../../core/models';
import { MoneyPipe } from '../../core/money.pipe';
import { formatTaka } from '../../core/amount-expr';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, MatIconModule, MatButtonModule, MatTooltipModule, BaseChartDirective, MoneyPipe],
  template: `
    <div class="page">
      @if (summary(); as s) {
        <h1 class="page-title">Dashboard</h1>
        <p class="page-subtitle">
          {{ s.period.name }} · {{ s.period.startDate | date: 'd MMM' }} – {{ s.period.endDate | date: 'd MMM yyyy' }}
        </p>

        <!-- hero row -->
        <div class="cards-grid hero">
          <div class="card hero-card inhand">
            <div class="label">In hand</div>
            <div class="value">{{ s.inHand | money }}</div>
            <div class="foot">across cash, bank & mobile accounts</div>
          </div>
          <div class="card hero-card">
            <div class="label">Spent this period</div>
            <div class="value">{{ s.budget.totals.actual | money }}</div>
            <div class="foot">
              budget {{ s.budget.totals.budget | money }} ·
              <span [class]="s.budget.totals.remaining >= 0 ? 'pos' : 'neg'">
                {{ s.budget.totals.remaining | money }} {{ s.budget.totals.remaining >= 0 ? 'left' : 'over' }}
              </span>
            </div>
          </div>
          <div class="card hero-card">
            <div class="label">Savings</div>
            <div class="value">{{ savingsTotal() | money }}</div>
            <div class="foot">{{ (s.savings ?? []).length }} accounts</div>
          </div>
          <div class="card hero-card">
            <div class="label">Lending</div>
            <div class="value">{{ s.lendTotals.given | money }}</div>
            <div class="foot">given out · owe {{ s.lendTotals.taken | money }}</div>
          </div>
        </div>

        <!-- accounts -->
        <div class="cards-grid accounts">
          @for (a of liquidAccounts(); track a.account.id) {
            <div class="card acc-card">
              <div class="acc-head">
                <mat-icon>{{ accIcon(a.account.kind) }}</mat-icon>
                <span>{{ a.account.name }}</span>
              </div>
              <div class="acc-balance" [class.neg]="a.current < 0">{{ a.current | money }}</div>
              <div class="acc-open">opened at {{ a.opening | money }}</div>
            </div>
          }
        </div>

        <!-- charts row -->
        <div class="charts-row">
          <div class="card chart-card">
            <h3>Daily spend</h3>
            <canvas baseChart type="bar" [data]="dailyChart()" [options]="barOptions"></canvas>
          </div>
          <div class="card chart-card donut">
            <h3>By category</h3>
            @if ((s.categoryTotals ?? []).length) {
              <canvas baseChart type="doughnut" [data]="categoryChart()" [options]="donutOptions"></canvas>
            } @else {
              <div class="empty-hint">No expenses yet</div>
            }
          </div>
        </div>

        <!-- budget + planner row -->
        <div class="charts-row">
          <div class="card chart-card">
            <div class="card-head-row">
              <h3>Budget burn</h3>
              <a mat-button color="primary" routerLink="/budget">Open budget</a>
            </div>
            @for (c of budgetCats(); track c.categoryId) {
              <div class="burn-row">
                <span class="burn-name">{{ catName(c.categoryId) }}</span>
                <div class="burn-bar">
                  <div class="burn-fill" [style.width.%]="burnPct(c)" [class.over]="c.actual > c.budget"></div>
                </div>
                <span class="burn-nums" [class.neg]="c.actual > c.budget">
                  {{ c.actual | money }} / {{ c.budget | money }}
                </span>
              </div>
            } @empty {
              <div class="empty-hint">No budget set — <a routerLink="/budget">create one</a></div>
            }
          </div>

          <div class="card chart-card">
            <div class="card-head-row">
              <h3>Payment windows</h3>
              <a mat-button color="primary" routerLink="/planner">Planner</a>
            </div>
            @for (w of s.windows ?? []; track w.window.id) {
              <div class="window-row">
                <span>{{ w.window.name }}</span>
                <span class="chip" [class]="w.status.state">
                  {{ windowLabel(w.status) }}
                </span>
              </div>
            } @empty {
              <div class="empty-hint">No payment windows for this period</div>
            }
            @if ((s.reminders ?? []).length) {
              <h3 class="mt">Reminders</h3>
              @for (r of s.reminders ?? []; track r.id) {
                <div class="window-row" [class.done]="r.done">
                  <span><mat-icon class="mini">{{ r.done ? 'check_circle' : 'notifications' }}</mat-icon> {{ r.task }}</span>
                  <span class="date">{{ r.date | date: 'd MMM' }}</span>
                </div>
              }
            }
          </div>
        </div>
      } @else {
        <div class="empty-hint big">
          @if (state.periods().length === 0) {
            <mat-icon class="hint-icon">calendar_month</mat-icon>
            <p>No periods yet. <a routerLink="/import">Import your Excel</a> or create a period from the Expenses page.</p>
          } @else {
            Loading…
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      .hero { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); margin-bottom: 16px; }
      .hero-card .label { color: var(--ink-soft); font-size: 13px; font-weight: 600; }
      .hero-card .value { font-size: 28px; font-weight: 800; margin: 6px 0 4px; font-variant-numeric: tabular-nums; }
      .hero-card .foot { color: var(--ink-soft); font-size: 12px; }
      .hero-card.inhand { background: linear-gradient(135deg, #3949ab, #1e88e5); color: #fff; }
      .hero-card.inhand .label, .hero-card.inhand .foot { color: rgba(255, 255, 255, 0.85); }

      .accounts { grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); margin-bottom: 16px; }
      .acc-card { padding: 14px 16px; }
      .acc-head { display: flex; align-items: center; gap: 8px; color: var(--ink-soft); font-size: 13px; font-weight: 600; }
      .acc-head mat-icon { font-size: 18px; width: 18px; height: 18px; }
      .acc-balance { font-size: 20px; font-weight: 700; margin-top: 6px; font-variant-numeric: tabular-nums; }
      .acc-open { color: var(--ink-soft); font-size: 11px; margin-top: 2px; }

      .charts-row { display: grid; grid-template-columns: 3fr 2fr; gap: 16px; margin-bottom: 16px; }
      @media (max-width: 1000px) { .charts-row { grid-template-columns: 1fr; } }
      .chart-card h3 { margin: 0 0 14px; font-size: 15px; font-weight: 700; }
      .chart-card h3.mt { margin-top: 20px; }
      .chart-card canvas { max-height: 260px; }
      .donut canvas { max-height: 240px; }
      .card-head-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
      .card-head-row h3 { margin: 0; }

      .burn-row { display: grid; grid-template-columns: 130px 1fr auto; gap: 12px; align-items: center; padding: 7px 0; }
      .burn-name { font-size: 13px; font-weight: 600; }
      .burn-bar { height: 8px; background: #eef0f7; border-radius: 99px; overflow: hidden; }
      .burn-fill { height: 100%; background: linear-gradient(90deg, #43a047, #9ccc65); border-radius: 99px; }
      .burn-fill.over { background: linear-gradient(90deg, #e53935, #ef5350); }
      .burn-nums { font-size: 12px; color: var(--ink-soft); font-variant-numeric: tabular-nums; }

      .window-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #f0f2f8; font-size: 14px; }
      .window-row:last-child { border-bottom: none; }
      .window-row.done { opacity: 0.5; }
      .window-row .date { color: var(--ink-soft); font-size: 12px; }
      .mini { font-size: 16px; width: 16px; height: 16px; vertical-align: -3px; margin-right: 4px; }
      .big { padding: 80px 0; }
      .hint-icon { font-size: 48px; width: 48px; height: 48px; color: #c5cae9; }
    `,
  ],
})
export class DashboardComponent {
  private api = inject(ApiService);
  readonly state = inject(PeriodStateService);

  readonly summary = signal<PeriodSummary | null>(null);

  readonly barOptions: ChartConfiguration<'bar'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (ctx) => '৳' + formatTaka((ctx.raw as number) * 100) } },
    },
    scales: {
      x: { grid: { display: false } },
      y: { ticks: { callback: (v) => '৳' + formatTaka((v as number) * 100) } },
    },
  };

  readonly donutOptions: ChartConfiguration<'doughnut'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'right', labels: { boxWidth: 12, font: { size: 12 } } },
      tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ৳${formatTaka((ctx.raw as number) * 100)}` } },
    },
    cutout: '62%',
  };

  private readonly categoryNames = signal<Record<string, string>>({});

  constructor() {
    this.api.listCategories().subscribe((cats) => {
      const map: Record<string, string> = {};
      for (const c of cats) map[c.id] = c.name;
      this.categoryNames.set(map);
    });
    effect(() => {
      const p = this.state.selected();
      if (!p) {
        this.summary.set(null);
        return;
      }
      this.api.periodSummary(p.id).subscribe((s) => this.summary.set(s));
    }, { allowSignalWrites: true });
  }

  readonly liquidAccounts = computed(() =>
    (this.summary()?.accounts ?? []).filter((a) => ['cash', 'bank', 'mobile'].includes(a.account.kind)),
  );

  readonly savingsTotal = computed(() => (this.summary()?.savings ?? []).reduce((t, s) => t + s.current, 0));

  readonly budgetCats = computed(() => this.summary()?.budget.categories ?? []);

  readonly dailyChart = computed<ChartConfiguration<'bar'>['data']>(() => {
    const days = this.summary()?.dailySeries ?? [];
    return {
      labels: days.map((d) => d.date.slice(8) + ' ' + d.weekday.slice(0, 2)),
      datasets: [
        {
          data: days.map((d) => d.total / 100),
          backgroundColor: '#5c6bc0',
          hoverBackgroundColor: '#3949ab',
          borderRadius: 4,
        },
      ],
    };
  });

  readonly categoryChart = computed<ChartConfiguration<'doughnut'>['data']>(() => {
    const cats = [...(this.summary()?.categoryTotals ?? [])].sort((a, b) => b.total - a.total);
    return {
      labels: cats.map((c) => c.name),
      datasets: [
        {
          data: cats.map((c) => c.total / 100),
          backgroundColor: ['#3949ab', '#00897b', '#e53935', '#fb8c00', '#8e24aa', '#039be5', '#7cb342', '#fdd835'],
          borderWidth: 0,
        },
      ],
    };
  });

  catName(id: string): string {
    return this.categoryNames()[id] ?? '—';
  }

  burnPct(c: { budget: number; actual: number }): number {
    if (c.budget <= 0) return c.actual > 0 ? 100 : 0;
    return Math.min(100, (c.actual / c.budget) * 100);
  }

  accIcon(kind: string): string {
    return { cash: 'payments', bank: 'account_balance', mobile: 'smartphone' }[kind] ?? 'wallet';
  }

  windowLabel(st: { state: string; days: number }): string {
    switch (st.state) {
      case 'upcoming':
        return `starts in ${st.days}d`;
      case 'active':
        return st.days === 0 ? 'last day' : `${st.days}d left`;
      case 'expired':
        return `expired ${st.days}d ago`;
      default:
        return 'paid';
    }
  }
}
