# Statement / Year-in-Review Report — Design

**Date:** 2026-06-29
**Status:** Approved (design); mockup updated and verified
**Visual reference:** `CostCalculator/docs/mockups/carbon/index.html` — Insights → "Download report" (2-step wizard) and the statement preview.

## Goal

Let the user generate a printable financial statement over a chosen time range, with selectable sections, exported as a PDF via the browser's print-to-PDF.

## Decisions (from brainstorming)

- **PDF method:** browser print-to-PDF. A print-styled statement view + a "Save as PDF" button calling `window.print()`. No PDF library, no server PDF rendering. Reuses existing SVG/CSS.
- **Time range:** Month / Year / custom Date range — all resolve to a `from`/`to` calendar span. Aggregation is by transaction date across whatever salary cycles the span touches.
- **Sections (user-selectable; defaults):** Summary KPIs ✅, Income & spending ✅, Category breakdown ✅, Savings ✅, **Period breakdown ✅**, Lends ☐ (opt-in).
- **Flow:** Insights → **Download report** → 2-step dialog: **Step 1 Time range** (segmented Month/Year/Date range) → **Next** → **Step 2 Sections** (checkboxes, defaults pre-checked) → **Done/Download** → opens the print view and fires the print dialog.

## Backend

New read endpoint: `GET /api/v1/statement?from=YYYY-MM-DD&to=YYYY-MM-DD` → `StatementReport` (JSON). The frontend computes nothing financial; it only toggles which returned sections to render/print.

New service method `Summary.Statement(ctx, userID, from, to)` reusing existing conventions (income = transfers from the virtual `external` account; spent = Σ expenses; savings deposits = expenses whose subcategory equals a savings-account name, per `domain.SavingsBalances`):

`StatementReport`:
- `from`, `to`
- `kpis`: `{ totalIncome, totalSpent, netSaved, savingsRatePct }` (paisa; rate is int %)
- `categories`: `[{ categoryId, name, total }]` (desc by total)
- `topSubcategories`: `[{ categoryId, name, subcategory, total }]`
- `savings`: `[{ accountId, name, deposited }]`
- `lends`: `{ givenOutstanding, takenOutstanding, settledInRange }`
- `periods`: `[{ periodId, name, start, end, income, spent, saved }]` for cycles overlapping the range (income/spent restricted to the range ∩ cycle)

Data access: query expenses/transfers by `{ userId, date: { $gte: from, $lte: to } }`. Add a `{ userId, date }` index so the range scan is efficient (existing indexes are `{userId, periodId, date}`, which can't serve `{userId, date}` alone).

Auth: behind `AuthRequired` like every other `/api/v1` route; all queries scoped by `userId`.

## Frontend (Next.js `web/`)

1. **Entry point** — a "Download report" button in the Insights breadcrumb actions (beside Export CSV).
2. **Wizard dialog** (`components/ReportDialog.tsx`, using the existing `Modal`):
   - Step 1: segmented Month / Year / Date range. Month → month+year selects; Year → year select; Date range → from/to date inputs. Resolves to `{from, to}` (ISO). "Next".
   - Step 2: section checkboxes with the defaults above. "Back" / "Download".
   - On Download: navigate to `/statement?from=&to=&sections=kpis,income,...` (new tab) and the page auto-triggers print.
3. **Print route** `web/app/statement/page.tsx` (outside the `(app)` shell): client component, reads query params, `useQuery(api.statement(from,to))`, renders the selected sections in a print-optimized layout (header with user name + range + generated date, KPI grid, category bars, period table, savings table, lends table), a "Save as PDF" button (`window.print()`), and a "Back" link.
4. **Print CSS** (`globals.css` `@media print`): hide nav/buttons, white background, sensible margins, `break-inside: avoid` on sections.
5. **API client**: `api.statement(from, to)` in `lib/api.ts`; `StatementReport` type added (hand-written aggregate type, consistent with the Phase 3a codegen split — entities generated, response aggregates hand-kept).

## Error / edge cases

- Empty range (no activity) → statement still renders with zeros and a "No activity in this range" note; remains printable.
- No income in range → savings rate shows "—"; income/spending bars handle divide-by-zero.
- Invalid/missing `from`/`to` → 400 from the endpoint; the print page shows an error state with a link back.
- `to` before `from` → 400.

## Testing

- Backend: integration test for `Summary.Statement` over a 2-period range using the existing Mongo harness — assert KPIs, category split, and per-period rows (income/spent/saved) for a range that partially overlaps one cycle.
- Backend: empty-range test returns zeroed report, 200.
- Frontend: `tsc --noEmit` + `npm run build`; manual print-preview verification of section toggles.

## Out of scope (v1)

- Raw transaction appendix (CSV export already covers line items).
- Server-generated or emailed PDFs.
- Saved/scheduled reports.
