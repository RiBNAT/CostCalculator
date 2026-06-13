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
import { Account, Transfer } from '../../core/models';
import { MoneyPipe } from '../../core/money.pipe';
import { parseAmountExpr } from '../../core/amount-expr';
import { ConfirmService } from '../../core/confirm-dialog.component';
import { dayOf, defaultEntryDate, inPeriodValidator } from '../../core/dates';

@Component({
  selector: 'app-transfers',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatIconModule, MatMenuModule, MatSnackBarModule, MoneyPipe,
  ],
  template: `
    <div class="page">
      <h1 class="page-title">Transfers</h1>
      <p class="page-subtitle">
        Move money between accounts — withdrawals, top-ups, income (Add), lend in/out
      </p>

      <div class="card quick-add">
        <form [formGroup]="form" (ngSubmit)="save()">
          <mat-form-field appearance="outline" class="w-date">
            <mat-label>Date</mat-label>
            <input matInput type="date" formControlName="date" [min]="minDate()" [max]="maxDate()" />
            @if (form.controls.date.hasError('outsidePeriod')) {
              <mat-error>outside this period</mat-error>
            }
          </mat-form-field>

          <mat-form-field appearance="outline" class="w-acc">
            <mat-label>From</mat-label>
            <mat-select formControlName="fromAccountId">
              @for (a of activeAccounts(); track a.id) {
                <mat-option [value]="a.id">{{ a.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-icon class="arrow">arrow_forward</mat-icon>

          <mat-form-field appearance="outline" class="w-acc">
            <mat-label>To</mat-label>
            <mat-select formControlName="toAccountId">
              @for (a of activeAccounts(); track a.id) {
                <mat-option [value]="a.id" [disabled]="a.id === form.value.fromAccountId">{{ a.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline" class="w-amount">
            <mat-label>Amount</mat-label>
            <input matInput formControlName="amountExpr" placeholder="0" />
            @if (parsedAmount() !== null) {
              <mat-hint>= {{ parsedAmount()! | money }}</mat-hint>
            }
          </mat-form-field>

          <mat-form-field appearance="outline" class="w-fee">
            <mat-label>Fee</mat-label>
            <input matInput formControlName="feeExpr" placeholder="0" />
          </mat-form-field>

          <mat-form-field appearance="outline" class="w-remarks">
            <mat-label>Note</mat-label>
            <input matInput formControlName="note" />
          </mat-form-field>

          <button mat-flat-button color="primary" type="submit" [disabled]="form.invalid || parsedAmount() === null">
            <mat-icon>{{ editingId() ? 'save' : 'add' }}</mat-icon>
            {{ editingId() ? 'Update' : 'Add' }}
          </button>
          @if (editingId()) {
            <button mat-button type="button" (click)="cancelEdit()">Cancel</button>
          }
        </form>
      </div>

      <div class="card table-card">
        <table class="data">
          <thead>
            <tr>
              <th>Date</th><th>From</th><th></th><th>To</th>
              <th class="num">Amount</th><th class="num">Fee</th><th>Note</th><th></th>
            </tr>
          </thead>
          <tbody>
            @for (t of transfers(); track t.id) {
              <tr>
                <td>{{ t.date | date: 'd MMM, EEE' }}</td>
                <td><strong>{{ accName(t.fromAccountId) }}</strong></td>
                <td><mat-icon class="mini-arrow">east</mat-icon></td>
                <td><strong>{{ accName(t.toAccountId) }}</strong></td>
                <td class="num">{{ t.amount | money }}</td>
                <td class="num">{{ t.fee ? (t.fee | money) : '—' }}</td>
                <td class="remarks">{{ t.note }}</td>
                <td class="actions">
                  <button mat-icon-button [matMenuTriggerFor]="rowMenu" [disabled]="closed()" aria-label="transfer actions">
                    <mat-icon>more_vert</mat-icon>
                  </button>
                  <mat-menu #rowMenu="matMenu">
                    <button mat-menu-item (click)="edit(t)"><mat-icon>edit</mat-icon>Edit</button>
                    <button mat-menu-item (click)="remove(t)"><mat-icon>delete</mat-icon>Delete</button>
                  </mat-menu>
                </td>
              </tr>
            } @empty {
              <tr><td colspan="8" class="empty-hint">No transfers in this period</td></tr>
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
      .arrow { color: var(--ink-soft); margin-bottom: 18px; }
      .w-date { width: 150px; }
      .w-acc { width: 160px; }
      .w-amount { width: 160px; }
      .w-fee { width: 110px; }
      .w-remarks { flex: 1; min-width: 140px; }
      .table-card { margin-top: 16px; padding: 4px 8px; }
      .mini-arrow { font-size: 16px; width: 16px; height: 16px; color: var(--ink-soft); }
      .remarks { color: var(--ink-soft); }
      .actions { width: 40px; }
    `,
  ],
})
export class TransfersComponent {
  private api = inject(ApiService);
  private fb = inject(FormBuilder);
  private snack = inject(MatSnackBar);
  private confirmSvc = inject(ConfirmService);
  readonly state = inject(PeriodStateService);

  readonly accounts = signal<Account[]>([]);
  readonly transfers = signal<Transfer[]>([]);
  readonly editingId = signal<string | null>(null);

  readonly minDate = computed(() => dayOf(this.state.selected()?.startDate ?? ''));
  readonly maxDate = computed(() => dayOf(this.state.selected()?.endDate ?? ''));

  form = this.fb.nonNullable.group({
    date: ['', Validators.required],
    fromAccountId: ['', Validators.required],
    toAccountId: ['', Validators.required],
    amountExpr: ['', Validators.required],
    feeExpr: [''],
    note: [''],
  });

  private readonly amountValue = signal('');

  constructor() {
    this.api.listAccounts().subscribe((a) => this.accounts.set(a));
    effect(() => {
      const p = this.state.selected();
      if (p) this.reload(p.id);
      else this.transfers.set([]);
      // keep the date default and range validation in sync with the period
      this.form.controls.date.setValidators([Validators.required, inPeriodValidator(p)]);
      if (!this.editingId()) this.form.controls.date.setValue(defaultEntryDate(p));
      this.form.controls.date.updateValueAndValidity();
    }, { allowSignalWrites: true });
    this.form.controls.amountExpr.valueChanges.subscribe((v) => this.amountValue.set(v));
  }

  reload(periodId: string): void {
    this.api.listTransfers(periodId).subscribe((t) => this.transfers.set(t));
  }

  readonly activeAccounts = computed(() => this.accounts().filter((a) => a.active));
  readonly parsedAmount = computed(() => parseAmountExpr(this.amountValue())?.total ?? null);
  readonly closed = computed(() => this.state.selected()?.status === 'closed');

  accName(id: string): string {
    return this.accounts().find((a) => a.id === id)?.name ?? '—';
  }

  save(): void {
    const p = this.state.selected();
    if (!p || this.form.invalid) return;
    const body = this.form.getRawValue();
    const done = () => {
      this.snack.open(this.editingId() ? 'Transfer updated' : 'Transfer added', undefined, { duration: 2000 });
      this.cancelEdit();
      this.reload(p.id);
    };
    const fail = (e: any) => this.snack.open(e?.error?.error?.message ?? 'Failed', 'OK', { duration: 4000 });
    if (this.editingId()) {
      this.api.updateTransfer(p.id, this.editingId()!, body).subscribe({ next: done, error: fail });
    } else {
      this.api.createTransfer(p.id, body).subscribe({ next: done, error: fail });
    }
  }

  edit(t: Transfer): void {
    this.editingId.set(t.id);
    this.form.patchValue({
      date: t.date.slice(0, 10),
      fromAccountId: t.fromAccountId,
      toAccountId: t.toAccountId,
      amountExpr: String(t.amount / 100),
      feeExpr: t.fee ? String(t.fee / 100) : '',
      note: t.note ?? '',
    });
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.form.reset({
      date: defaultEntryDate(this.state.selected()),
      fromAccountId: '', toAccountId: '', amountExpr: '', feeExpr: '', note: '',
    });
  }

  remove(t: Transfer): void {
    const p = this.state.selected();
    if (!p) return;
    this.confirmSvc
      .confirm({
        title: 'Delete transfer?',
        message: `${this.accName(t.fromAccountId)} → ${this.accName(t.toAccountId)} — ৳${(t.amount / 100).toLocaleString('en-IN')} on ${t.date.slice(0, 10)}. This cannot be undone.`,
      })
      .subscribe((ok) => {
        if (!ok) return;
        this.api.deleteTransfer(p.id, t.id).subscribe(() => {
          this.snack.open('Transfer deleted', undefined, { duration: 2000 });
          this.reload(p.id);
        });
      });
  }
}
