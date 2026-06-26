# Ribnat Cost — Angular → Next.js Frontend Rebuild Plan

**Date:** 2026-06-26
**Status:** Phases 1–6 done & verified end-to-end against the live backend (build + typecheck clean; demo data round-trips). Remaining: Playwright/unit tests and final Angular removal at cutover.

**Income model (resolved, risk #1):** the backend has no income concept — income is recorded as a **transfer from the virtual `external` ("Add") account into a real account**. The Transfers tab has an "Add income" action; Insights derives income = period transfers whose source is the external account. Savings-rate = saved ÷ income; the Sankey flows Income → spending categories + saved.
**Goal:** Replace the Angular frontend with a Next.js app that follows the approved Carbon/Orbitax mockup, talking to the **existing Go backend** (unchanged). The Angular app (`CostCalculator/frontend`) stays as reference until parity is reached.

---

## 1. Architecture & decisions

| Area | Decision |
|---|---|
| Location | New app at `CostCalculator/web/` (Angular kept until cutover) |
| Framework | Next.js 14 (App Router) + React 18 + TypeScript |
| Styling | Global CSS + design tokens ported from the mockup. **No Tailwind, no component library** (matches the design system) |
| Server state | TanStack Query (caching, invalidation) |
| Icons | Font Awesome 6 Free (solid) via CDN |
| API | `next.config.mjs` rewrites `/api/*` → `http://localhost:8080`; client always calls same-origin `/api/v1` |
| Money | Backend stores **int64 paisa**; inputs sent as `amountExpr` strings (server parses `360+20+330`); display via `lib/money.ts` (lakh grouping) |
| Auth | JWT access+refresh in `localStorage` (`ribnat.access/refresh/user`); single-flight refresh-on-401; Google via GIS (conditional on backend config) |
| Run | `web-next` launch config (port 3000); backend via `docker compose up -d mongo api`; seed via `web/scripts/seed.mjs` |

**Backend is NOT rebuilt** — it already implements every feature (transfers+fee, per-sub budgets+rollover, lends, planner, recurring, savings, summary/trends, import/export, auth+Google).

---

## 2. Backend API contract (reference)

Base `/api/v1`. Auth: `Bearer` access token; `POST /auth/refresh` rotates.

- **auth:** `GET /auth/config`, `POST /auth/{register,login,google,refresh}`
- **profile:** `GET/PUT /me`, `PUT /me/email`, `PUT /me/password`
- **refdata:** `GET/POST /categories`, `PUT/DELETE /categories/:id`; `GET/POST /accounts`, `PUT /accounts/:id`
- **periods:** `GET/POST /periods`, `PUT /periods/:id`, `POST /periods/:id/{close,reopen}`, `GET /periods/:id/{summary,trends}`, `GET /savings/history`, `GET /periods/:id/export?format=csv`, `GET /template/excel`
- **entries:** `GET/POST /periods/:id/expenses`, `PUT/DELETE …/expenses/:id`; `GET/POST /periods/:id/transfers`, `PUT/DELETE …/transfers/:id`
- **budget:** `GET /periods/:id/budget`, `PUT /periods/:id/budget`, `POST /periods/:id/budget/copy-previous`
- **lends:** `GET/POST /lends`, `POST /lends/:id/settle`, `PUT/DELETE /lends/:id`
- **planner:** `GET/POST /payment-windows`, `PUT/DELETE …/:id`; `GET/POST /reminders`, `PUT/DELETE …/:id`
- **recurring:** `GET/POST /recurring`, `DELETE /recurring/:id`
- **import:** `POST /import/excel`

All wired in `web/lib/api.ts`.

---

## 3. DONE — Phases 1–2 (verified against live backend)

**Foundation (`web/lib`, `web/app`):**
- `types.ts` (domain mirror), `money.ts` (paisa format + `evalAmountExpr`), `api.ts` (full client + refresh), `format.ts` (color/icon/date), `auth.tsx`, `period.tsx`, `toast.tsx`, `providers.tsx`, `layout.tsx` (fonts, FA, theme-flash guard), `globals.css` (entire design system).
- **Components:** `ui.tsx` (Icon, Dropdown, EmptyState, Spinner), `Modal.tsx` (focus trap + Esc + backdrop), `Select.tsx` (keyboard: arrows/Home/End/Enter/Esc/type-ahead, ARIA listbox), `fields.tsx` (AmountInput w/ live ৳ preview, DateField, Field), `AppShell.tsx`, `AuthScaffold.tsx`, `GoogleButton.tsx`, `PageStub.tsx`.

**Screens done:**
- **Login / Register** — real auth round-trip; conditional Google; error states.
- **App shell** — top-nav (active states), period switcher, avatar menu, theme toggle, Details sidebar (period + account balances from `/summary`), mobile bottom-nav, route guard.
- **Dashboard** — KPIs (in-hand, spent, safe-to-spend, net worth), category donut, runway, recent expenses, net-worth trend. Verified: ৳59,725 in-hand etc.
- **Expenses** — filters (search/category/account), data table, add/edit modal (expression amount, dependent subcategory, Save & add another), recurring quick-add, delete, CSV export.
- **Transfers** — ledger, new/edit modal with **Fee/charge**, delete.

**Verified:** all routes compile (200); auth + proxy + Mongo round-trip; money math exact (opening − spend − fee = in-hand).

---

## 4. PENDING — detailed tasks

### Phase 3 — Budget + Insights

**`/budget`** (replaces stub)
- Data: `getBudget(pid)` → `BudgetReport` (`lines[]` per category+subcategory with budget/actual/remaining; `categories[]` rollups; `totals`). Mutations: `putBudget(pid, items, rollover)`, `copyPreviousBudget(pid)`. Actuals from the same report or `/summary`.
- UI: **view mode** — rows grouped by category (category budget = auto-sum of its sub budgets), Spent, Remaining, progress, status (over = red bar + warning icon). Expand a category → per-subcategory budget/spent/remaining mini-rows. **Edit mode** — per-subcategory budget inputs (taka → paisa), category total auto-sums live, grand total live; Save (PUT) / Cancel; **Copy previous** with Undo toast; **Rollover** toggle. Secondary-bar subtabs (This period / Rollover / History — History = read-only past periods if available).
- Guard: warn on navigation with unsaved edits (beforeunload + in-app).
- Acceptance: edit sub → category & grand totals update before save; Save persists & re-fetches; over-budget styled; copy-previous + undo.

**`/insights`** (replaces stub)
- Data: `/summary` (categoryTotals, savings, lendTotals, inHand), `/trends` (series, `comparison[]` current-vs-previous per category).
- UI: insight cards (Income, Spent, Net saved, Savings rate), **cash-flow Sankey** (SVG: Income → category bands + "Saved" band), **month-over-month** category list (from `comparison`, ▲ red / ▼ green), **top subcategories** (group expenses by category+subcategory).
- ⚠️ **Open question (resolve first):** income source. Backend `/summary` has no explicit "income". Determine: `Pay`-kind category totals? sum of opening balances? inflow transfers? — pick the correct definition for Income & Savings-rate. Until resolved, derive income = openingBalances + savings inflows OR show "Income (set pay)".
- Acceptance: Sankey proportional + theme-aware; MoM deltas correct vs previous period; top-subs bars.

### Phase 4 — Lends, Savings, Planner

**`/lends`**
- Data: `listLends({type,status})`, `createLend`, `settleLend(id,{date,amountExpr,note})`, `deleteLend`.
- UI: subtabs All/Given/Taken; table (person, type badge, principal, settled, outstanding, since, status); New-lend modal (type, person, date, amount, notes — **verify exact create fields** incl. whether an account is required); per-row Settle modal; delete; summary (receivable/payable).
- Acceptance: create → row; settle partial → outstanding drops, status `partial`/`settled`; filter works.

**`/savings`**
- Data: `/summary.savings` (AccountStatus + `account.goal`), `savingsHistory()`, `updateAccount(id,{goal})`.
- UI: goal cards (balance, Δ this period = current − opening, goal progress bar when goal set, edit-goal action); savings history chart across periods; "Move to savings" (reuse Transfer modal pre-set to a savings account).
- Acceptance: goal % correct; history renders; transfer into savings updates balance + Δ.

**`/planner`**
- Data: `listWindows(periodId)` → `PaymentWindowWithStatus[]`; `createWindow/updateWindow/deleteWindow`; `listReminders/createReminder/updateReminder/deleteReminder`.
- UI: two columns — Payment windows (add: name, optional category/subcategory, start/end dates; list w/ status chips upcoming/active/expired/paid; delete) + Reminders (add: date, task; list w/ done checkbox; delete).
- Acceptance: window status computed; reminder done toggle persists.

### Phase 5 — Settings, Import/Export

**`/settings`** (tabbed: Profile / Categories / Accounts / Periods / Recurring)
- Profile: edit name+phone (`PUT /me`); change email (`PUT /me/email` w/ password); change password (`PUT /me/password`).
- Categories: list by kind; create (name, kind, subcategories); toggle active; add/rename/toggle subcategories; delete.
- Accounts: list; create (name, kind, goal); toggle active; set savings goal.
- Periods: list w/ status; create (name, start/end, opening balances + savings); close (snapshot) / reopen. Feeds the period switcher.
- Recurring: list; create (label, category, subcategory, account, amount); delete.
- Acceptance: every CRUD persists + refetches; new period appears in switcher; close snapshots balances into next period's opening.

**`/import`**
- Data: `downloadTemplate()` (xlsx blob), `importExcel(file)` → `ImportReport`, `exportCsv(pid)`.
- UI: download template; drag/drop or pick `.xlsx` → upload (progress) → per-sheet report table (counts, warnings); export CSV for current period.
- Acceptance: template downloads; import shows report; CSV exports.

### Phase 6 — cross-cutting polish & cutover
- **A11y:** Confirm dialog component (replace `window.confirm`); keyboard nav for header Dropdown menus; aria-labels on icon buttons; contrast audit on muted text; `prefers-reduced-motion`.
- **States:** loading skeletons; query-error UI + mutation-error toasts (partly done); enforce **closed-period read-only** everywhere.
- **Forms:** inline validation messages (not just red border); required markers.
- **Responsive QA:** 375 / 768 / 1280; bottom-nav; horizontal-scroll tables; modal sizing.
- **Resolve income definition** (blocks Insights savings-rate/Sankey accuracy).
- **Deployment:** add `web/Dockerfile` (`next build` + `next start`); update `docker-compose.yml` to build `./web` (replace the Angular `web` service); set `CORS_ORIGIN`/`API_TARGET`; decide cutover and remove Angular once signed off.
- **Tests:** Playwright smoke (login → add expense → see dashboard update) + a money-format unit test; or a documented manual matrix.
- **Git:** commit per phase; push to `RiBNAT/CostCalculator`.

---

## 5. Definition of done (per screen)
CRUD round-trips against the live backend · light + dark · responsive (375/768/1280) · keyboard-operable · empty + loading + error states · matches the mockup visually.

## 6. Risks / open questions to verify
1. **Income source** for Insights (no explicit endpoint) — define before building the Sankey/savings-rate.
2. **Lend create payload** — confirm exact fields (amount vs amountExpr; account required?).
3. **Budget item amount unit** — paisa assumed (seed worked); confirm display round-trip.
4. **Transfer fee semantics** — backend reduces source by fee but does **not** auto-create an expense (diverges from the mockup); confirm `/summary` treatment and decide if fee should appear as spend.
5. **Google sign-in** needs `GOOGLE_CLIENT_ID` env to fully test.
6. **Period dates in the past** make safe-to-spend = 0 (seed artifact, not a bug).

## 7. Run instructions
```
cd CostCalculator && JWT_SECRET=dev-secret docker compose up -d --build mongo api   # backend :8080 + mongo
cd web && npm install && npm run dev                                                 # frontend :3000
node web/scripts/seed.mjs                                                            # demo data (demo@ribnat.app / demo1234)
```
