import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { forkJoin } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { PeriodStateService } from '../../core/period-state.service';
import { Category } from '../../core/models';
import { MoneyPipe } from '../../core/money.pipe';

interface EditableLine {
  categoryId: string;
  subcategory: string;
  budgetTaka: number; // edited in taka
  actual: number; // paisa
}

@Component({
  selector: 'app-budget',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, MatSlideToggleModule, MatSnackBarModule, MoneyPipe],
  template: `
    <div class="page">
      <div class="head-row">
        <div>
          <h1 class="page-title">Budget</h1>
          <p class="page-subtitle">{{ state.selected()?.name }} · plan vs actual per subcategory</p>
        </div>
        <div class="head-actions">
          <mat-slide-toggle class="rollover-toggle" [ngModel]="rollover()" (ngModelChange)="setRollover($event)"
                            [disabled]="!state.selected()?.previousPeriodId"
                            title="Carry the previous period's unspent budget into this one">
            Roll over unspent
          </mat-slide-toggle>
          <button mat-stroked-button (click)="copyPrevious()" [disabled]="!state.selected()?.previousPeriodId">
            <mat-icon>content_copy</mat-icon> Copy previous
          </button>
          <button mat-flat-button color="primary" (click)="save()" [disabled]="!dirty()">
            <mat-icon>save</mat-icon> Save budget
          </button>
        </div>
      </div>

      @for (group of grouped(); track group.category.id) {
        <div class="card group-card">
          <div class="group-head">
            <h3>{{ group.category.name }}</h3>
            <div class="group-totals">
              <span>budget {{ group.budget | money }}</span>
              <span>spent {{ group.actual | money }}</span>
              <span [class]="group.budget - group.actual >= 0 ? 'pos' : 'neg'">
                {{ group.budget - group.actual | money }} {{ group.budget - group.actual >= 0 ? 'left' : 'over' }}
              </span>
            </div>
          </div>
          <table class="data">
            <thead>
              <tr><th>Subcategory</th><th class="num">Budget (৳)</th><th class="num">Actual</th><th class="num">Remaining</th></tr>
            </thead>
            <tbody>
              @for (line of group.lines; track line.subcategory) {
                <tr>
                  <td>{{ line.subcategory }}</td>
                  <td class="num budget-cell">
                    <input
                      type="number" min="0"
                      [ngModel]="line.budgetTaka"
                      (ngModelChange)="setBudget(line, $event)"
                    />
                  </td>
                  <td class="num">{{ line.actual | money }}</td>
                  <td class="num" [class.neg]="line.budgetTaka * 100 - line.actual < 0" [class.pos]="line.budgetTaka * 100 - line.actual >= 0">
                    {{ line.budgetTaka * 100 - line.actual | money }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @empty {
        <div class="card empty-hint">No categories — set them up in Settings</div>
      }

      @if (dirty()) {
        <div class="save-bar" role="status">
          <mat-icon>edit_note</mat-icon>
          <span>You have unsaved budget changes</span>
          <span class="bar-spacer"></span>
          <button mat-button (click)="discard()">Discard</button>
          <button mat-flat-button color="primary" (click)="save()"><mat-icon>save</mat-icon> Save budget</button>
        </div>
      }

      <div class="card totals-card">
        <div class="tot"><span>Total budget</span><strong>{{ totals().budget | money }}</strong></div>
        <div class="tot"><span>Total spent</span><strong>{{ totals().actual | money }}</strong></div>
        <div class="tot">
          <span>Remaining</span>
          <strong [class]="totals().budget - totals().actual >= 0 ? 'pos' : 'neg'">{{ totals().budget - totals().actual | money }}</strong>
        </div>
        <div class="tot"><span>Cash spend</span><strong>{{ cashActual() | money }}</strong></div>
        <div class="tot"><span>Non-cash spend</span><strong>{{ nonCashActual() | money }}</strong></div>
      </div>
    </div>
  `,
  styles: [
    `
      .head-row { display: flex; justify-content: space-between; align-items: flex-start; }
      .head-actions { display: flex; gap: 14px; align-items: center; }
      .rollover-toggle { font-size: 13px; }
      .group-card { margin-bottom: 14px; padding: 14px 18px; }
      .group-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
      .group-head h3 { margin: 0; font-size: 15px; font-weight: 700; }
      .group-totals { display: flex; gap: 16px; font-size: 12px; color: var(--ink-soft); }
      .budget-cell input {
        width: 100px; text-align: right;
        border: 1px solid #dde1ee; border-radius: 8px;
        padding: 6px 8px; font: inherit;
        font-variant-numeric: tabular-nums;
      }
      .budget-cell input:focus { outline: 2px solid var(--primary); border-color: transparent; }
      .save-bar {
        position: sticky; bottom: 16px; z-index: 30;
        display: flex; align-items: center; gap: 10px;
        background: #1a2033; color: #fff;
        border-radius: 999px; padding: 8px 10px 8px 18px;
        box-shadow: 0 10px 30px rgba(20, 28, 58, 0.35);
        margin: 14px 84px 14px 0; /* right margin clears the quick-add FAB */
        font-size: 14px; font-weight: 600;
      }
      .save-bar .bar-spacer { flex: 1; }
      .save-bar button[mat-button] { color: #c5cae9; }
      .totals-card { display: flex; gap: 36px; flex-wrap: wrap; margin-top: 4px; }
      .tot { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--ink-soft); }
      .tot strong { font-size: 18px; color: var(--ink); }
      .tot strong.pos { color: var(--good); }
      .tot strong.neg { color: var(--bad); }
    `,
  ],
})
export class BudgetComponent {
  private api = inject(ApiService);
  private snack = inject(MatSnackBar);
  readonly state = inject(PeriodStateService);

  readonly categories = signal<Category[]>([]);
  readonly lines = signal<EditableLine[]>([]);
  readonly dirty = signal(false);
  readonly rollover = signal(false);
  readonly cashActual = signal(0);
  readonly nonCashActual = signal(0);

  constructor() {
    this.api.listCategories().subscribe((c) => this.categories.set(c));
    effect(() => {
      const p = this.state.selected();
      if (p) this.reload(p.id);
    }, { allowSignalWrites: true });
  }

  reload(periodId: string): void {
    // Edit the RAW budget items (so rollover, which the summary folds in, never
    // compounds on save); take actuals from the summary's report.
    forkJoin({ budget: this.api.getBudget(periodId), summary: this.api.periodSummary(periodId) }).subscribe(
      ({ budget, summary }) => {
        this.rollover.set(!!budget.rollover);

        const rawBudget = new Map<string, number>(); // catSub -> paisa
        for (const it of budget.items ?? []) rawBudget.set(it.categoryId + '|' + it.subcategory, it.amount);
        const actualMap = new Map<string, number>();
        for (const l of summary.budget.lines ?? []) actualMap.set(l.categoryId + '|' + l.subcategory, l.actual);

        const lines: EditableLine[] = [];
        const seen = new Set<string>();
        for (const cat of this.categories()) {
          for (const sub of cat.subcategories.filter((x) => x.active)) {
            const key = cat.id + '|' + sub.name;
            seen.add(key);
            lines.push({
              categoryId: cat.id,
              subcategory: sub.name,
              budgetTaka: (rawBudget.get(key) ?? 0) / 100,
              actual: actualMap.get(key) ?? 0,
            });
          }
        }
        // lines for deactivated/unknown subcats that still have budget or spend
        for (const key of new Set([...rawBudget.keys(), ...actualMap.keys()])) {
          if (seen.has(key)) continue;
          const [categoryId, subcategory] = key.split('|');
          lines.push({ categoryId, subcategory, budgetTaka: (rawBudget.get(key) ?? 0) / 100, actual: actualMap.get(key) ?? 0 });
        }

        this.lines.set(lines);
        this.cashActual.set(summary.budget.totals.cashActual);
        this.nonCashActual.set(summary.budget.totals.nonCashActual);
        this.dirty.set(false);
      },
    );
  }

  setRollover(on: boolean): void {
    this.rollover.set(on);
    this.dirty.set(true);
  }

  readonly grouped = computed(() => {
    const cats = this.categories();
    return cats
      .map((c) => {
        const lines = this.lines().filter((l) => l.categoryId === c.id);
        return {
          category: c,
          lines,
          budget: lines.reduce((t, l) => t + l.budgetTaka * 100, 0),
          actual: lines.reduce((t, l) => t + l.actual, 0),
        };
      })
      .filter((g) => g.lines.length > 0);
  });

  readonly totals = computed(() => ({
    budget: this.lines().reduce((t, l) => t + l.budgetTaka * 100, 0),
    actual: this.lines().reduce((t, l) => t + l.actual, 0),
  }));

  setBudget(line: EditableLine, taka: number): void {
    this.lines.update((all) =>
      all.map((l) => (l === line ? { ...l, budgetTaka: Number(taka) || 0 } : l)),
    );
    this.dirty.set(true);
  }

  save(): void {
    const p = this.state.selected();
    if (!p) return;
    const items = this.lines()
      .filter((l) => l.budgetTaka > 0)
      .map((l) => ({ categoryId: l.categoryId, subcategory: l.subcategory, amount: Math.round(l.budgetTaka * 100) }));
    this.api.putBudget(p.id, items, this.rollover()).subscribe({
      next: () => {
        this.snack.open('Budget saved', undefined, { duration: 2000 });
        this.reload(p.id);
      },
      error: (e) => this.snack.open(e?.error?.error?.message ?? 'Save failed', 'OK', { duration: 4000 }),
    });
  }

  discard(): void {
    const p = this.state.selected();
    if (p) this.reload(p.id);
  }

  /** Used by the pending-changes route guard. */
  hasPendingChanges(): boolean {
    return this.dirty();
  }

  /**
   * Pull the previous period's saved budget into the editable lines *without*
   * persisting. The change is marked dirty so the normal Save/Discard flow
   * governs it — Discard is the undo. (Previously this overwrote the server
   * budget immediately with no way back.)
   */
  copyPrevious(): void {
    const p = this.state.selected();
    if (!p?.previousPeriodId) return;
    this.api.getBudget(p.previousPeriodId).subscribe({
      next: (prev) => {
        const amounts = new Map<string, number>();
        for (const it of prev.items ?? []) amounts.set(it.categoryId + '|' + it.subcategory, it.amount);
        if (amounts.size === 0) {
          this.snack.open('Previous period has no budget to copy', 'OK', { duration: 3000 });
          return;
        }
        this.lines.update((all) =>
          all.map((l) => ({ ...l, budgetTaka: (amounts.get(l.categoryId + '|' + l.subcategory) ?? 0) / 100 })),
        );
        this.dirty.set(true);
        this.snack.open('Copied from previous — review, then Save or Discard', undefined, { duration: 3500 });
      },
      error: (e) => this.snack.open(e?.error?.error?.message ?? 'Copy failed', 'OK', { duration: 4000 }),
    });
  }
}
