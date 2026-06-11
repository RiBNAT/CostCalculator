import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { ApiService } from '../../core/api.service';
import { PeriodStateService } from '../../core/period-state.service';
import { Account, Category, Expense } from '../../core/models';
import { MoneyPipe } from '../../core/money.pipe';
import { parseAmountExpr } from '../../core/amount-expr';

@Component({
  selector: 'app-expenses',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatIconModule, MatMenuModule, MatSnackBarModule, MoneyPipe,
  ],
  template: `
    <div class="page">
      <h1 class="page-title">Expenses</h1>
      <p class="page-subtitle">{{ state.selected()?.name ?? 'Select a period' }} · {{ expenses().length }} entries · total {{ total() | money }}</p>

      <!-- quick add -->
      <div class="card quick-add">
        <form [formGroup]="form" (ngSubmit)="save()">
          <mat-form-field appearance="outline" class="w-date">
            <mat-label>Date</mat-label>
            <input matInput type="date" formControlName="date" />
          </mat-form-field>

          <mat-form-field appearance="outline" class="w-cat">
            <mat-label>Category</mat-label>
            <mat-select formControlName="categoryId">
              @for (c of activeCategories(); track c.id) {
                <mat-option [value]="c.id">{{ c.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline" class="w-cat">
            <mat-label>Subcategory</mat-label>
            <mat-select formControlName="subcategory">
              @for (s of subcategories(); track s.name) {
                <mat-option [value]="s.name">{{ s.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline" class="w-acc">
            <mat-label>Paid via</mat-label>
            <mat-select formControlName="accountId">
              @for (a of paymentAccounts(); track a.id) {
                <mat-option [value]="a.id">{{ a.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline" class="w-amount">
            <mat-label>Amount (e.g. 360+20+330)</mat-label>
            <input matInput formControlName="amountExpr" placeholder="0" />
            @if (parsedTotal() !== null) {
              <mat-hint>= {{ parsedTotal()! | money }}</mat-hint>
            } @else if (form.value.amountExpr) {
              <mat-hint class="neg">invalid expression</mat-hint>
            }
          </mat-form-field>

          <mat-form-field appearance="outline" class="w-remarks">
            <mat-label>Remarks</mat-label>
            <input matInput formControlName="remarks" />
          </mat-form-field>

          <button mat-flat-button color="primary" type="submit" [disabled]="form.invalid || parsedTotal() === null">
            <mat-icon>{{ editingId() ? 'save' : 'add' }}</mat-icon>
            {{ editingId() ? 'Update' : 'Add' }}
          </button>
          @if (editingId()) {
            <button mat-button type="button" (click)="cancelEdit()">Cancel</button>
          }
        </form>
      </div>

      <!-- filters -->
      <div class="filters">
        <mat-form-field appearance="outline" class="w-cat">
          <mat-label>Filter category</mat-label>
          <mat-select [value]="filterCategory()" (selectionChange)="filterCategory.set($event.value)">
            <mat-option [value]="''">All</mat-option>
            @for (c of categories(); track c.id) {
              <mat-option [value]="c.id">{{ c.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" class="w-acc">
          <mat-label>Filter account</mat-label>
          <mat-select [value]="filterAccount()" (selectionChange)="filterAccount.set($event.value)">
            <mat-option [value]="''">All</mat-option>
            @for (a of accounts(); track a.id) {
              <mat-option [value]="a.id">{{ a.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" class="w-search">
          <mat-label>Search remarks</mat-label>
          <input matInput [value]="filterText()" (input)="filterText.set($any($event.target).value)" />
          <mat-icon matSuffix>search</mat-icon>
        </mat-form-field>
        <span class="spacer"></span>
        <a mat-stroked-button [href]="exportUrl()" target="_blank" [class.disabled]="!state.selected()">
          <mat-icon>download</mat-icon> Export CSV
        </a>
      </div>

      <!-- table -->
      <div class="card table-card">
        <table class="data">
          <thead>
            <tr>
              <th>Date</th><th>Category</th><th>Subcategory</th><th>Paid via</th>
              <th class="num">Amount</th><th>Remarks</th><th></th>
            </tr>
          </thead>
          <tbody>
            @for (e of filtered(); track e.id) {
              <tr>
                <td>{{ e.date | date: 'd MMM, EEE' }}</td>
                <td>{{ catName(e.categoryId) }}</td>
                <td>{{ e.subcategory }}</td>
                <td>{{ accName(e.accountId) }}</td>
                <td class="num" [title]="breakdownTitle(e)">{{ e.amount | money }}</td>
                <td class="remarks">{{ e.remarks }}</td>
                <td class="actions">
                  <button mat-icon-button [matMenuTriggerFor]="rowMenu" [disabled]="closed()">
                    <mat-icon>more_vert</mat-icon>
                  </button>
                  <mat-menu #rowMenu="matMenu">
                    <button mat-menu-item (click)="edit(e)"><mat-icon>edit</mat-icon>Edit</button>
                    <button mat-menu-item (click)="remove(e)"><mat-icon>delete</mat-icon>Delete</button>
                  </mat-menu>
                </td>
              </tr>
            } @empty {
              <tr><td colspan="7" class="empty-hint">No expenses match</td></tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: [
    `
      .quick-add form { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
      .quick-add button { height: 48px; margin-bottom: 18px; }
      .w-date { width: 150px; }
      .w-cat { width: 190px; }
      .w-acc { width: 140px; }
      .w-amount { width: 200px; }
      .w-remarks { flex: 1; min-width: 160px; }
      .w-search { width: 220px; }
      .filters { display: flex; gap: 10px; align-items: center; margin: 16px 0 12px; }
      .filters .spacer { flex: 1; }
      .table-card { padding: 4px 8px; }
      .remarks { color: var(--ink-soft); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .actions { width: 40px; }
      a.disabled { pointer-events: none; opacity: 0.5; }
    `,
  ],
})
export class ExpensesComponent {
  private api = inject(ApiService);
  private fb = inject(FormBuilder);
  private snack = inject(MatSnackBar);
  readonly state = inject(PeriodStateService);

  readonly categories = signal<Category[]>([]);
  readonly accounts = signal<Account[]>([]);
  readonly expenses = signal<Expense[]>([]);
  readonly editingId = signal<string | null>(null);

  readonly filterCategory = signal('');
  readonly filterAccount = signal('');
  readonly filterText = signal('');

  form = this.fb.nonNullable.group({
    date: [today(), Validators.required],
    categoryId: ['', Validators.required],
    subcategory: ['', Validators.required],
    accountId: ['', Validators.required],
    amountExpr: ['', Validators.required],
    remarks: [''],
  });

  private readonly amountExprValue = signal('');

  constructor() {
    this.api.listCategories().subscribe((c) => this.categories.set(c));
    this.api.listAccounts().subscribe((a) => this.accounts.set(a));
    effect(() => {
      const p = this.state.selected();
      if (p) this.reload(p.id);
      else this.expenses.set([]);
    });
    this.form.controls.amountExpr.valueChanges.subscribe((v) => this.amountExprValue.set(v));
    this.form.controls.categoryId.valueChanges.subscribe(() => this.form.patchValue({ subcategory: '' }));
  }

  reload(periodId: string): void {
    this.api.listExpenses(periodId).subscribe((e) => this.expenses.set(e));
  }

  readonly activeCategories = computed(() => this.categories().filter((c) => c.active));
  readonly paymentAccounts = computed(() =>
    this.accounts().filter((a) => a.active && ['cash', 'bank', 'mobile'].includes(a.kind)),
  );
  readonly subcategories = computed(() => {
    const cat = this.categories().find((c) => c.id === this.form.value.categoryId);
    return (cat?.subcategories ?? []).filter((s) => s.active);
  });

  readonly parsedTotal = computed(() => parseAmountExpr(this.amountExprValue())?.total ?? null);

  readonly filtered = computed(() =>
    this.expenses().filter(
      (e) =>
        (!this.filterCategory() || e.categoryId === this.filterCategory()) &&
        (!this.filterAccount() || e.accountId === this.filterAccount()) &&
        (!this.filterText() || (e.remarks ?? '').toLowerCase().includes(this.filterText().toLowerCase())),
    ),
  );

  readonly total = computed(() => this.filtered().reduce((t, e) => t + e.amount, 0));
  readonly closed = computed(() => this.state.selected()?.status === 'closed');

  catName(id: string): string {
    return this.categories().find((c) => c.id === id)?.name ?? '—';
  }
  accName(id: string): string {
    return this.accounts().find((a) => a.id === id)?.name ?? '—';
  }
  breakdownTitle(e: Expense): string {
    return (e.breakdown ?? []).map((p) => p / 100).join(' + ');
  }
  exportUrl(): string {
    const p = this.state.selected();
    return p ? this.api.exportUrl(p.id) : '#';
  }

  save(): void {
    const p = this.state.selected();
    if (!p || this.form.invalid) return;
    const body = this.form.getRawValue();
    const done = () => {
      this.snack.open(this.editingId() ? 'Expense updated' : 'Expense added', undefined, { duration: 2000 });
      this.cancelEdit();
      this.reload(p.id);
    };
    const fail = (e: any) => this.snack.open(e?.error?.error?.message ?? 'Failed', 'OK', { duration: 4000 });
    if (this.editingId()) {
      this.api.updateExpense(p.id, this.editingId()!, body).subscribe({ next: done, error: fail });
    } else {
      this.api.createExpense(p.id, body).subscribe({ next: done, error: fail });
    }
  }

  edit(e: Expense): void {
    this.editingId.set(e.id);
    this.form.patchValue({
      date: e.date.slice(0, 10),
      categoryId: e.categoryId,
      accountId: e.accountId,
      amountExpr: (e.breakdown?.length ? e.breakdown.map((p) => p / 100).join('+') : String(e.amount / 100)),
      remarks: e.remarks ?? '',
    });
    // set subcategory after categoryId reset hook fires
    setTimeout(() => this.form.patchValue({ subcategory: e.subcategory }));
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.form.reset({ date: today(), categoryId: '', subcategory: '', accountId: '', amountExpr: '', remarks: '' });
  }

  remove(e: Expense): void {
    const p = this.state.selected();
    if (!p) return;
    this.api.deleteExpense(p.id, e.id).subscribe(() => this.reload(p.id));
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
