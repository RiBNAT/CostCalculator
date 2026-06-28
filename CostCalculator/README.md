# Cost Calculator — Personal Cost Tracker

A self-hosted web application that replaces the `CostSheet` Excel workbook: daily expense
tracking by category, inter-account transfers with fees, salary-cycle periods with balance
rollover, budgets vs actuals, lending registers, savings tracking, recurring-bill payment
windows and reminders — with a one-time importer for the original workbook.

**Stack:** Go (Gin) · MongoDB 7 (single-node replica set) · Next.js 14 (App Router, React) · httpOnly cookie auth · Docker

## Quick start (Docker)

```bash
docker compose up --build
# web: http://localhost:3000   api: http://localhost:8080/api/v1/health
```

Register an account (default categories/accounts from the workbook are seeded
automatically), then upload `CostSheet (3).xlsx` on the **Import** page to migrate all
history from June 25 onward.

## Development

```bash
# MongoDB (single-node replica set rs0 — required for transactions)
docker compose up -d mongo

# API  (http://localhost:8080)
cd backend && go run ./cmd/server

# Web  (http://localhost:3000, Next proxies /api/* to the API — see next.config.mjs)
cd web && npm run dev
```

### Tests

```bash
# Backend: connect with directConnection so transactions work against the single-node RS
cd backend && MONGO_URI='mongodb://localhost:27017/?directConnection=true' go test ./...

# Frontend: typecheck + production build
cd web && npx tsc --noEmit && npm run build

# Type drift: regenerate TS types from Go and fail if out of date
cd backend && ./tools/check-types.sh
```

The importer golden test and the API/transaction tests use the local MongoDB and are
skipped automatically when it is not running.

## Architecture

```
backend/
  cmd/server            entrypoint
  internal/config       env config (PORT, MONGO_URI, MONGO_DB, JWT_SECRET, CORS_ORIGIN)
  internal/domain       pure logic: money (int64 paisa), amount expressions ("360+20+330"),
                        balance engine, budget rollups, payment-window status
  internal/repo         MongoDB collections, indexes, generic CRUD helpers
  internal/service      auth (JWT + bcrypt), seeding, period close/rollover chain, summary
  internal/http         Gin router, middleware, handlers (REST /api/v1)
  internal/importer     CostSheet workbook importer (excelize), idempotent per sheet
  tools/                tygo config + gen/check scripts (Go structs -> web/lib/types.gen.ts)
web/
  app/                  App Router: (app) route group (dashboard, expenses, transfers,
                        budget, insights, lends, savings, planner, settings, import),
                        plus login/register
  components/           AppShell, Modal, fields, ui (incl. ErrorState), Select
  lib/                  fetch client (cookie auth), auth/period/toast/confirm providers,
                        money + amount-expression helpers, generated + hand types
```

### Key concepts

- **Periods** are custom date ranges (salary cycles, e.g. 22 May – 26 June). Closing a
  period snapshots account balances into the next period's opening balances; the chain
  recomputes automatically when earlier data changes. Only the latest period can be
  reopened.
- **Money** is stored as `int64` paisa everywhere in the API; the UI accepts Excel-style
  sum expressions (`360+20+330`) and preserves the breakdown.
- **Accounts** include real ones (Cash, banks, bKash/Nagad) and virtual ones
  (`Add` = income source, `LendGiven`, `LendTaken`) so the transfer ledger mirrors the
  workbook's Transaction & Pay section.
- **Payment windows** replace the workbook's `DATESTATUS()` constraints: each window is
  Upcoming / Active / Expired, or Paid when a matching expense lands inside it.

## API overview

`POST /api/v1/auth/{register,login,refresh,logout,google}` (sets/clears httpOnly cookies) ·
`/categories` `/accounts` CRUD ·
`/periods` CRUD + `/close` `/reopen` `/repair` `/status` `/summary` `/export?format=csv` ·
`/savings/history` (total savings per period, one call) ·
`/periods/{id}/expenses` `/periods/{id}/transfers` CRUD with filters ·
`/periods/{id}/budget` (+ `/copy-previous`) ·
`/lends` CRUD + `/settle` ·
`/payment-windows` `/reminders` CRUD ·
`POST /import/excel` (multipart)

All money fields are integer paisa. Errors use `{"error":{"code","message"}}` with
human-readable messages. Expense and transfer dates must fall inside their period's
date range.

**Production note:** when `GIN_MODE=release`, the server refuses to start with a
missing or placeholder `JWT_SECRET`.
