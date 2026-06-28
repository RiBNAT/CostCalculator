// Hand-maintained edge of the type layer. Entity + enum shapes come from the Go
// backend via codegen (types.gen.ts) and are drift-checked in CI. This file adds
// the auth/response shapes that have no single Go struct or that span packages.
export * from "./types.gen";

import type {
  User, Account, Period, PaymentWindow, Reminder, BudgetLine, BudgetTotals,
  CategoryRollup, BudgetItem, WindowState,
} from "./types.gen";

// Aliases matching existing frontend names for renamed/cross-package types.
export type BudgetCategoryRollup = CategoryRollup;

// Auth payloads (no single Go struct backs these response envelopes).
export interface TokenPair { accessToken: string; refreshToken: string; }
export interface AuthResult { user: User; tokens: TokenPair; }

// Budget report as returned by /summary.budget and the budget endpoints
// (superset: raw budget GET adds id/periodId/items/rollover).
export interface BudgetReport {
  id?: string; periodId?: string; rollover?: boolean; items?: BudgetItem[];
  lines: BudgetLine[]; categories: BudgetCategoryRollup[]; totals: BudgetTotals;
}

// Payment-window status (Go: domain.WindowStatusResult).
export interface WindowStatus { state: WindowState; days: number; paidAmount: number; }
export interface PaymentWindowWithStatus { window: PaymentWindow; status: WindowStatus; }

// Service response aggregates (internal/service; reference generated entities).
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

// Import report (internal/importer).
export interface ImportSheetReport { sheet: string; skipped: boolean; expenses: number; transfers: number; budgetItems: number; lends: number; warnings?: string[]; }
export interface ImportReport { sheets: ImportSheetReport[]; }
