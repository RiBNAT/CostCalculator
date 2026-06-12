import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatRippleModule } from '@angular/material/core';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';
import { forkJoin } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { PeriodStateService } from '../../core/period-state.service';
import { AccountStatus, PeriodSummary, PeriodTrends } from '../../core/models';
import { MoneyPipe } from '../../core/money.pipe';
import { formatTaka } from '../../core/amount-expr';
import { daysLeftInclusive, safeToSpendPerDay } from '../../core/runway';
import { DetailDialogComponent, DetailDialogData, DetailRow } from './detail-dialog.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule, RouterLink, MatIconModule, MatButtonModule, MatDialogModule, MatRippleModule,
    BaseChartDirective, MoneyPipe,
  ],
  template: `
    <div class="page">
      @if (summary(); as s) {
        <h1 class="page-title">Dashboard</h1>
        <p class="page-subtitle">
          {{ s.period.name }} · {{ s.period.startDate | date: 'd MMM' }} – {{ s.period.endDate | date: 'd MMM yyyy' }}
        </p>

        <!-- overview -->
        <div class="section-label">Overview</div>
        <div class="cards-grid hero">
          <div class="card hero-card inhand clickable" matRipple (click)="openInHand()">
            <div class="label"><mat-icon>account_balance_wallet</mat-icon> In hand</div>
            <div class="value">{{ s.inHand | money }}</div>
            <div class="foot">cash, bank & mobile <span class="more">details <mat-icon>chevron_right</mat-icon></span></div>
          </div>
          <div class="card hero-card runway">
            <div class="label"><mat-icon>speed</mat-icon> Safe to spend</div>
            @if (runway(); as r) {
              @if (r.days > 0) {
                <div class="value">{{ r.perDay | money }}<span class="per">/day</span></div>
                <div class="foot">
                  {{ r.days }} day{{ r.days === 1 ? '' : 's' }} left ·
                  {{ r.remaining < 0 ? 'over budget' : (r.basis === 'budget' ? 'to stay on budget' : 'of cash in hand') }}
                </div>
              } @else {
                <div class="value">—</div>
                <div class="foot">period ended</div>
              }
            }
          </div>
          <div class="card hero-card clickable" matRipple (click)="openSpent()">
            <div class="label"><mat-icon>shopping_cart</mat-icon> Spent</div>
            <div class="value">{{ s.budget.totals.actual | money }}</div>
            <div class="foot">
              <span [class]="s.budget.totals.remaining >= 0 ? 'pos' : 'neg'">
                {{ s.budget.totals.remaining | money }} {{ s.budget.totals.remaining >= 0 ? 'left' : 'over' }}
              </span>
              of {{ s.budget.totals.budget | money }}
              <span class="more">details <mat-icon>chevron_right</mat-icon></span>
            </div>
          </div>
          <div class="card hero-card clickable" matRipple (click)="openSavings()">
            <div class="label"><mat-icon>savings</mat-icon> Savings</div>
            <div class="value">{{ savingsTotal() | money }}</div>
            <div class="foot">{{ (s.savings ?? []).length }} accounts <span class="more">details <mat-icon>chevron_right</mat-icon></span></div>
          </div>
          <div class="card hero-card clickable" matRipple (click)="openLends()">
            <div class="label"><mat-icon>handshake</mat-icon> Lending</div>
            <div class="value">{{ s.lendTotals.given | money }}</div>
            <div class="foot">given out · owe {{ s.lendTotals.taken | money }} <span class="more">details <mat-icon>chevron_right</mat-icon></span></div>
          </div>
        </div>

        <!-- accounts -->
        <div class="section-label">Accounts</div>
        <div class="cards-grid accounts">
          @for (a of liquidAccounts(); track a.account.id) {
            <div class="card acc-card clickable" matRipple (click)="openAccount(a)">
              <div class="acc-head">
                <span class="acc-icon"><mat-icon>{{ accIcon(a.account.kind) }}</mat-icon></span>
                <span>{{ a.account.name }}</span>
              </div>
              <div class="acc-balance" [class.neg]="a.current < 0">{{ a.current | money }}</div>
              <div class="acc-open" [class.pos]="a.current - a.opening > 0" [class.neg]="a.current - a.opening < 0">
                {{ a.current - a.opening | money: true }} this period
              </div>
            </div>
          }
        </div>

        <!-- charts -->
        <div class="section-label">Activity</div>
        <div class="charts-row">
          <div class="card chart-card">
            <h3>Daily spend</h3>
            <canvas baseChart type="bar" [data]="dailyChart()" [options]="barOptions"
                    role="img" attr.aria-label="Bar chart of daily spending for {{ s.period.name }}"></canvas>
          </div>
          <div class="card chart-card donut">
            <h3>By category</h3>
            @if ((s.categoryTotals ?? []).length) {
              <canvas baseChart type="doughnut" [data]="categoryChart()" [options]="donutOptions"
                      role="img" attr.aria-label="Doughnut chart of spending by category for {{ s.period.name }}"></canvas>
            } @else {
              <div class="empty-hint">No expenses yet</div>
            }
          </div>
        </div>

        <!-- trends -->
        <div class="section-label">Trends</div>
        <div class="charts-row">
          <div class="card chart-card">
            <div class="card-head-row">
              <h3>
                This period vs {{ trends()?.previousPeriodName || 'previous' }}
                @if (spendDelta(); as d) {
                  <span class="delta" [class.neg]="d.pct > 0" [class.pos]="d.pct < 0">{{ d.label }}</span>
                }
              </h3>
            </div>
            @if ((trends()?.comparison ?? []).length) {
              <canvas baseChart type="bar" [data]="comparisonChart()" [options]="trendOptions"
                      role="img" aria-label="Spending by category, this period versus previous"></canvas>
            } @else {
              <div class="empty-hint">No category spending to compare yet</div>
            }
          </div>

          <div class="card chart-card">
            <h3>Last 12 periods</h3>
            @if ((trends()?.series ?? []).length > 1) {
              <canvas baseChart type="bar" [data]="yearChart()" [options]="trendOptions"
                      role="img" aria-label="Total spend and savings over the last twelve periods"></canvas>
            } @else {
              <div class="empty-hint">Not enough history yet — comes together as you add periods</div>
            }
          </div>
        </div>

        <!-- budget + planner -->
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
                  @if (c.actual > c.budget) { <mat-icon class="warn" aria-label="over budget">warning</mat-icon> }
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
                <span class="chip" [class]="w.status.state">{{ windowLabel(w.status) }}</span>
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
            <p>No periods yet. <a routerLink="/import">Import your Excel</a> or create a period in Settings.</p>
          } @else {
            Loading…
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      .section-label {
        font-size: 12px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase;
        color: var(--ink-soft); margin: 18px 0 10px;
      }
      .clickable { cursor: pointer; transition: transform 0.18s, box-shadow 0.18s; }
      .clickable:hover { transform: translateY(-3px); box-shadow: 0 4px 8px rgba(20, 28, 58, 0.08), 0 14px 34px rgba(20, 28, 58, 0.12); }
      .more { display: inline-flex; align-items: center; opacity: 0; transition: opacity 0.18s; font-weight: 600; margin-left: 6px; }
      .more mat-icon { font-size: 14px; width: 14px; height: 14px; }
      .clickable:hover .more { opacity: 1; }

      .hero { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
      .hero-card .label { display: flex; align-items: center; gap: 6px; color: var(--ink-soft); font-size: 13px; font-weight: 600; }
      .hero-card .label mat-icon { font-size: 17px; width: 17px; height: 17px; }
      .hero-card .value { font-size: 28px; font-weight: 800; margin: 8px 0 4px; font-variant-numeric: tabular-nums; }
      .hero-card .foot { color: var(--ink-soft); font-size: 12px; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
      .hero-card.inhand { background: linear-gradient(135deg, #3949ab, #1e88e5); color: #fff; }
      .hero-card.inhand .label, .hero-card.inhand .foot { color: rgba(255, 255, 255, 0.88); }
      .hero-card.runway { background: linear-gradient(135deg, #00897b, #26a69a); color: #fff; }
      .hero-card.runway .label, .hero-card.runway .foot { color: rgba(255, 255, 255, 0.9); }
      .hero-card.runway .per { font-size: 14px; font-weight: 600; opacity: 0.85; margin-left: 2px; }
      .burn-nums .warn { font-size: 15px; width: 15px; height: 15px; vertical-align: -3px; color: var(--bad); margin-right: 2px; }

      .accounts { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
      .acc-card { padding: 14px 16px; }
      .acc-head { display: flex; align-items: center; gap: 10px; color: var(--ink); font-size: 13px; font-weight: 700; }
      .acc-icon {
        width: 30px; height: 30px; border-radius: 9px; background: var(--primary-soft);
        display: grid; place-items: center; color: var(--primary);
      }
      .acc-icon mat-icon { font-size: 17px; width: 17px; height: 17px; }
      .acc-balance { font-size: 20px; font-weight: 700; margin-top: 8px; font-variant-numeric: tabular-nums; }
      .acc-open { font-size: 11px; margin-top: 2px; color: var(--ink-soft); }

      .charts-row { display: grid; grid-template-columns: 3fr 2fr; gap: 16px; margin-bottom: 16px; }
      @media (max-width: 1000px) { .charts-row { grid-template-columns: 1fr; } }
      .chart-card h3 { margin: 0 0 14px; font-size: 15px; font-weight: 700; }
      .chart-card h3.mt { margin-top: 20px; }
      .chart-card canvas { max-height: 260px; }
      .donut canvas { max-height: 240px; }
      .card-head-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
      .card-head-row h3 { margin: 0; }
      .delta { font-size: 12px; font-weight: 700; margin-left: 8px; }
      .delta.pos { color: var(--good); }
      .delta.neg { color: var(--bad); }

      .burn-row { display: grid; grid-template-columns: 130px 1fr auto; gap: 12px; align-items: center; padding: 7px 0; }
      .burn-name { font-size: 13px; font-weight: 600; }
      .burn-bar { height: 8px; background: #eef0f7; border-radius: 99px; overflow: hidden; }
      .burn-fill { height: 100%; background: linear-gradient(90deg, #43a047, #9ccc65); border-radius: 99px; transition: width 0.4s ease; }
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
  private dialog = inject(MatDialog);
  readonly state = inject(PeriodStateService);

  readonly summary = signal<PeriodSummary | null>(null);
  readonly trends = signal<PeriodTrends | null>(null);
  private readonly categoryNames = signal<Record<string, string>>({});

  readonly barOptions: ChartConfiguration<'bar'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items) => this.dayTitle(items[0]?.dataIndex ?? 0),
          label: (ctx) => '৳' + formatTaka((ctx.raw as number) * 100),
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { autoSkip: true, maxTicksLimit: 12, maxRotation: 0 } },
      y: { ticks: { callback: (v) => '৳' + formatTaka((v as number) * 100) } },
    },
  };

  /** Full "Mon 25 May" date for the bar the user hovers. */
  private dayTitle(i: number): string {
    const d = this.summary()?.dailySeries?.[i];
    if (!d) return '';
    const [y, m, day] = d.date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
    });
  }

  readonly donutOptions: ChartConfiguration<'doughnut'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'right', labels: { boxWidth: 12, font: { size: 12 } } },
      tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ৳${formatTaka((ctx.raw as number) * 100)}` } },
    },
    cutout: '62%',
  };

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
        this.trends.set(null);
        return;
      }
      this.api.periodSummary(p.id).subscribe((s) => this.summary.set(s));
      this.api.periodTrends(p.id).subscribe((t) => this.trends.set(t));
    }, { allowSignalWrites: true });
  }

  readonly liquidAccounts = computed(() =>
    (this.summary()?.accounts ?? []).filter((a) => ['cash', 'bank', 'mobile'].includes(a.account.kind)),
  );

  /** Forward-looking daily allowance: remaining (budget if set, else cash) ÷ days left. */
  readonly runway = computed(() => {
    const s = this.summary();
    if (!s) return null;
    const days = daysLeftInclusive(new Date(s.period.startDate), new Date(s.period.endDate), new Date());
    const hasBudget = s.budget.totals.budget > 0;
    const remaining = hasBudget ? s.budget.totals.remaining : s.inHand;
    return { days, perDay: safeToSpendPerDay(remaining, days), basis: hasBudget ? 'budget' : 'cash', remaining };
  });

  readonly savingsTotal = computed(() => (this.summary()?.savings ?? []).reduce((t, s) => t + s.current, 0));
  readonly budgetCats = computed(() => this.summary()?.budget.categories ?? []);

  readonly dailyChart = computed<ChartConfiguration<'bar'>['data']>(() => {
    const days = this.summary()?.dailySeries ?? [];
    return {
      labels: days.map((d) => String(Number(d.date.slice(8)))),
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

  // Shared options for the grouped/overlay trend charts (legend visible, taka axis).
  readonly trendOptions: ChartConfiguration<'bar'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: true, position: 'top', labels: { boxWidth: 12, font: { size: 12 } } },
      tooltip: {
        callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ৳${formatTaka((ctx.raw as number) * 100)}` },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { autoSkip: true, maxRotation: 0 } },
      y: { ticks: { callback: (v) => '৳' + formatTaka((v as number) * 100) } },
    },
  };

  readonly comparisonChart = computed<ChartConfiguration<'bar'>['data']>(() => {
    const cmp = (this.trends()?.comparison ?? []).slice(0, 8);
    const prevName = this.trends()?.previousPeriodName || 'Previous';
    return {
      labels: cmp.map((c) => c.name),
      datasets: [
        { label: 'This period', data: cmp.map((c) => c.current / 100), backgroundColor: '#3949ab', borderRadius: 4 },
        { label: prevName, data: cmp.map((c) => c.previous / 100), backgroundColor: '#b0bec5', borderRadius: 4 },
      ],
    };
  });

  readonly yearChart = computed<ChartConfiguration<'bar'>['data']>(() => {
    const series = this.trends()?.series ?? [];
    return {
      labels: series.map((p) => p.periodName),
      datasets: [
        {
          label: 'Spent',
          data: series.map((p) => p.totalSpend / 100),
          backgroundColor: '#5c6bc0',
          borderRadius: 4,
          order: 2,
        },
        // overlaid savings line — typed loosely as Chart.js mixes bar+line per dataset
        {
          label: 'Savings',
          type: 'line',
          data: series.map((p) => p.totalSaved / 100),
          borderColor: '#00897b',
          backgroundColor: 'transparent',
          tension: 0.3,
          pointRadius: 3,
          order: 1,
        } as any,
      ],
    };
  });

  /** Total-spend change vs the previous period; up = spent more (bad). */
  readonly spendDelta = computed(() => {
    const s = this.trends()?.series ?? [];
    if (s.length < 2) return null;
    const cur = s[s.length - 1].totalSpend;
    const prev = s[s.length - 2].totalSpend;
    if (prev === 0) return null;
    const pct = ((cur - prev) / prev) * 100;
    const arrow = pct > 0 ? '↑' : pct < 0 ? '↓' : '';
    return { pct, label: `${arrow} ${Math.abs(Math.round(pct))}%` };
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

  private open(data: DetailDialogData): void {
    this.dialog.open(DetailDialogComponent, { data, autoFocus: false, panelClass: 'app-dialog' });
  }

  openInHand(): void {
    const s = this.summary();
    if (!s) return;
    this.open({
      title: 'In hand — account balances',
      icon: 'account_balance_wallet',
      subtitle: `${s.period.name} · opening vs current`,
      rows: this.liquidAccounts().map((a) => ({
        icon: this.accIcon(a.account.kind),
        label: a.account.name,
        sub: `opened at ৳${formatTaka(a.opening)}`,
        amount: a.current,
        cls: a.current < 0 ? 'neg' : '',
      })),
      total: { label: 'Total in hand', amount: s.inHand },
    });
  }

  openSpent(): void {
    const s = this.summary();
    if (!s) return;
    const cats = [...(s.categoryTotals ?? [])].sort((a, b) => b.total - a.total);
    this.open({
      title: 'Spending by category',
      icon: 'shopping_cart',
      subtitle: `${s.period.name} · budget ৳${formatTaka(s.budget.totals.budget)} · cash ৳${formatTaka(
        s.budget.totals.cashActual,
      )} / non-cash ৳${formatTaka(s.budget.totals.nonCashActual)}`,
      rows: cats.map((c) => ({ icon: 'label', label: c.name, amount: c.total })),
      total: { label: 'Total spent', amount: s.budget.totals.actual },
      emptyHint: 'No expenses recorded yet',
    });
  }

  openSavings(): void {
    const s = this.summary();
    if (!s) return;
    this.open({
      title: 'Savings accounts',
      icon: 'savings',
      subtitle: `${s.period.name} · current balance with this period's change`,
      rows: (s.savings ?? []).map((a) => ({
        icon: 'account_balance',
        label: a.account.name,
        sub: `${a.current - a.opening >= 0 ? '+' : ''}৳${formatTaka(a.current - a.opening)} this period`,
        amount: a.current,
        cls: a.current - a.opening > 0 ? 'pos' : '',
      })),
      total: { label: 'Total savings', amount: this.savingsTotal() },
      emptyHint: 'No savings accounts yet',
    });
  }

  openLends(): void {
    this.api.listLends({ status: 'open' }).subscribe((lends) => {
      const rows: DetailRow[] = lends.map((l) => ({
        icon: l.type === 'given' ? 'call_made' : 'call_received',
        label: l.person,
        sub: `${l.type === 'given' ? 'given' : 'taken'} ${l.date.slice(0, 10)}${l.settlements.length ? ` · ${l.settlements.length} settlement(s)` : ''}`,
        amount: l.amount - l.settlements.reduce((t, x) => t + x.amount, 0),
        cls: l.type === 'given' ? '' : 'neg',
      }));
      this.open({
        title: 'Open lends',
        icon: 'handshake',
        subtitle: 'outstanding amounts per person',
        rows,
        emptyHint: 'No open lends',
      });
    });
  }

  openAccount(a: AccountStatus): void {
    const s = this.summary();
    const p = this.state.selected();
    if (!s || !p) return;
    forkJoin({
      expenses: this.api.listExpenses(p.id, { accountId: a.account.id }),
      transfers: this.api.listTransfers(p.id),
    }).subscribe(({ expenses, transfers }) => {
      const rows: DetailRow[] = [];
      for (const t of transfers) {
        if (t.fromAccountId === a.account.id) {
          rows.push({
            icon: 'call_made', label: `Transfer out${t.note ? ' · ' + t.note : ''}`,
            sub: t.date.slice(0, 10) + (t.fee ? ` · fee ৳${formatTaka(t.fee)}` : ''),
            amount: -(t.amount + t.fee), cls: 'neg',
          });
        } else if (t.toAccountId === a.account.id) {
          rows.push({
            icon: 'call_received', label: `Transfer in${t.note ? ' · ' + t.note : ''}`,
            sub: t.date.slice(0, 10), amount: t.amount, cls: 'pos',
          });
        }
      }
      for (const e of expenses) {
        rows.push({
          icon: 'shopping_cart',
          label: `${this.catName(e.categoryId)} · ${e.subcategory}`,
          sub: e.date.slice(0, 10) + (e.remarks ? ' · ' + e.remarks : ''),
          amount: -e.amount,
          cls: 'neg',
        });
      }
      rows.sort((x, y) => (y.sub ?? '').localeCompare(x.sub ?? ''));
      this.open({
        title: `${a.account.name} — activity`,
        icon: this.accIcon(a.account.kind),
        subtitle: `opening ৳${formatTaka(a.opening)} → current ৳${formatTaka(a.current)}`,
        rows,
        emptyHint: 'No activity this period',
      });
    });
  }
}
