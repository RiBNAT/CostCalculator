import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';

import { ApiService } from '../../core/api.service';
import { Account, Category, Expense } from '../../core/models';
import { MoneyPipe } from '../../core/money.pipe';
import { parseAmountExpr } from '../../core/amount-expr';

export interface ExpenseDialogData {
  periodId: string;
  categories: Category[];
  accounts: Account[];
  expense?: Expense; // present when editing
}

@Component({
  selector: 'app-expense-dialog',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatIconModule, MoneyPipe,
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>{{ data.expense ? 'edit' : 'add_circle' }}</mat-icon>
      {{ data.expense ? 'Edit expense' : 'New expense' }}
    </h2>
    <mat-dialog-content>
      <form [formGroup]="form" id="expense-form" (ngSubmit)="save()">
        <div class="grid">
          <mat-form-field appearance="outline">
            <mat-label>Date</mat-label>
            <input matInput type="date" formControlName="date" />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Paid via</mat-label>
            <mat-select formControlName="accountId">
              @for (a of paymentAccounts; track a.id) {
                <mat-option [value]="a.id">{{ a.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Category</mat-label>
            <mat-select formControlName="categoryId">
              @for (c of activeCategories; track c.id) {
                <mat-option [value]="c.id">{{ c.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Subcategory</mat-label>
            <mat-select formControlName="subcategory" [disabled]="!subcategories().length">
              @for (s of subcategories(); track s.name) {
                <mat-option [value]="s.name">{{ s.name }}</mat-option>
              }
            </mat-select>
            @if (!form.value.categoryId) {
              <mat-hint>pick a category first</mat-hint>
            }
          </mat-form-field>

          <mat-form-field appearance="outline" class="span2">
            <mat-label>Amount — supports sums like 360+20+330</mat-label>
            <input matInput formControlName="amountExpr" placeholder="0" autocomplete="off" />
            @if (parsedTotal() !== null) {
              <span matSuffix class="parsed">= {{ parsedTotal()! | money }}</span>
            } @else if (form.value.amountExpr) {
              <span matSuffix class="parsed neg">invalid</span>
            }
          </mat-form-field>

          <mat-form-field appearance="outline" class="span2">
            <mat-label>Remarks</mat-label>
            <input matInput formControlName="remarks" placeholder="optional note" />
          </mat-form-field>
        </div>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button color="primary" form="expense-form" type="submit"
              [disabled]="form.invalid || parsedTotal() === null || busy()">
        {{ busy() ? 'Saving…' : data.expense ? 'Save changes' : 'Add expense' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      h2 { display: flex; align-items: center; gap: 10px; font-weight: 700; }
      h2 mat-icon { color: var(--primary); }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 14px; min-width: 440px; padding-top: 6px; }
      @media (max-width: 600px) { .grid { grid-template-columns: 1fr; min-width: 0; } }
      .span2 { grid-column: span 2; }
      @media (max-width: 600px) { .span2 { grid-column: span 1; } }
      .parsed { font-size: 13px; font-weight: 600; color: var(--good); margin-right: 10px; }
      .parsed.neg { color: var(--bad); }
    `,
  ],
})
export class ExpenseDialogComponent {
  readonly data = inject<ExpenseDialogData>(MAT_DIALOG_DATA);
  private ref = inject(MatDialogRef<ExpenseDialogComponent>);
  private api = inject(ApiService);
  private fb = inject(FormBuilder);
  private snack = inject(MatSnackBar);

  readonly busy = signal(false);

  readonly activeCategories = this.data.categories.filter((c) => c.active);
  readonly paymentAccounts = this.data.accounts.filter(
    (a) => a.active && ['cash', 'bank', 'mobile'].includes(a.kind),
  );

  form = this.fb.nonNullable.group({
    date: [this.data.expense?.date.slice(0, 10) ?? today(), Validators.required],
    categoryId: [this.data.expense?.categoryId ?? '', Validators.required],
    subcategory: [this.data.expense?.subcategory ?? '', Validators.required],
    accountId: [this.data.expense?.accountId ?? '', Validators.required],
    amountExpr: [initialExpr(this.data.expense), Validators.required],
    remarks: [this.data.expense?.remarks ?? ''],
  });

  // form values mirrored into signals so computed() reacts to them
  private readonly categoryId = signal(this.form.controls.categoryId.value);
  private readonly amountExpr = signal(this.form.controls.amountExpr.value);

  constructor() {
    this.form.controls.categoryId.valueChanges.subscribe((id) => {
      this.categoryId.set(id);
      this.form.controls.subcategory.setValue('');
    });
    this.form.controls.amountExpr.valueChanges.subscribe((v) => this.amountExpr.set(v));
  }

  readonly subcategories = computed(() => {
    const cat = this.data.categories.find((c) => c.id === this.categoryId());
    return (cat?.subcategories ?? []).filter((s) => s.active);
  });

  readonly parsedTotal = computed(() => parseAmountExpr(this.amountExpr())?.total ?? null);

  save(): void {
    if (this.form.invalid) return;
    this.busy.set(true);
    const body = this.form.getRawValue();
    const req = this.data.expense
      ? this.api.updateExpense(this.data.periodId, this.data.expense.id, body)
      : this.api.createExpense(this.data.periodId, body);
    req.subscribe({
      next: () => this.ref.close(true),
      error: (e) => {
        this.busy.set(false);
        this.snack.open(e?.error?.error?.message ?? 'Save failed', 'OK', { duration: 4000 });
      },
    });
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function initialExpr(e?: Expense): string {
  if (!e) return '';
  return e.breakdown?.length ? e.breakdown.map((p) => p / 100).join('+') : String(e.amount / 100);
}
