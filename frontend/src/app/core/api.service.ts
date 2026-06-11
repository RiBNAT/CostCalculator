import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  Account,
  Budget,
  BudgetItem,
  Category,
  CategoryKind,
  Expense,
  ImportReport,
  Lend,
  PaymentWindow,
  PaymentWindowWithStatus,
  Period,
  PeriodSummary,
  Reminder,
  Transfer,
} from './models';

const base = environment.apiBase;

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private http: HttpClient) {}

  // categories
  listCategories(): Observable<Category[]> {
    return this.http.get<Category[]>(`${base}/categories`);
  }
  createCategory(body: { name: string; kind: CategoryKind; subcategories: { name: string; active: boolean }[] }) {
    return this.http.post<Category>(`${base}/categories`, body);
  }
  updateCategory(id: string, body: Partial<Category>) {
    return this.http.put<void>(`${base}/categories/${id}`, body);
  }
  deleteCategory(id: string) {
    return this.http.delete<void>(`${base}/categories/${id}`);
  }

  // accounts
  listAccounts(): Observable<Account[]> {
    return this.http.get<Account[]>(`${base}/accounts`);
  }
  createAccount(body: { name: string; kind: string }) {
    return this.http.post<Account>(`${base}/accounts`, body);
  }
  updateAccount(id: string, body: { name: string; kind: string; active?: boolean }) {
    return this.http.put<void>(`${base}/accounts/${id}`, body);
  }

  // periods
  listPeriods(): Observable<Period[]> {
    return this.http.get<Period[]>(`${base}/periods`);
  }
  createPeriod(body: { name: string; startDate: string; endDate: string }) {
    return this.http.post<Period>(`${base}/periods`, body);
  }
  updatePeriod(id: string, body: Partial<{ name: string; startDate: string; endDate: string }>) {
    return this.http.put<void>(`${base}/periods/${id}`, body);
  }
  closePeriod(id: string) {
    return this.http.post<void>(`${base}/periods/${id}/close`, {});
  }
  reopenPeriod(id: string) {
    return this.http.post<void>(`${base}/periods/${id}/reopen`, {});
  }
  periodSummary(id: string): Observable<PeriodSummary> {
    return this.http.get<PeriodSummary>(`${base}/periods/${id}/summary`);
  }
  exportUrl(id: string): string {
    return `${base}/periods/${id}/export?format=csv`;
  }

  // expenses
  listExpenses(
    periodId: string,
    filters: Partial<Record<'from' | 'to' | 'categoryId' | 'subcategory' | 'accountId' | 'q', string>> = {},
  ): Observable<Expense[]> {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v) params = params.set(k, v);
    }
    return this.http.get<Expense[]>(`${base}/periods/${periodId}/expenses`, { params });
  }
  createExpense(periodId: string, body: object) {
    return this.http.post<Expense>(`${base}/periods/${periodId}/expenses`, body);
  }
  updateExpense(periodId: string, id: string, body: object) {
    return this.http.put<Expense>(`${base}/periods/${periodId}/expenses/${id}`, body);
  }
  deleteExpense(periodId: string, id: string) {
    return this.http.delete<void>(`${base}/periods/${periodId}/expenses/${id}`);
  }

  // transfers
  listTransfers(periodId: string): Observable<Transfer[]> {
    return this.http.get<Transfer[]>(`${base}/periods/${periodId}/transfers`);
  }
  createTransfer(periodId: string, body: object) {
    return this.http.post<Transfer>(`${base}/periods/${periodId}/transfers`, body);
  }
  updateTransfer(periodId: string, id: string, body: object) {
    return this.http.put<Transfer>(`${base}/periods/${periodId}/transfers/${id}`, body);
  }
  deleteTransfer(periodId: string, id: string) {
    return this.http.delete<void>(`${base}/periods/${periodId}/transfers/${id}`);
  }

  // budget
  getBudget(periodId: string): Observable<Budget> {
    return this.http.get<Budget>(`${base}/periods/${periodId}/budget`);
  }
  putBudget(periodId: string, items: BudgetItem[]) {
    return this.http.put<Budget>(`${base}/periods/${periodId}/budget`, { items });
  }
  copyPreviousBudget(periodId: string) {
    return this.http.post<Budget>(`${base}/periods/${periodId}/budget/copy-previous`, {});
  }

  // lends
  listLends(filters: Partial<Record<'status' | 'type', string>> = {}): Observable<Lend[]> {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v) params = params.set(k, v);
    }
    return this.http.get<Lend[]>(`${base}/lends`, { params });
  }
  createLend(body: object) {
    return this.http.post<Lend>(`${base}/lends`, body);
  }
  settleLend(id: string, body: { date: string; amountExpr: string; note?: string }) {
    return this.http.post<Lend>(`${base}/lends/${id}/settle`, body);
  }
  deleteLend(id: string) {
    return this.http.delete<void>(`${base}/lends/${id}`);
  }

  // planner
  listWindows(periodId?: string): Observable<PaymentWindowWithStatus[]> {
    let params = new HttpParams();
    if (periodId) params = params.set('periodId', periodId);
    return this.http.get<PaymentWindowWithStatus[]>(`${base}/payment-windows`, { params });
  }
  createWindow(body: object) {
    return this.http.post<PaymentWindow>(`${base}/payment-windows`, body);
  }
  updateWindow(id: string, body: object) {
    return this.http.put<void>(`${base}/payment-windows/${id}`, body);
  }
  deleteWindow(id: string) {
    return this.http.delete<void>(`${base}/payment-windows/${id}`);
  }

  listReminders(): Observable<Reminder[]> {
    return this.http.get<Reminder[]>(`${base}/reminders`);
  }
  createReminder(body: { date: string; task: string }) {
    return this.http.post<Reminder>(`${base}/reminders`, body);
  }
  updateReminder(id: string, body: { date: string; task: string; done?: boolean }) {
    return this.http.put<void>(`${base}/reminders/${id}`, body);
  }
  deleteReminder(id: string) {
    return this.http.delete<void>(`${base}/reminders/${id}`);
  }

  // import
  importExcel(file: File): Observable<ImportReport> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<ImportReport>(`${base}/import/excel`, form);
  }
}
