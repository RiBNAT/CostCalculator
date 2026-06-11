# Ribnat Cost Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full-stack cost tracker specified in `docs/superpowers/specs/2026-06-12-cost-tracker-design.md` — Go/Gin/MongoDB API with JWT auth and Excel importer, plus an Angular 18 + Material SPA.

**Architecture:** Single Go REST API (`backend/`) with layered packages (`domain` pure logic, `repo` Mongo, `service` use-cases, `http` handlers); Angular SPA (`frontend/`) with standalone components, Material shell, Chart.js dashboards. Money is `int64` paisa server-side.

**Tech Stack:** Go 1.22+, Gin, mongo-driver v2, golang-jwt/v5, bcrypt, excelize/v2; Angular 18, Angular Material, ng2-charts; MongoDB 7.

---

## File structure

```
backend/
  cmd/server/main.go
  internal/config/config.go
  internal/domain/{money.go,expr.go,models.go,balance.go,budget.go,window.go}
  internal/domain/*_test.go
  internal/repo/{mongo.go,users.go,categories.go,accounts.go,periods.go,
                 expenses.go,transfers.go,budgets.go,lends.go,windows.go,reminders.go}
  internal/service/{auth.go,refdata.go,periods.go,entries.go,budgets.go,
                    lends.go,planner.go,summary.go,importer.go,export.go}
  internal/http/{router.go,middleware.go,respond.go,handlers_*.go}
  internal/importer/{importer.go,sheets.go,importer_test.go}
frontend/src/app/
  core/{api.service.ts,auth.service.ts,auth.interceptor.ts,auth.guard.ts,
        period-state.service.ts,models.ts,amount-expr.ts,amount-expr.spec.ts}
  layout/shell.component.ts
  features/{auth,dashboard,expenses,transfers,budget,lends,savings,planner,settings,import}/
docker-compose.yml, backend/Dockerfile, frontend/Dockerfile, README.md
```

### Task 1: Backend scaffold + config + health endpoint
- [ ] `go mod init ribnat/backend`; add gin, mongo-driver, jwt, bcrypt, excelize, testify
- [ ] `internal/config/config.go`: env vars `PORT(8080) MONGO_URI MONGO_DB(ribnat) JWT_SECRET CORS_ORIGIN`
- [ ] `internal/http/router.go` with `GET /api/v1/health` → `{"status":"ok"}`; `respond.go` helpers `OK/Created/Err` writing `{error:{code,message}}`
- [ ] `cmd/server/main.go` wiring config→mongo→router; `go build ./...` passes; commit

### Task 2: Money + amount-expression parser (TDD)
- [ ] `domain/expr_test.go`: `"360+20+330+30"`→74000 paisa & breakdown `[36000,2000,33000,3000]`; `"15.5"`→1550; `"100-25"`→7500; rejects `"abc"`, empty, `*`
- [ ] `domain/expr.go`: `ParseAmountExpr(s string) (total int64, parts []int64, err error)` — only `+ -` of decimals (≤2dp)
- [ ] `domain/money.go`: `FormatTaka(int64) string`, `TakaToPaisa(float64) int64` (round half-up); tests pass; commit

### Task 3: Domain models + Mongo repos
- [ ] `domain/models.go`: structs per spec §4 (User, Category{Sub []Subcategory}, Account{Kind, VirtualRole}, Period{OpeningBalances []AccountAmount, Status}, Expense{Breakdown []int64}, Transfer, Budget{Items []BudgetItem}, Lend{Settlements}, PaymentWindow, Reminder) with bson/json tags; all amounts int64 paisa; dates `time.Time` UTC date-only
- [ ] `repo/mongo.go`: connect, ensure indexes — users.email unique; (userId,periodId,date) on expenses/transfers; (userId,name) unique on categories/accounts/periods
- [ ] One repo file per collection with typed CRUD (`Insert/Update/Delete/ByID/List(filter)`) always filtering `userId`; `go vet ./...`; commit

### Task 4: Auth (register/login/refresh, JWT middleware)
- [ ] `service/auth.go` tests: register hashes password & rejects dup email; login wrong pw fails; refresh rotates
- [ ] Implement: bcrypt(cost 12); access JWT 15m `{sub,email}`, refresh 7d `{sub,typ:"refresh"}` HS256
- [ ] `http/middleware.go`: `Auth()` reads `Authorization: Bearer`, sets `userID` in context; `http/handlers_auth.go`: POST register/login/refresh
- [ ] Manual verify with curl; commit

### Task 5: Reference data (categories, accounts) + default seed
- [ ] CRUD endpoints `/categories` `/accounts`; delete = soft `active:false` if referenced
- [ ] `service/refdata.go` `SeedDefaults(userID)` on register: spec §2.1 lists (8 categories with subs; accounts Cash,SCB,SBL,EXIM,bKash,Nagad,City + virtual Add/LendGiven/LendTaken + 5 savings accounts kind=savings)
- [ ] Handler test: register → list categories returns 8; commit

### Task 6: Periods CRUD
- [ ] POST/GET/PUT `/periods`; reject overlapping date ranges per user (test); `previousPeriodId` = latest period with `endDate < startDate`
- [ ] New period defaults `openingBalances` from previous period's computed closing (0s if first); status `open`; commit

### Task 7: Expenses + Transfers CRUD
- [ ] `/periods/{id}/expenses` CRUD; create accepts `amountExpr` string OR numeric `amount` (taka) → ParseAmountExpr; validates date within period (warn-only field `outOfPeriod` if not), category/subcategory exist, account active; filters: from,to,categoryId,subcategory,accountId,q (remarks regex)
- [ ] `/periods/{id}/transfers` CRUD: from≠to, amount>0, fee≥0
- [ ] Handler tests for create+filter+update+delete both; commit

### Task 8: Balance engine (TDD) + financial status
- [ ] `domain/balance_test.go`: table test mirroring Excel June 26 — opening + transfers in − (out+fee) − expenses-by-account; in-hand = liquid kinds (cash,bank,mobile) only; LendGiven balance grows with transfers to it
- [ ] `domain/balance.go`: `ComputeBalances(opening map[ID]int64, transfers []Transfer, expenses []Expense) map[ID]int64` + `InHand(balances, accounts)`
- [ ] `GET /periods/{id}/status` returns per-account {opening,current} + inHand; commit

### Task 9: Budgets + rollup engine
- [ ] `domain/budget.go` + test: `BudgetReport(items, expenses, accounts)` → per-subcategory {budget,actual,remaining}, per-category rollup, totals {all,cash,nonCash} (cash = expenses paid from kind=cash)
- [ ] `GET/PUT /periods/{id}/budget`; `POST /periods/{id}/budget/copy-previous`; commit

### Task 10: Period close/reopen + rollover chain
- [ ] Test: close P1 → P2.openingBalances = P1 closing (incl. savings via Savings-category expenses added to savings accounts); editing entry in closed period → 409 unless reopened; only latest period reopenable; closing recomputes downstream chain
- [ ] `service/periods.go` implements `Close/Reopen/RecomputeChain`; commit

### Task 11: Lends + settle
- [ ] `/lends` CRUD + `POST /lends/{id}/settle {date,amount,note}`; status→settled when Σsettlements ≥ amount; `GET /lends?status=open&type=given` summary per person; test partial settle (1000, settle 585 → remaining 415); commit

### Task 12: Payment windows + reminders + status engine
- [ ] `domain/window_test.go` (fixed `now`): before start → `upcoming(in N days)`; within → `active(N left)`; after → `expired`; matching expense in window for linked subcategory → `paid`
- [ ] `domain/window.go` `WindowStatus(w, expenses, today)`; CRUD `/payment-windows` (per period) and `/reminders` (+done toggle); commit

### Task 13: Period summary endpoint
- [ ] `GET /periods/{id}/summary` → {period, balances+inHand, dailySeries:[{date,weekday,total}] for every day in range, categoryTotals, budgetReport, windows with statuses, reminders due in period, lendTotals{given,taken}}
- [ ] Handler test asserts shape and daily series covers full range incl. zero days; commit

### Task 14: Excel importer
- [ ] `internal/importer`: parse `data` sheet → refdata names; mature sheets (`June 25`…`June 26`, detected by `P2=="Date" && Q2=="Category"` header) → expenses (P:U, cached formula values via excelize `CalcCellValue` fallback to raw + breakdown from formula text), transfers (B:F, skip `Add` rows → income transfers from virtual external account; fee from C), budget items (rows under `B  U  D  G  E  T` block), lends (LEND GIVEN/TAKEN blocks), first period opening balances from `Start with` (N col)
- [ ] Sequence periods oldest→newest, close all but last; idempotency via sha256(sheet) stored in `imports` collection
- [ ] Golden test against `CostSheet (3).xlsx` (copied to `internal/importer/testdata/`): June 26 expense count > 0, SCB present, budget items == 27, period dates 2026-05-22..2026-06-26
- [ ] `POST /import/excel` multipart → report {sheets:[{name,created:{...},skipped,warnings}]}; commit

### Task 15: Export + CORS + compose
- [ ] `GET /periods/{id}/export?format=csv` streams expenses+transfers CSV
- [ ] CORS middleware from config; request logging; `docker-compose.yml` (mongo + api + web), backend Dockerfile; `go test ./...` green; commit

### Task 16: Angular scaffold + theme + shell
- [ ] `npx @angular/cli@18 new frontend --style=scss --routing --standalone --skip-git`; add @angular/material (custom theme: indigo-violet palette, light), ng2-charts chart.js
- [ ] `layout/shell.component.ts`: sidenav (Dashboard/Expenses/Transfers/Budget/Lends/Savings/Planner/Settings/Import), topbar with period selector + user menu; routes lazy + `authGuard`
- [ ] `core/`: `models.ts` mirroring API; `api.service.ts` typed HttpClient wrapper (`/api/v1`, env-based base URL); `auth.service.ts` (tokens in localStorage, refresh on 401 via interceptor); `period-state.service.ts` (signal of selected period, persisted)
- [ ] `ng build` passes; commit

### Task 17: Auth pages
- [ ] Login + register cards (reactive forms, Material), error display, redirect to dashboard; guard redirects unauthenticated → /login; commit

### Task 18: Amount expression util (TDD)
- [ ] `core/amount-expr.spec.ts` mirrors backend cases; `core/amount-expr.ts` `parseAmountExpr(s): {total, parts} | null`; `ng test` headless green; commit

### Task 19: Expenses page
- [ ] Quick-add bar: date (default today), category select → subcategory select (cascading), payment account, amount input (expression-aware, shows computed total), remarks; submit → POST with `amountExpr`
- [ ] Filterable paged table (date, category, sub, account chips, amount right-aligned ৳, remarks, edit/delete row menu); filter bar (range, category, account, text); commit

### Task 20: Transfers page
- [ ] Same pattern: from/to selects (validate ≠), amount, fee, note; table; commit

### Task 21: Dashboard
- [ ] Widgets fed by `/summary`: in-hand hero card; account balance cards grid; daily-spend bar chart; category donut; budget progress bars (red when over); payment-window chips (color by status); reminders list; lend totals card; commit

### Task 22: Budget page
- [ ] Grouped editable table by category (subcategory rows: budget input, actual, remaining w/ overspend red); footer totals all/cash/non-cash; "Copy from previous period" button; save via PUT; commit

### Task 23: Lends page
- [ ] Tabs Given/Taken; cards per person with outstanding; add lend dialog; settle dialog (date, amount, note); settled history expandable; commit

### Task 24: Savings page
- [ ] Table of savings accounts: opening, deposits this period, current; line chart of total savings across periods (`/reports` data assembled client-side from period statuses); commit

### Task 25: Planner page
- [ ] Payment windows list with status chips + add/edit dialog (name, linked subcategory, start, end); reminders list with done checkbox + add dialog; commit

### Task 26: Settings page
- [ ] Categories manager (add/rename/deactivate category & subcategory chips); accounts manager (kind badges); profile (name, change password); commit

### Task 27: Import page + README + final verification
- [ ] Upload card (drag/drop xlsx) → POST `/import/excel`, render per-sheet report table with warnings
- [ ] README: run instructions (compose + dev mode), API overview, screenshots placeholder-free description
- [ ] Full verification: `go test ./...`, `ng build --configuration production`, manual smoke via compose; commit

## Self-review
- Spec coverage: §2.2 items 1–10 → Tasks 7,7,8,6/13,9,11,10/24,12,12,5. §2.3 adds → Tasks 21,9,7(filters),14,15,4,22. ✔
- No placeholder steps; engines have explicit test fixtures. ✔
- Type names consistent: `ParseAmountExpr`/`parseAmountExpr`, `ComputeBalances`, `BudgetReport`, `WindowStatus` used uniformly. ✔
