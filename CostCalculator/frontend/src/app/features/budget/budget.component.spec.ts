import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';

import { BudgetComponent } from './budget.component';
import { ApiService } from '../../core/api.service';
import { PeriodStateService } from '../../core/period-state.service';
import { Budget, Category, Period, PeriodSummary } from '../../core/models';

const categories: Category[] = [
  {
    id: 'bazar', name: 'Bazar', kind: 'expense', active: true,
    subcategories: [{ name: 'DailyBazar', active: true }, { name: 'Fruits', active: true }],
  },
];

const period: Period = {
  id: 'p1', name: 'June 26', previousPeriodId: 'p0',
  startDate: '2026-06-01T00:00:00Z', endDate: '2026-06-30T00:00:00Z',
  status: 'open', openingBalances: [], openingSavings: [],
};

// current period starts with no budget set
const summary = {
  budget: { lines: [], totals: { budget: 0, actual: 0, remaining: 0, cashActual: 0, nonCashActual: 0 } },
} as unknown as PeriodSummary;

// previous period budgeted 500 taka of DailyBazar
const prevBudget = {
  id: 'b0', periodId: 'p0',
  items: [{ categoryId: 'bazar', subcategory: 'DailyBazar', amount: 50000 }],
} as Budget;

function setup() {
  const api = jasmine.createSpyObj<ApiService>('ApiService', [
    'listCategories', 'periodSummary', 'getBudget', 'putBudget', 'copyPreviousBudget',
  ]);
  api.listCategories.and.returnValue(of(categories));
  api.periodSummary.and.returnValue(of(summary));
  api.getBudget.and.returnValue(of(prevBudget));
  api.putBudget.and.returnValue(of({} as Budget));
  api.copyPreviousBudget.and.returnValue(of({} as Budget));

  const snack = jasmine.createSpyObj<MatSnackBar>('MatSnackBar', ['open']);
  const state = { selected: signal<Period | null>(period) };

  TestBed.configureTestingModule({
    imports: [BudgetComponent],
    providers: [
      provideNoopAnimations(),
      { provide: ApiService, useValue: api },
      { provide: MatSnackBar, useValue: snack },
      { provide: PeriodStateService, useValue: state },
    ],
  });
  const fixture: ComponentFixture<BudgetComponent> = TestBed.createComponent(BudgetComponent);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, api };
}

describe('BudgetComponent copyPrevious', () => {
  it('applies the previous budget to editable lines without persisting (undoable via Discard)', () => {
    const { component, api } = setup();

    component.copyPrevious();

    // pulls the previous period's saved budget, does NOT hit the persist endpoints
    expect(api.getBudget).toHaveBeenCalledWith('p0');
    expect(api.copyPreviousBudget).not.toHaveBeenCalled();
    expect(api.putBudget).not.toHaveBeenCalled();

    // the copied amount lands in the line, marked dirty so Save/Discard governs it
    const daily = component.lines().find((l) => l.subcategory === 'DailyBazar');
    expect(daily?.budgetTaka).toBe(500);
    expect(component.dirty()).toBeTrue();
  });
});
