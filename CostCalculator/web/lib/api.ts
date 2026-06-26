// Fetch client for the Go backend. Same-origin /api/v1 (Next rewrites proxy to :8080 in dev).
import type {
  AuthResult, TokenPair, User, Category, Account, Period, PeriodSummary, PeriodTrends,
  Expense, Transfer, Budget, BudgetItem, Lend, PaymentWindowWithStatus, PaymentWindow,
  Reminder, RecurringExpense, SavingsHistoryPoint, ImportReport,
} from "./types";

const BASE = "/api/v1";
const K_ACCESS = "ribnat.access", K_REFRESH = "ribnat.refresh", K_USER = "ribnat.user";

export const tokens = {
  get access() { return typeof localStorage !== "undefined" ? localStorage.getItem(K_ACCESS) : null; },
  get refresh() { return typeof localStorage !== "undefined" ? localStorage.getItem(K_REFRESH) : null; },
  set(pair: TokenPair) { localStorage.setItem(K_ACCESS, pair.accessToken); localStorage.setItem(K_REFRESH, pair.refreshToken); },
  clear() { localStorage.removeItem(K_ACCESS); localStorage.removeItem(K_REFRESH); localStorage.removeItem(K_USER); },
};
export const storedUser = {
  get(): User | null { try { const v = localStorage.getItem(K_USER); return v ? JSON.parse(v) : null; } catch { return null; } },
  set(u: User | null) { if (u) localStorage.setItem(K_USER, JSON.stringify(u)); else localStorage.removeItem(K_USER); },
};

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

let refreshing: Promise<boolean> | null = null;
async function doRefresh(): Promise<boolean> {
  if (!tokens.refresh) return false;
  if (!refreshing) {
    refreshing = fetch(`${BASE}/auth/refresh`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: tokens.refresh }),
    }).then(async (r) => {
      if (!r.ok) return false;
      const pair = (await r.json()) as TokenPair;
      tokens.set(pair);
      return true;
    }).catch(() => false).finally(() => { setTimeout(() => (refreshing = null), 0); });
  }
  return refreshing;
}

let onAuthLost: (() => void) | null = null;
export function setOnAuthLost(fn: () => void) { onAuthLost = fn; }

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const isAuthPath = path.startsWith("/auth/");
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (body instanceof FormData) { payload = body; }
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  if (!isAuthPath && tokens.access) headers["Authorization"] = `Bearer ${tokens.access}`;

  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });

  if (res.status === 401 && !isAuthPath && retry) {
    const ok = await doRefresh();
    if (ok) return request<T>(method, path, body, false);
    tokens.clear(); onAuthLost?.();
    throw new ApiError(401, "Session expired");
  }
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = j?.error?.message || j?.error || j?.message || msg; } catch {}
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  return (await res.blob()) as unknown as T;
}

const q = (params?: Record<string, string | undefined>) => {
  if (!params) return "";
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) u.set(k, v); });
  const s = u.toString();
  return s ? `?${s}` : "";
};

export const api = {
  // auth
  authConfig: () => request<{ googleEnabled: boolean; googleClientId: string }>("GET", "/auth/config"),
  register: (b: { name: string; email: string; password: string }) => request<AuthResult>("POST", "/auth/register", b),
  login: (b: { email: string; password: string }) => request<AuthResult>("POST", "/auth/login", b),
  google: (idToken: string) => request<AuthResult>("POST", "/auth/google", { idToken }),

  // profile
  me: () => request<User>("GET", "/me"),
  updateProfile: (b: { name: string; phone?: string }) => request<User>("PUT", "/me", b),
  updateEmail: (b: { email: string; password: string }) => request<User>("PUT", "/me/email", b),
  updatePassword: (b: { currentPassword: string; newPassword: string }) => request<void>("PUT", "/me/password", b),

  // reference data
  listCategories: () => request<Category[]>("GET", "/categories"),
  createCategory: (b: Partial<Category>) => request<Category>("POST", "/categories", b),
  updateCategory: (id: string, b: Partial<Category>) => request<void>("PUT", `/categories/${id}`, b),
  deleteCategory: (id: string) => request<void>("DELETE", `/categories/${id}`),
  listAccounts: () => request<Account[]>("GET", "/accounts"),
  createAccount: (b: Partial<Account>) => request<Account>("POST", "/accounts", b),
  updateAccount: (id: string, b: Partial<Account>) => request<void>("PUT", `/accounts/${id}`, b),
  deleteAccount: (id: string) => request<void>("DELETE", `/accounts/${id}`),

  // periods
  listPeriods: () => request<Period[]>("GET", "/periods"),
  createPeriod: (b: Partial<Period>) => request<Period>("POST", "/periods", b),
  updatePeriod: (id: string, b: Partial<Period>) => request<void>("PUT", `/periods/${id}`, b),
  closePeriod: (id: string) => request<void>("POST", `/periods/${id}/close`),
  reopenPeriod: (id: string) => request<void>("POST", `/periods/${id}/reopen`),
  periodSummary: (id: string) => request<PeriodSummary>("GET", `/periods/${id}/summary`),
  periodTrends: (id: string) => request<PeriodTrends>("GET", `/periods/${id}/trends`),
  savingsHistory: () => request<SavingsHistoryPoint[]>("GET", "/savings/history"),
  exportCsv: (id: string) => request<Blob>("GET", `/periods/${id}/export?format=csv`),
  downloadTemplate: () => request<Blob>("GET", "/template/excel"),

  // entries
  listExpenses: (pid: string, f?: { categoryId?: string; subcategory?: string; accountId?: string; q?: string; from?: string; to?: string }) =>
    request<Expense[]>("GET", `/periods/${pid}/expenses${q(f)}`),
  createExpense: (pid: string, b: any) => request<Expense>("POST", `/periods/${pid}/expenses`, b),
  updateExpense: (pid: string, id: string, b: any) => request<Expense>("PUT", `/periods/${pid}/expenses/${id}`, b),
  deleteExpense: (pid: string, id: string) => request<void>("DELETE", `/periods/${pid}/expenses/${id}`),
  listTransfers: (pid: string) => request<Transfer[]>("GET", `/periods/${pid}/transfers`),
  createTransfer: (pid: string, b: any) => request<Transfer>("POST", `/periods/${pid}/transfers`, b),
  updateTransfer: (pid: string, id: string, b: any) => request<Transfer>("PUT", `/periods/${pid}/transfers/${id}`, b),
  deleteTransfer: (pid: string, id: string) => request<void>("DELETE", `/periods/${pid}/transfers/${id}`),

  // budget — GET/PUT/copy return the raw allocations ({items, rollover}); actuals come from /summary.budget (BudgetReport)
  getBudget: (pid: string) => request<Budget>("GET", `/periods/${pid}/budget`),
  putBudget: (pid: string, items: BudgetItem[], rollover?: boolean) => request<Budget>("PUT", `/periods/${pid}/budget`, { items, rollover }),
  copyPreviousBudget: (pid: string) => request<Budget>("POST", `/periods/${pid}/budget/copy-previous`),

  // lends
  listLends: (f?: { type?: string; status?: string }) => request<Lend[]>("GET", `/lends${q(f)}`),
  createLend: (b: any) => request<Lend>("POST", "/lends", b),
  updateLend: (id: string, b: any) => request<void>("PUT", `/lends/${id}`, b),
  settleLend: (id: string, b: any) => request<Lend>("POST", `/lends/${id}/settle`, b),
  deleteLend: (id: string) => request<void>("DELETE", `/lends/${id}`),

  // planner
  listWindows: (periodId?: string) => request<PaymentWindowWithStatus[]>("GET", `/payment-windows${q({ periodId })}`),
  createWindow: (b: any) => request<PaymentWindow>("POST", "/payment-windows", b),
  updateWindow: (id: string, b: any) => request<void>("PUT", `/payment-windows/${id}`, b),
  deleteWindow: (id: string) => request<void>("DELETE", `/payment-windows/${id}`),
  listReminders: () => request<Reminder[]>("GET", "/reminders"),
  createReminder: (b: any) => request<Reminder>("POST", "/reminders", b),
  updateReminder: (id: string, b: any) => request<void>("PUT", `/reminders/${id}`, b),
  deleteReminder: (id: string) => request<void>("DELETE", `/reminders/${id}`),

  // recurring
  listRecurring: () => request<RecurringExpense[]>("GET", "/recurring"),
  createRecurring: (b: any) => request<RecurringExpense>("POST", "/recurring", b),
  deleteRecurring: (id: string) => request<void>("DELETE", `/recurring/${id}`),

  // import
  importExcel: (file: File) => { const fd = new FormData(); fd.append("file", file); return request<ImportReport>("POST", "/import/excel", fd); },
};
