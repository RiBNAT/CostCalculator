# Ribnat — Personal Cost Tracker

A self-hosted web application that replaces the `CostSheet` Excel workbook: daily expense
tracking by category, inter-account transfers with fees, salary-cycle periods with balance
rollover, budgets vs actuals, lending registers, savings tracking, recurring-bill payment
windows and reminders — with a one-time importer for the original workbook.

**Stack:** Go 1.22+ (Gin) · MongoDB 7 · Angular 18 + Material · JWT auth · Docker

## Quick start (Docker)

```bash
docker compose up --build
# web: http://localhost:8081   api: http://localhost:8080/api/v1/health
```

Register an account (default categories/accounts from the workbook are seeded
automatically), then upload `CostSheet (3).xlsx` on the **Import** page to migrate all
history from June 25 onward.

## Development

```bash
# MongoDB
docker run -d --name ribnat-mongo -p 27017:27017 mongo:7

# API  (http://localhost:8080)
cd backend && go run ./cmd/server

# Web  (http://localhost:4200, proxies API via environment.development.ts)
cd frontend && npx ng serve
```

### Tests

```bash
cd backend && go test ./...          # domain engines, auth, API flow, importer golden test
cd frontend && npx ng test --watch=false --browsers=ChromeHeadless
```

The importer golden test and the API flow test use the local MongoDB and are skipped
automatically when it is not running.

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
frontend/src/app
  core/                 typed API client, auth (interceptor/guard), period state,
                        amount-expression parser, BDT money pipe
  layout/               app shell (sidenav + period selector)
  features/             dashboard, expenses, transfers, budget, lends, savings,
                        planner, settings, import
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

`POST /api/v1/auth/{register,login,refresh}` ·
`/categories` `/accounts` CRUD ·
`/periods` CRUD + `/close` `/reopen` `/status` `/summary` `/export?format=csv` ·
`/periods/{id}/expenses` `/periods/{id}/transfers` CRUD with filters ·
`/periods/{id}/budget` (+ `/copy-previous`) ·
`/lends` CRUD + `/settle` ·
`/payment-windows` `/reminders` CRUD ·
`POST /import/excel` (multipart)

All money fields are integer paisa. Errors use `{"error":{"code","message"}}`.
