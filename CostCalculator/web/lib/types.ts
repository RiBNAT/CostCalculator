// Domain types mirroring the Go backend (internal/domain). Money is int64 paisa.

export interface User { id: string; name: string; email: string; phone?: string; createdAt?: string; }
export interface TokenPair { accessToken: string; refreshToken: string; }
export interface AuthResult { user: User; tokens: TokenPair; }

export type CategoryKind = "expense" | "savings" | "pay";
export interface Subcategory { name: string; active: boolean; }
export interface Category { id: string; name: string; kind: CategoryKind; subcategories: Subcategory[]; active: boolean; }

export type AccountKind = "bank" | "mobile" | "cash" | "savings" | "virtual";
export type VirtualRole = "external" | "lendGiven" | "lendTaken";
export interface Account { id: string; name: string; kind: AccountKind; virtualRole?: VirtualRole; active: boolean; goal?: number; }

export interface AccountAmount { accountId: string; amount: number; }
export type PeriodStatus = "open" | "closed";
export interface Period {
  id: string; name: string; startDate: string; endDate: string; status: PeriodStatus;
  openingBalances?: AccountAmount[]; openingSavings?: AccountAmount[]; previousPeriodId?: string;
}

export interface Expense {
  id: string; periodId: string; date: string; categoryId: string; subcategory: string;
  accountId: string; amount: number; breakdown?: number[]; remarks?: string;
}
export interface Transfer {
  id: string; periodId: string; date: string; fromAccountId: string; toAccountId: string;
  amount: number; fee: number; note?: string;
}

export interface BudgetItem { categoryId: string; subcategory: string; amount: number; }
export interface Budget { id: string; periodId: string; items: BudgetItem[]; rollover?: boolean; }
export interface BudgetLine { categoryId: string; subcategory: string; budget: number; actual: number; remaining: number; }
export interface BudgetCategoryRollup { categoryId: string; budget: number; actual: number; remaining: number; }
export interface BudgetTotals { budget: number; actual: number; remaining: number; cashActual: number; nonCashActual: number; }
export interface BudgetReport { id?: string; periodId?: string; rollover?: boolean; items?: BudgetItem[]; lines: BudgetLine[]; categories: BudgetCategoryRollup[]; totals: BudgetTotals; }

export type LendType = "given" | "taken";
export type LendStatus = "open" | "settled";
export interface Settlement { date: string; amount: number; note?: string; }
export interface Lend { id: string; type: LendType; person: string; date: string; amount: number; settlements: Settlement[]; status: LendStatus; notes?: string; outstanding?: number; }

export interface PaymentWindow { id: string; periodId: string; name: string; categoryId?: string; subcategory?: string; startDate: string; endDate: string; }
export type WindowState = "upcoming" | "active" | "expired" | "paid";
export interface WindowStatus { state: WindowState; days: number; paidAmount: number; }
export interface PaymentWindowWithStatus { window: PaymentWindow; status: WindowStatus; }
export interface Reminder { id: string; date: string; task: string; done: boolean; }
export interface RecurringExpense { id: string; label: string; categoryId: string; subcategory: string; accountId: string; amount: number; }

export interface AccountStatus { account: Account; opening: number; current: number; }
export interface DailySpend { date: string; weekday: string; total: number; }
export interface CategoryTotal { categoryId: string; name: string; total: number; }
export interface PeriodSummary {
  period: Period; accounts: AccountStatus[]; inHand: number;
  dailySeries: DailySpend[]; categoryTotals: CategoryTotal[];
  budget: BudgetReport; windows: PaymentWindowWithStatus[]; reminders: Reminder[];
  savings: AccountStatus[]; lendTotals: { given: number; taken: number };
}
export interface TrendPoint { periodId: string; periodName: string; startDate: string; totalSpend: number; totalSaved: number; netWorth: number; }
export interface ComparisonRow { categoryId: string; name: string; current: number; previous: number; }
export interface PeriodTrends { series: TrendPoint[]; previousPeriodName?: string; comparison: ComparisonRow[]; }
export interface SavingsHistoryPoint { periodId: string; periodName: string; startDate: string; total: number; }

export interface ImportSheetReport { sheet: string; skipped: boolean; expenses: number; transfers: number; budgetItems: number; lends: number; warnings?: string[]; }
export interface ImportReport { sheets: ImportSheetReport[]; }
