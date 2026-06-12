import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { ApiService } from '../../core/api.service';
import { PeriodStateService } from '../../core/period-state.service';
import { Account, Category, Expense } from '../../core/models';
import { MoneyPipe } from '../../core/money.pipe';
import { categoryColor } from '../../core/cat-color';
import { saveBlob } from '../../core/save-blob';
import { ExpenseDialogComponent, ExpenseDialogData } from './expense-dialog.component';

@Component({
  selector: 'app-expenses',
  standalone: true,
  imports: [
    CommonModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatIconModule,
    MatMenuModule, MatDialogModule, MatPaginatorModule, MatTooltipModule, MatSnackBarModule, MoneyPipe,
  ],
  template: `
    <div class="page">
      <div class="head-row">
        <div>
          <h1 class="page-title">Expenses</h1>
          <p class="page-subtitle">
            {{ state.selected()?.name ?? 'Select a period' }} · {{ filtered().length }} entries · total
            <strong>{{ total() | money }}</strong>
          </p>
        </div>
        <div class="head-actions">
          <button mat-stroked-button (click)="exportCsv()" [disabled]="!state.selected()">
            <mat-icon>download</mat-icon> Export CSV
          </button>
          <button mat-flat-button color="primary" class="add-btn" (click)="openDialog()" [disabled]="closed() || !state.selected()">
            <mat-icon>add</mat-icon> Add expense
          </button>
        </div>
      </div>

      @if (closed()) {
        <div class="closed-banner">
          <mat-icon>lock</mat-icon> This period is closed — reopen it in Settings to make changes.
        </div>
      }

      <!-- filters -->
      <div class="card filter-card">
        <mat-icon class="filter-icon">filter_list</mat-icon>
        <mat-form-field appearance="outline" class="w-cat" subscriptSizing="dynamic">
          <mat-label>Category</mat-label>
          <mat-select [value]="filterCategory()" (selectionChange)="filterCategory.set($event.value); page.set(0)">
            <mat-option [value]="''">All categories</mat-option>
            @for (c of categories(); track c.id) {
              <mat-option [value]="c.id">{{ c.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" class="w-acc" subscriptSizing="dynamic">
          <mat-label>Account</mat-label>
          <mat-select [value]="filterAccount()" (selectionChange)="filterAccount.set($event.value); page.set(0)">
            <mat-option [value]="''">All accounts</mat-option>
            @for (a of accounts(); track a.id) {
              <mat-option [value]="a.id">{{ a.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" class="w-search" subscriptSizing="dynamic">
          <mat-label>Search remarks</mat-label>
          <input matInput [value]="filterText()" (input)="filterText.set($any($event.target).value); page.set(0)" />
          <mat-icon matSuffix>search</mat-icon>
        </mat-form-field>
        @if (filterCategory() || filterAccount() || filterText()) {
          <button mat-button (click)="clearFilters()"><mat-icon>clear</mat-icon> Clear</button>
        }
      </div>

      <!-- table -->
      <div class="card table-card">
        <table class="data modern">
          <thead>
            <tr>
              <th>Date</th><th>Category</th><th>Paid via</th>
              <th class="num">Amount</th><th>Remarks</th><th class="actions-h"></th>
            </tr>
          </thead>
          <tbody>
            @for (e of paged(); track e.id) {
              <tr (dblclick)="openDialog(e)">
                <td class="date-cell">
                  <span class="day">{{ e.date | date: 'd' }}</span>
                  <span class="month">{{ e.date | date: 'MMM, EEE' }}</span>
                </td>
                <td>
                  <span class="cat-chip" [style.background]="catColor(e.categoryId).bg" [style.color]="catColor(e.categoryId).fg">
                    {{ catName(e.categoryId) }}
                  </span>
                  <span class="sub">{{ e.subcategory }}</span>
                </td>
                <td>
                  <span class="acc"><mat-icon class="mini">{{ accIcon(e.accountId) }}</mat-icon>{{ accName(e.accountId) }}</span>
                </td>
                <td class="num amount" [matTooltip]="breakdownTitle(e)">{{ e.amount | money }}</td>
                <td class="remarks">{{ e.remarks }}</td>
                <td class="actions">
                  <button mat-icon-button [matMenuTriggerFor]="rowMenu" [disabled]="closed()" aria-label="row actions">
                    <mat-icon>more_vert</mat-icon>
                  </button>
                  <mat-menu #rowMenu="matMenu">
                    <button mat-menu-item (click)="openDialog(e)"><mat-icon>edit</mat-icon>Edit</button>
                    <button mat-menu-item (click)="remove(e)"><mat-icon>delete</mat-icon>Delete</button>
                  </mat-menu>
                </td>
              </tr>
            } @empty {
              <tr><td colspan="6" class="empty-hint">No expenses match — add one with the button above</td></tr>
            }
          </tbody>
        </table>
        <mat-paginator
          [length]="filtered().length"
          [pageIndex]="page()"
          [pageSize]="pageSize()"
          [pageSizeOptions]="[10, 25, 50, 100]"
          (page)="onPage($event)"
          showFirstLastButtons
        />
      </div>
    </div>
  `,
  styles: [
    `
      .head-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
      .head-actions { display: flex; gap: 10px; align-items: center; }
      .add-btn { height: 42px; font-weight: 600; }
      .closed-banner {
        display: flex; align-items: center; gap: 8px;
        background: #fff8e8; color: #8a6d00;
        border-radius: var(--radius); padding: 10px 16px; margin-bottom: 14px;
        font-size: 13px; font-weight: 600;
      }
      .filter-card { display: flex; gap: 12px; align-items: center; padding: 12px 16px; margin-bottom: 14px; flex-wrap: wrap; }
      .filter-icon { color: var(--ink-soft); }
      .w-cat { width: 200px; }
      .w-acc { width: 170px; }
      .w-search { flex: 1; min-width: 180px; }
      .table-card { padding: 4px 8px 0; }
      table.modern td { padding: 12px; }
      .date-cell { white-space: nowrap; }
      .date-cell .day { font-size: 17px; font-weight: 700; margin-right: 6px; }
      .date-cell .month { color: var(--ink-soft); font-size: 12px; }
      .cat-chip {
        display: inline-block; border-radius: 8px; padding: 3px 10px;
        font-size: 12px; font-weight: 700; margin-right: 8px;
      }
      .sub { color: var(--ink-soft); font-size: 13px; }
      .acc { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; }
      .mini { font-size: 16px; width: 16px; height: 16px; color: var(--ink-soft); }
      .amount { font-weight: 700; font-size: 14px; }
      .remarks { color: var(--ink-soft); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .actions { width: 40px; }
      .actions-h { width: 40px; }
      a.disabled { pointer-events: none; opacity: 0.5; }
      tbody tr { transition: background 0.12s; cursor: default; }
    `,
  ],
})
export class ExpensesComponent {
  private api = inject(ApiService);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);
  readonly state = inject(PeriodStateService);

  readonly categories = signal<Category[]>([]);
  readonly accounts = signal<Account[]>([]);
  readonly expenses = signal<Expense[]>([]);

  readonly filterCategory = signal('');
  readonly filterAccount = signal('');
  readonly filterText = signal('');
  readonly page = signal(0);
  readonly pageSize = signal(25);

  constructor() {
    this.api.listCategories().subscribe((c) => this.categories.set(c));
    this.api.listAccounts().subscribe((a) => this.accounts.set(a));
    effect(() => {
      const p = this.state.selected();
      if (p) this.reload(p.id);
      else this.expenses.set([]);
    }, { allowSignalWrites: true });
  }

  reload(periodId: string): void {
    this.api.listExpenses(periodId).subscribe((e) => this.expenses.set(e));
  }

  readonly filtered = computed(() =>
    this.expenses().filter(
      (e) =>
        (!this.filterCategory() || e.categoryId === this.filterCategory()) &&
        (!this.filterAccount() || e.accountId === this.filterAccount()) &&
        (!this.filterText() || (e.remarks ?? '').toLowerCase().includes(this.filterText().toLowerCase())),
    ),
  );

  readonly paged = computed(() => {
    const start = this.page() * this.pageSize();
    return this.filtered().slice(start, start + this.pageSize());
  });

  readonly total = computed(() => this.filtered().reduce((t, e) => t + e.amount, 0));
  readonly closed = computed(() => this.state.selected()?.status === 'closed');

  onPage(ev: PageEvent): void {
    this.page.set(ev.pageIndex);
    this.pageSize.set(ev.pageSize);
  }

  clearFilters(): void {
    this.filterCategory.set('');
    this.filterAccount.set('');
    this.filterText.set('');
    this.page.set(0);
  }

  catName(id: string): string {
    return this.categories().find((c) => c.id === id)?.name ?? '—';
  }
  catColor(id: string): { bg: string; fg: string } {
    return categoryColor(this.catName(id));
  }
  accName(id: string): string {
    return this.accounts().find((a) => a.id === id)?.name ?? '—';
  }
  accIcon(id: string): string {
    const kind = this.accounts().find((a) => a.id === id)?.kind ?? '';
    const icons: Record<string, string> = { cash: 'payments', bank: 'account_balance', mobile: 'smartphone' };
    return icons[kind] ?? 'wallet';
  }
  breakdownTitle(e: Expense): string {
    return (e.breakdown ?? []).length > 1 ? (e.breakdown ?? []).map((p) => p / 100).join(' + ') : '';
  }
  exportCsv(): void {
    const p = this.state.selected();
    if (!p) return;
    this.api.exportCsv(p.id).subscribe({
      next: (blob) => saveBlob(blob, `${p.name}.csv`),
      error: () => this.snack.open('Export failed', 'OK', { duration: 4000 }),
    });
  }

  openDialog(expense?: Expense): void {
    const p = this.state.selected();
    if (!p || this.closed()) return;
    const data: ExpenseDialogData = {
      periodId: p.id,
      categories: this.categories(),
      accounts: this.accounts(),
      expense,
    };
    this.dialog
      .open(ExpenseDialogComponent, { data, autoFocus: false, panelClass: 'app-dialog' })
      .afterClosed()
      .subscribe((saved) => {
        if (saved) {
          this.snack.open(expense ? 'Expense updated' : 'Expense added', undefined, { duration: 2000 });
          this.reload(p.id);
        }
      });
  }

  remove(e: Expense): void {
    const p = this.state.selected();
    if (!p) return;
    this.api.deleteExpense(p.id, e.id).subscribe(() => this.reload(p.id));
  }
}
