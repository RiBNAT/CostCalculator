import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';

import { ExpenseDialogComponent, ExpenseDialogData } from './expense-dialog.component';
import { ApiService } from '../../core/api.service';
import { Account, Category, Expense, Period } from '../../core/models';

const categories: Category[] = [
  {
    id: 'bazar', name: 'Bazar', kind: 'expense', active: true,
    subcategories: [
      { name: 'DailyBazar', active: true },
      { name: 'Fruits', active: true },
      { name: 'Old', active: false },
    ],
  },
  {
    id: 'extra', name: 'ExtraExpenses', kind: 'expense', active: true,
    subcategories: [{ name: 'Tea', active: true }],
  },
];

const accounts: Account[] = [
  { id: 'cash', name: 'Cash', kind: 'cash', active: true },
  { id: 'lg', name: 'LendGiven', kind: 'virtual', virtualRole: 'lendGiven', active: true },
];

const period: Period = {
  id: 'p1', name: 'June 26', startDate: '2026-05-22T00:00:00Z', endDate: '2026-06-26T00:00:00Z',
  status: 'open', openingBalances: [], openingSavings: [],
};

function setup(expense?: Expense) {
  const api = jasmine.createSpyObj<ApiService>('ApiService', ['createExpense', 'updateExpense']);
  api.createExpense.and.returnValue(of({} as Expense));
  api.updateExpense.and.returnValue(of({} as Expense));
  const ref = jasmine.createSpyObj<MatDialogRef<ExpenseDialogComponent>>('MatDialogRef', ['close']);
  const data: ExpenseDialogData = { period, categories, accounts, expense };

  TestBed.configureTestingModule({
    imports: [ExpenseDialogComponent],
    providers: [
      provideNoopAnimations(),
      { provide: MAT_DIALOG_DATA, useValue: data },
      { provide: MatDialogRef, useValue: ref },
      { provide: ApiService, useValue: api },
    ],
  });
  const fixture: ComponentFixture<ExpenseDialogComponent> = TestBed.createComponent(ExpenseDialogComponent);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, api, ref };
}

describe('ExpenseDialogComponent', () => {
  afterEach(() => localStorage.clear());

  it('defaults "Paid via" and category to the last-used entry', () => {
    localStorage.setItem('ribnat.lastEntry', JSON.stringify({ accountId: 'cash', categoryId: 'bazar' }));
    const { component } = setup();
    expect(component.form.controls.accountId.value).toBe('cash');
    expect(component.form.controls.categoryId.value).toBe('bazar');
  });

  it('save & add another creates the expense, keeps the dialog open, and clears amount/remarks but keeps account+category', () => {
    const { component, api, ref } = setup();
    component.form.setValue({
      date: '2026-06-12', categoryId: 'bazar', subcategory: 'DailyBazar',
      accountId: 'cash', amountExpr: '100', remarks: 'tea',
    });
    component.addAnother();
    expect(api.createExpense).toHaveBeenCalled();
    expect(ref.close).not.toHaveBeenCalled();
    expect(component.form.controls.amountExpr.value).toBe('');
    expect(component.form.controls.remarks.value).toBe('');
    expect(component.form.controls.accountId.value).toBe('cash');
    expect(component.form.controls.categoryId.value).toBe('bazar');
  });

  it('populates subcategories when a category is selected (regression: dropdown was empty)', () => {
    const { component } = setup();
    expect(component.subcategories()).toEqual([]);

    component.form.controls.categoryId.setValue('bazar');
    expect(component.subcategories().map((s) => s.name)).toEqual(['DailyBazar', 'Fruits']); // active only

    component.form.controls.categoryId.setValue('extra');
    expect(component.subcategories().map((s) => s.name)).toEqual(['Tea']);
  });

  it('resets the chosen subcategory when the category changes', () => {
    const { component } = setup();
    component.form.controls.categoryId.setValue('bazar');
    component.form.controls.subcategory.setValue('Fruits');
    component.form.controls.categoryId.setValue('extra');
    expect(component.form.controls.subcategory.value).toBe('');
  });

  it('parses expression amounts live', () => {
    const { component } = setup();
    component.form.controls.amountExpr.setValue('360+20+330+30');
    expect(component.parsedTotal()).toBe(74000);
    component.form.controls.amountExpr.setValue('abc');
    expect(component.parsedTotal()).toBeNull();
  });

  it('only offers liquid payment accounts', () => {
    const { component } = setup();
    expect(component.paymentAccounts.map((a) => a.name)).toEqual(['Cash']);
  });

  it('submits a create request and closes on success', () => {
    const { component, api, ref } = setup();
    component.form.setValue({
      date: '2026-06-12', categoryId: 'bazar', subcategory: 'DailyBazar',
      accountId: 'cash', amountExpr: '100+50', remarks: 'test',
    });
    component.save();
    expect(api.createExpense).toHaveBeenCalledWith('p1', jasmine.objectContaining({ amountExpr: '100+50' }));
    expect(ref.close).toHaveBeenCalledWith(true);
  });

  it('rejects dates outside the period range', () => {
    const { component } = setup();
    component.form.controls.date.setValue('2027-01-01');
    expect(component.form.controls.date.hasError('outsidePeriod')).toBeTrue();
    component.form.controls.date.setValue('2026-06-01');
    expect(component.form.controls.date.valid).toBeTrue();
  });

  it('prefills the form and updates when editing', () => {
    const expense: Expense = {
      id: 'e1', periodId: 'p1', date: '2026-06-10T00:00:00Z', categoryId: 'bazar',
      subcategory: 'Fruits', accountId: 'cash', amount: 41000, breakdown: [16000, 25000], remarks: 'mango',
    };
    const { component, api } = setup(expense);
    expect(component.form.value.amountExpr).toBe('160+250');
    expect(component.form.value.subcategory).toBe('Fruits');
    component.save();
    expect(api.updateExpense).toHaveBeenCalled();
  });
});
