import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { ApiService } from '../../core/api.service';
import { Lend } from '../../core/models';
import { MoneyPipe } from '../../core/money.pipe';
import { parseAmountExpr } from '../../core/amount-expr';

@Component({
  selector: 'app-lends',
  standalone: true,
  imports: [
    CommonModule, FormsModule, ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatIconModule, MatTabsModule, MatExpansionModule, MatSnackBarModule, MoneyPipe,
  ],
  template: `
    <div class="page">
      <h1 class="page-title">Lends</h1>
      <p class="page-subtitle">
        Given out {{ totalOutstanding('given') | money }} · owed to others {{ totalOutstanding('taken') | money }}
      </p>

      <div class="card quick-add">
        <form [formGroup]="form" (ngSubmit)="save()">
          <mat-form-field appearance="outline" class="w-type">
            <mat-label>Type</mat-label>
            <mat-select formControlName="type">
              <mat-option value="given">Given to</mat-option>
              <mat-option value="taken">Taken from</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline" class="w-person">
            <mat-label>Person</mat-label>
            <input matInput formControlName="person" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="w-date">
            <mat-label>Date</mat-label>
            <input matInput type="date" formControlName="date" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="w-amount">
            <mat-label>Amount</mat-label>
            <input matInput formControlName="amountExpr" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="w-notes">
            <mat-label>Notes</mat-label>
            <input matInput formControlName="notes" />
          </mat-form-field>
          <button mat-flat-button color="primary" [disabled]="form.invalid">
            <mat-icon>add</mat-icon> Record
          </button>
        </form>
      </div>

      <mat-tab-group class="tabs">
        @for (tab of [{ key: 'given', label: 'Given' }, { key: 'taken', label: 'Taken' }]; track tab.key) {
          <mat-tab [label]="tab.label">
            <div class="lend-list">
              @for (l of byType(tab.key); track l.id) {
                <mat-expansion-panel class="lend-panel">
                  <mat-expansion-panel-header>
                    <mat-panel-title>
                      <span class="person">{{ l.person }}</span>
                      <span class="chip" [class]="l.status">{{ l.status }}</span>
                    </mat-panel-title>
                    <mat-panel-description>
                      <span class="outstanding" [class.pos]="outstanding(l) <= 0">
                        {{ outstanding(l) | money }} outstanding
                      </span>
                      <span class="orig">of {{ l.amount | money }} · {{ l.date | date: 'd MMM yy' }}</span>
                    </mat-panel-description>
                  </mat-expansion-panel-header>

                  @if (l.notes) {
                    <p class="notes">{{ l.notes }}</p>
                  }
                  @if (l.settlements.length) {
                    <table class="data">
                      <thead><tr><th>Date</th><th class="num">Amount</th><th>Note</th></tr></thead>
                      <tbody>
                        @for (s of l.settlements; track $index) {
                          <tr>
                            <td>{{ s.date | date: 'd MMM yy' }}</td>
                            <td class="num">{{ s.amount | money }}</td>
                            <td>{{ s.note }}</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  }

                  @if (l.status === 'open') {
                    <form class="settle-form" (ngSubmit)="settle(l)">
                      <mat-form-field appearance="outline" class="w-date">
                        <mat-label>Date</mat-label>
                        <input matInput type="date" [(ngModel)]="settleDate" name="sdate" />
                      </mat-form-field>
                      <mat-form-field appearance="outline" class="w-amount">
                        <mat-label>Amount</mat-label>
                        <input matInput [(ngModel)]="settleAmount" name="samount" />
                      </mat-form-field>
                      <mat-form-field appearance="outline" class="w-notes">
                        <mat-label>Note</mat-label>
                        <input matInput [(ngModel)]="settleNote" name="snote" />
                      </mat-form-field>
                      <button mat-stroked-button color="primary" type="submit">Settle</button>
                    </form>
                  }
                  <div class="panel-actions">
                    <button mat-button color="warn" (click)="remove(l)"><mat-icon>delete</mat-icon> Delete</button>
                  </div>
                </mat-expansion-panel>
              } @empty {
                <div class="empty-hint">Nothing here</div>
              }
            </div>
          </mat-tab>
        }
      </mat-tab-group>
    </div>
  `,
  styles: [
    `
      .quick-add form { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
      .quick-add button { height: 48px; margin-bottom: 18px; }
      .w-type { width: 140px; }
      .w-person { width: 180px; }
      .w-date { width: 150px; }
      .w-amount { width: 140px; }
      .w-notes { flex: 1; min-width: 140px; }
      .tabs { margin-top: 16px; }
      .lend-list { padding: 16px 0; display: flex; flex-direction: column; gap: 10px; }
      .lend-panel { border-radius: var(--radius) !important; box-shadow: var(--shadow) !important; }
      .person { font-weight: 700; margin-right: 10px; }
      .outstanding { font-weight: 700; color: var(--bad); margin-right: 12px; }
      .outstanding.pos { color: var(--good); }
      .orig { color: var(--ink-soft); font-size: 12px; }
      .notes { color: var(--ink-soft); font-size: 13px; }
      .settle-form { display: flex; gap: 10px; align-items: center; margin-top: 14px; flex-wrap: wrap; }
      .settle-form button { height: 48px; margin-bottom: 18px; }
      .panel-actions { display: flex; justify-content: flex-end; }
    `,
  ],
})
export class LendsComponent {
  private api = inject(ApiService);
  private fb = inject(FormBuilder);
  private snack = inject(MatSnackBar);

  readonly lends = signal<Lend[]>([]);

  settleDate = today();
  settleAmount = '';
  settleNote = '';

  form = this.fb.nonNullable.group({
    type: ['given', Validators.required],
    person: ['', Validators.required],
    date: [today(), Validators.required],
    amountExpr: ['', Validators.required],
    notes: [''],
  });

  constructor() {
    this.reload();
  }

  reload(): void {
    this.api.listLends().subscribe((l) => this.lends.set(l));
  }

  byType(type: string): Lend[] {
    return this.lends().filter((l) => l.type === type);
  }

  outstanding(l: Lend): number {
    return l.amount - l.settlements.reduce((t, s) => t + s.amount, 0);
  }

  totalOutstanding(type: string): number {
    return this.byType(type)
      .filter((l) => l.status === 'open')
      .reduce((t, l) => t + this.outstanding(l), 0);
  }

  save(): void {
    if (this.form.invalid || !parseAmountExpr(this.form.value.amountExpr ?? '')) return;
    this.api.createLend(this.form.getRawValue()).subscribe({
      next: () => {
        this.snack.open('Lend recorded', undefined, { duration: 2000 });
        this.form.reset({ type: 'given', person: '', date: today(), amountExpr: '', notes: '' });
        this.reload();
      },
      error: (e) => this.snack.open(e?.error?.error?.message ?? 'Failed', 'OK', { duration: 4000 }),
    });
  }

  settle(l: Lend): void {
    if (!parseAmountExpr(this.settleAmount)) return;
    this.api.settleLend(l.id, { date: this.settleDate, amountExpr: this.settleAmount, note: this.settleNote }).subscribe({
      next: () => {
        this.snack.open('Settlement recorded', undefined, { duration: 2000 });
        this.settleAmount = '';
        this.settleNote = '';
        this.reload();
      },
      error: (e) => this.snack.open(e?.error?.error?.message ?? 'Failed', 'OK', { duration: 4000 }),
    });
  }

  remove(l: Lend): void {
    this.api.deleteLend(l.id).subscribe(() => this.reload());
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
