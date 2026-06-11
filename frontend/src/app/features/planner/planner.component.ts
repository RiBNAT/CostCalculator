import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { ApiService } from '../../core/api.service';
import { PeriodStateService } from '../../core/period-state.service';
import { Category, PaymentWindowWithStatus, Reminder } from '../../core/models';
import { MoneyPipe } from '../../core/money.pipe';

@Component({
  selector: 'app-planner',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatIconModule, MatCheckboxModule, MatSnackBarModule, MoneyPipe,
  ],
  template: `
    <div class="page">
      <h1 class="page-title">Planner</h1>
      <p class="page-subtitle">Payment windows and reminders for {{ state.selected()?.name }}</p>

      <div class="two-col">
        <!-- payment windows -->
        <div class="card">
          <h3>Payment windows</h3>
          <form [formGroup]="windowForm" (ngSubmit)="addWindow()" class="add-form">
            <mat-form-field appearance="outline" class="grow">
              <mat-label>Name</mat-label>
              <input matInput formControlName="name" placeholder="ElectricBill_Swk" />
            </mat-form-field>
            <mat-form-field appearance="outline" class="grow">
              <mat-label>Linked subcategory (for paid detection)</mat-label>
              <mat-select formControlName="subcategory">
                <mat-option value="">None</mat-option>
                @for (s of allSubcategories(); track s) {
                  <mat-option [value]="s">{{ s }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline" class="w-date">
              <mat-label>Start</mat-label>
              <input matInput type="date" formControlName="startDate" />
            </mat-form-field>
            <mat-form-field appearance="outline" class="w-date">
              <mat-label>End</mat-label>
              <input matInput type="date" formControlName="endDate" />
            </mat-form-field>
            <button mat-flat-button color="primary" [disabled]="windowForm.invalid || !state.selected()">
              <mat-icon>add</mat-icon> Add
            </button>
          </form>

          @for (w of windows(); track w.id) {
            <div class="row">
              <div class="row-main">
                <strong>{{ w.name }}</strong>
                <span class="dates">{{ w.startDate | date: 'd MMM' }} – {{ w.endDate | date: 'd MMM' }}</span>
                @if (w.subcategory) {
                  <span class="linked">→ {{ w.subcategory }}</span>
                }
              </div>
              <span class="chip" [class]="w.status.state">
                {{ statusLabel(w) }}
              </span>
              <button mat-icon-button (click)="removeWindow(w.id)"><mat-icon>close</mat-icon></button>
            </div>
          } @empty {
            <div class="empty-hint">No payment windows yet</div>
          }
        </div>

        <!-- reminders -->
        <div class="card">
          <h3>Reminders</h3>
          <form [formGroup]="reminderForm" (ngSubmit)="addReminder()" class="add-form">
            <mat-form-field appearance="outline" class="w-date">
              <mat-label>Date</mat-label>
              <input matInput type="date" formControlName="date" />
            </mat-form-field>
            <mat-form-field appearance="outline" class="grow">
              <mat-label>Task</mat-label>
              <input matInput formControlName="task" placeholder="Ticket Dhk to Swk" />
            </mat-form-field>
            <button mat-flat-button color="primary" [disabled]="reminderForm.invalid">
              <mat-icon>add</mat-icon> Add
            </button>
          </form>

          @for (r of reminders(); track r.id) {
            <div class="row" [class.done-row]="r.done">
              <mat-checkbox [checked]="r.done" (change)="toggleReminder(r, $event.checked)" />
              <div class="row-main">
                <span [class.struck]="r.done">{{ r.task }}</span>
                <span class="dates">{{ r.date | date: 'EEE, d MMM yyyy' }}</span>
              </div>
              <button mat-icon-button (click)="removeReminder(r.id)"><mat-icon>close</mat-icon></button>
            </div>
          } @empty {
            <div class="empty-hint">No reminders</div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
      @media (max-width: 1100px) { .two-col { grid-template-columns: 1fr; } }
      h3 { margin: 0 0 14px; font-size: 15px; font-weight: 700; }
      .add-form { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 8px; }
      .add-form button { height: 48px; margin-bottom: 18px; }
      .grow { flex: 1; min-width: 150px; }
      .w-date { width: 150px; }
      .row { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid #f0f2f8; }
      .row:last-child { border-bottom: none; }
      .row-main { flex: 1; display: flex; flex-direction: column; gap: 1px; }
      .dates { color: var(--ink-soft); font-size: 12px; }
      .linked { color: var(--primary); font-size: 12px; }
      .struck { text-decoration: line-through; color: var(--ink-soft); }
      .done-row { opacity: 0.65; }
    `,
  ],
})
export class PlannerComponent {
  private api = inject(ApiService);
  private fb = inject(FormBuilder);
  private snack = inject(MatSnackBar);
  readonly state = inject(PeriodStateService);

  readonly windows = signal<PaymentWindowWithStatus[]>([]);
  readonly reminders = signal<Reminder[]>([]);
  readonly categories = signal<Category[]>([]);

  windowForm = this.fb.nonNullable.group({
    name: ['', Validators.required],
    subcategory: [''],
    startDate: ['', Validators.required],
    endDate: ['', Validators.required],
  });

  reminderForm = this.fb.nonNullable.group({
    date: ['', Validators.required],
    task: ['', Validators.required],
  });

  constructor() {
    this.api.listCategories().subscribe((c) => this.categories.set(c));
    this.reloadReminders();
    effect(() => {
      const p = this.state.selected();
      if (p) this.reloadWindows(p.id);
      else this.windows.set([]);
    });
  }

  readonly allSubcategories = computed(() =>
    this.categories().flatMap((c) => c.subcategories.filter((s) => s.active).map((s) => s.name)),
  );

  reloadWindows(periodId: string): void {
    this.api.listWindows(periodId).subscribe((w) => this.windows.set(w));
  }

  reloadReminders(): void {
    this.api.listReminders().subscribe((r) => this.reminders.set(r));
  }

  statusLabel(w: PaymentWindowWithStatus): string {
    const st = w.status;
    switch (st.state) {
      case 'upcoming':
        return `starts in ${st.days}d`;
      case 'active':
        return st.days === 0 ? 'last day' : `${st.days}d left`;
      case 'expired':
        return `expired ${st.days}d ago`;
      default:
        return `paid`;
    }
  }

  addWindow(): void {
    const p = this.state.selected();
    if (!p || this.windowForm.invalid) return;
    const v = this.windowForm.getRawValue();
    const cat = this.categories().find((c) => c.subcategories.some((s) => s.name === v.subcategory));
    this.api
      .createWindow({ ...v, periodId: p.id, categoryId: cat?.id ?? '' })
      .subscribe({
        next: () => {
          this.windowForm.reset({ name: '', subcategory: '', startDate: '', endDate: '' });
          this.reloadWindows(p.id);
        },
        error: (e) => this.snack.open(e?.error?.error?.message ?? 'Failed', 'OK', { duration: 4000 }),
      });
  }

  removeWindow(id: string): void {
    const p = this.state.selected();
    this.api.deleteWindow(id).subscribe(() => p && this.reloadWindows(p.id));
  }

  addReminder(): void {
    if (this.reminderForm.invalid) return;
    this.api.createReminder(this.reminderForm.getRawValue()).subscribe({
      next: () => {
        this.reminderForm.reset({ date: '', task: '' });
        this.reloadReminders();
      },
      error: (e) => this.snack.open(e?.error?.error?.message ?? 'Failed', 'OK', { duration: 4000 }),
    });
  }

  toggleReminder(r: Reminder, done: boolean): void {
    this.api.updateReminder(r.id, { date: r.date.slice(0, 10), task: r.task, done }).subscribe(() => this.reloadReminders());
  }

  removeReminder(id: string): void {
    this.api.deleteReminder(id).subscribe(() => this.reloadReminders());
  }
}
