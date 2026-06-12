// API models. All monetary amounts are int paisa (1 taka = 100 paisa).

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface Subcategory {
  name: string;
  active: boolean;
}

export type CategoryKind = 'expense' | 'savings' | 'pay';

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  subcategories: Subcategory[];
  active: boolean;
}

export type AccountKind = 'bank' | 'mobile' | 'cash' | 'savings' | 'virtual';

export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  virtualRole?: 'external' | 'lendGiven' | 'lendTaken';
  active: boolean;
  goal?: number; // savings target in paisa, 0/absent = none
}

export interface AccountAmount {
  accountId: string;
  amount: number;
}

export interface Period {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'open' | 'closed';
  openingBalances: AccountAmount[];
  openingSavings: AccountAmount[];
  previousPeriodId?: string;
}

export interface SavingsHistoryPoint {
  periodId: string;
  periodName: string;
  startDate: string;
  total: number;
}

export interface TrendPoint {
  periodId: string;
  periodName: string;
  startDate: string;
  totalSpend: number;
  totalSaved: number;
  netWorth: number;
}

export interface CategoryComparison {
  categoryId: string;
  name: string;
  current: number;
  previous: number;
}

export interface PeriodTrends {
  series: TrendPoint[];
  previousPeriodName: string;
  comparison: CategoryComparison[];
}

export interface Expense {
  id: string;
  periodId: string;
  date: string;
  categoryId: string;
  subcategory: string;
  accountId: string;
  amount: number;
  breakdown?: number[];
  remarks?: string;
}

export interface Transfer {
  id: string;
  periodId: string;
  date: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  fee: number;
  note?: string;
}

export interface BudgetItem {
  categoryId: string;
  subcategory: string;
  amount: number;
}

export interface Budget {
  id: string;
  periodId: string;
  items: BudgetItem[];
}

export interface Settlement {
  date: string;
  amount: number;
  note?: string;
}

export interface Lend {
  id: string;
  type: 'given' | 'taken';
  person: string;
  date: string;
  amount: number;
  settlements: Settlement[];
  status: 'open' | 'settled';
  notes?: string;
}

export interface PaymentWindow {
  id: string;
  periodId: string;
  name: string;
  categoryId?: string;
  subcategory?: string;
  startDate: string;
  endDate: string;
}

export interface WindowStatus {
  state: 'upcoming' | 'active' | 'expired' | 'paid';
  days: number;
  paidAmount: number;
}

export interface PaymentWindowWithStatus extends PaymentWindow {
  status: WindowStatus;
}

export interface Reminder {
  id: string;
  date: string;
  task: string;
  done: boolean;
}

export interface AccountStatus {
  account: Account;
  opening: number;
  current: number;
}

export interface DailySpend {
  date: string;
  weekday: string;
  total: number;
}

export interface CategoryTotal {
  categoryId: string;
  name: string;
  total: number;
}

export interface BudgetLine {
  categoryId: string;
  subcategory: string;
  budget: number;
  actual: number;
  remaining: number;
}

export interface BudgetReport {
  lines: BudgetLine[] | null;
  categories: { categoryId: string; budget: number; actual: number; remaining: number }[] | null;
  totals: { budget: number; actual: number; remaining: number; cashActual: number; nonCashActual: number };
}

export interface PeriodSummary {
  period: Period;
  accounts: AccountStatus[];
  inHand: number;
  dailySeries: DailySpend[];
  categoryTotals: CategoryTotal[] | null;
  budget: BudgetReport;
  windows: { window: PaymentWindow; status: WindowStatus }[] | null;
  reminders: Reminder[] | null;
  savings: AccountStatus[] | null;
  lendTotals: { given: number; taken: number };
}

export interface ImportSheetReport {
  sheet: string;
  skipped: boolean;
  expenses: number;
  transfers: number;
  budgetItems: number;
  lends: number;
  warnings: string[] | null;
}

export interface ImportReport {
  sheets: ImportSheetReport[];
}
