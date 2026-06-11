# Ribnat Cost Tracker — Design Specification

**Date:** 2026-06-12
**Source:** `CostSheet (3).xlsx` (18 sheets, Jan 2025 – June 2026)
**Stack (user-selected):** Go backend · Angular frontend · MongoDB · JWT multi-user auth

## 1. Purpose

Replace a hand-maintained Excel cost workbook with a self-hosted web application. The
workbook tracks personal finances in Bangladesh: daily expenses by category, transfers
between bank/mobile-banking/cash accounts, budgets, lending, savings, recurring-bill
payment windows, and reminders. One sheet per salary-cycle "month" (custom date ranges,
e.g. 22 May – 26 June), with balances chained sheet-to-sheet.

## 2. Requirements extracted from the workbook

### 2.1 Reference data (from `data` sheet)
- **Categories with subcategories** (editable in app, seeded from Excel):
  - RentAndPaybill: HouseRent, ElectricBill_Dhk, ElectricBill_Swk, GassBill, WifiBill, ServiceBill
  - Bazar: DailyBazar, Fruits, AdvGiven, Others
  - HouseholdAccessories: HouseholdAccessories, DailyAccessories, Medicine
  - MobileInternet: ForMine, ForOthers
  - ExtraExpenses: Tea, Travel, AiSubs, BooksOrCourses, ExtraExpenses
  - Savings: EximBank_2.5, CityBank_10, BracBank_10, SBL_root, Exim_root
  - Donation: Donation, Unknown
  - Pay: CityService, SblService, BracService
- **Payment methods / accounts:** Cash, SCB, SBL, EXIM, bKash, Nagad, City
- **Virtual accounts:** Add (external income source), LendGiven, LendTaken, Pay
- **Savings accounts:** EximBank_2.5, CityBank_10, BracBank_10, SBL_root, Exim_root

### 2.2 Functional requirements
1. **Expense ledger** — date, category, subcategory, payment method, amount, remarks.
   Amounts are often entered as additive breakdowns (`=360+20+330+30`); the app must
   accept sum-expression entry and preserve the breakdown.
2. **Transfers ("Transaction & Pay")** — date, from-account, to-account, amount,
   optional fee (e.g. 15 tk ATM/agent fee). Includes income (`Add → SCB`), withdrawals
   (`SCB → Cash`), top-ups (`SCB → bKash`), lend disbursement/repayment via the
   LendGiven/LendTaken virtual accounts.
3. **Account balances ("Financial Status")** — per account:
   `opening − Σ outgoing(amount + fee) + Σ incoming − Σ expenses paid from account`,
   plus a total in-hand figure across liquid accounts. Opening balances chain from the
   previous period (Excel: `INDIRECT("'May 26'!M4")`).
4. **Custom periods** — user-defined start/end dates per period (salary cycle).
   Daily spend list for every date in the period with weekday names.
5. **Budgets** — per-subcategory budget vs. actual with per-category rollups,
   Total / Cash / Non-Cash splits, and remaining amounts.
6. **Lending registers** — LEND GIVEN TO and LEND TAKEN FROM: date, person, amount;
   balances persist across periods; partial settlements occur (e.g. `=1000-585`).
7. **Savings tracker** — per savings account: previous balance + deposits this period
   (deposits are expenses under category *Savings*) = current balance.
8. **Payment windows ("Constraints")** — recurring obligations (electric bills, wifi,
   AiSubs, savings deposits) each with a start/end date window per period and a status:
   *Start in N* / *Active* / *Expire in N* / *Expired* (Excel custom `DATESTATUS()`),
   plus paid detection from matching expenses.
9. **Reminders ("Remind Me")** — date + free-text task (e.g. "Ticket Dhk to Swk").
10. **Reference-data management** — categories, subcategories, accounts, savings
    accounts are user-editable lists, not hardcoded.

### 2.3 Added features (not in Excel)
- Dashboard with charts: daily-spend bar, category donut, budget burn-down,
  savings growth, account balance cards, due payment windows, upcoming reminders.
- Budget copy-from-previous-period.
- Global search/filter across all expenses/transfers history.
- One-time Excel import (mature sheets June 25 → June 26 + `data` sheet), idempotent.
- CSV/Excel export of any period.
- Multi-user with JWT auth (registration, login, refresh, per-user data isolation).
- Overspend highlighting (budget exceeded) on dashboard and budget page.

## 3. Architecture

Single Go REST API + Angular SPA + MongoDB (approach approved by user).

```
ribnat/
  backend/      Go 1.22+, Gin, mongo-driver, golang-jwt, excelize (import)
    cmd/server/main.go
    internal/
      config/        env config
      http/          router, middleware (JWT, CORS), handlers
      domain/        models + pure calculation engines (balances, budgets, windows)
      repo/          MongoDB repositories
      service/       use-cases wiring repo + domain
      importer/      Excel workbook importer
  frontend/     Angular 18 standalone, Angular Material, ng2-charts, SCSS
  docs/superpowers/specs/
```

- **Money:** `int64` paisa internally and on the wire (all API money fields are integer
  paisa — no float drift); amount inputs accept taka expressions (`amountExpr`); UI
  formats as BDT (`৳`).
- **Auth:** access token (15 min) + refresh token (7 days), bcrypt password hashes.
- **All queries scoped by `userId`.** Indexes on `(userId, periodId, date)` for
  expenses/transfers.

## 4. Data model (MongoDB collections)

| Collection | Key fields |
|---|---|
| `users` | name, email (unique), passwordHash, createdAt |
| `categories` | userId, name, kind: `expense\|savings\|pay`, subcategories[]{name, active}, active |
| `accounts` | userId, name, kind: `bank\|mobile\|cash\|savings\|virtual`, virtualRole?: `external\|lendGiven\|lendTaken`, active |
| `periods` | userId, name, startDate, endDate, status: `open\|closed`, openingBalances[]{accountId, amount}, openingSavings[]{accountId, amount}, previousPeriodId? |
| `expenses` | userId, periodId, date, categoryId, subcategory, accountId (payment), amount, breakdown[] (ints), remarks |
| `transfers` | userId, periodId, date, fromAccountId, toAccountId, amount, fee, note |
| `budgets` | userId, periodId, items[]{categoryId, subcategory, amount} |
| `lends` | userId, type: `given\|taken`, person, date, amount, settlements[]{date, amount, note}, status: `open\|settled` |
| `payment_windows` | userId, periodId, name, categoryId?, subcategory?, startDate, endDate |
| `reminders` | userId, date, task, done |

Computed (never stored): account balances, in-hand total, budget actuals/remaining,
daily spend series, savings current balances, window statuses. Closing a period
snapshots computed closing balances into the next period's `openingBalances`/
`openingSavings`; reopening is allowed only for the latest period.

## 5. API surface (`/api/v1`)

- `POST /auth/register | /auth/login | /auth/refresh`
- `GET|POST|PUT|DELETE /categories`, `/accounts`
- `GET|POST|PUT /periods`, `POST /periods/{id}/close`, `POST /periods/{id}/reopen`,
  `GET /periods/{id}/summary` (dashboard payload: balances, in-hand, daily series,
  category totals, budget status, window statuses, reminders due)
- `GET|POST|PUT|DELETE /periods/{id}/expenses` (filters: date range, category,
  subcategory, account, text), `/periods/{id}/transfers`
- `GET|PUT /periods/{id}/budget`, `POST /periods/{id}/budget/copy-previous`
- `GET|POST|PUT|DELETE /lends`, `POST /lends/{id}/settle`
- `GET|POST|PUT|DELETE /payment-windows` (per period), `/reminders`
- `POST /import/excel` (multipart upload), `GET /periods/{id}/export?format=csv|xlsx`

Errors: JSON `{error: {code, message}}`; validation errors enumerate fields.

## 6. Frontend

Angular Material sidebar shell (modern professional theme: custom palette, light/dark).
Routes (all lazy, auth-guarded except auth):

1. **Auth** — login / register.
2. **Dashboard** — period selector (persists choice); in-hand card; account balance
   cards; daily-spend bar chart; category donut; budget progress bars with overspend
   highlighting; payment-window status chips; today's/upcoming reminders.
3. **Expenses** — quick-add row (date default today, cascading category→subcategory
   selects, amount field accepting `360+20+330` expressions, remarks); paged, filterable
   table; edit/delete.
4. **Transfers** — same pattern; from/to account selects; fee field.
5. **Budget** — editable table grouped by category, budget vs actual vs remaining,
   cash/non-cash totals, copy-from-previous button.
6. **Lends** — given/taken tabs, settle action with running balance per person.
7. **Savings** — per-account balances and growth chart across periods.
8. **Planner** — payment windows + reminders for the period.
9. **Settings** — categories/subcategories, accounts, profile.
10. **Import** — upload Excel, show import report (created/skipped counts).

The amount-expression parser (`360+20+330` → total + breakdown) is a shared utility
with unit tests; only `+` and `-` of integers/decimals are supported, mirroring Excel use.

## 7. Excel importer

Server-side (excelize), triggered by upload. Steps:
1. `data` sheet → categories/subcategories, accounts, savings accounts (skip existing
   by name).
2. For each mature sheet (June 25 … June 26): create period (start = min date present,
   end = max of daily panel); import expense rows (cols P–U; formula amounts use cached
   values and capture breakdown from the formula text), transfers (cols B–F with fee),
   budget items (budget section), lend register entries, savings/account opening
   balances (from `Start with` column of the earliest imported period only — later
   periods chain by close).
3. Periods are imported oldest→newest and each is closed to compute rollovers; the
   newest stays open.
4. Idempotency: an import run records a content hash per sheet; re-upload skips
   unchanged sheets.
Import report lists per sheet: created expenses/transfers/budget items, warnings
(unknown category names get created and flagged).

## 8. Error handling & edge cases

- Negative/zero amounts rejected except lend settlements and corrective entries
  (Excel had `=0-2000+...` corrections; the app instead supports editing entries).
- Deleting a category/subcategory/account in use → soft-deactivate, never hard delete.
- Closing a period requires all dates ≤ period end; editing entries in a closed period
  forces recompute of all downstream opening balances (chain re-close).
- Custom periods may not overlap for a user; gaps allowed but warned.
- Timezone: dates stored as UTC date-only (no time component semantics).

## 9. Testing

- **Go:** table-driven unit tests for balance engine, budget rollups, window status,
  amount-expression parsing, period close/rollover chain; handler integration tests
  against ephemeral MongoDB (testcontainers or local instance); importer golden test
  against the real `CostSheet (3).xlsx`.
- **Angular:** unit tests for amount-expression parser, period selector state,
  dashboard widget mapping; basic component render tests.

## 10. Out of scope (v1)

Mobile app, bank API sync, multi-currency, shared/household ledgers, notifications
(email/push) — reminders are in-app only.
