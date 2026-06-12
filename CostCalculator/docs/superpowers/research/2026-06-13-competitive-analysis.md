# Cost Calculator — Competitive Analysis & Improvement Roadmap

**Date:** 2026-06-13
**Status:** Informed analysis. The deep-research workflow gathered 23 sources / 106
claims across 5 angles, but its adversarial verification step was cut short by a
session rate limit, so claims are **not** independently fact-checked here. Treat
app-specific feature attributions as "widely reported / from official docs," not
verified. Re-run verification after the limit resets to harden it.

## Apps surveyed

| App | Model / standout traits relevant to us |
|-----|----------------------------------------|
| **YNAB** | Zero-based "give every dollar a job" envelope budgeting; deliberate manual entry; category rollover; no forecasting. |
| **Monarch Money** | Customizable widget dashboard; Flex budgeting (fixed / flexible / non-monthly); goals; net worth; household sharing. |
| **Rocket Money** | "Safe to Spend" cash-flow framing; subscription/bill tracking + negotiation. |
| **Copilot Money** | AI auto-categorization; polished, fast UX. |
| **PocketGuard** | "In My Pocket" = income − bills − goals − spent → *what's left to spend*. |
| **Spendee** | Shared wallets; cash + bank; attractive charts. |
| **Wallet (BudgetBakers)** | Reported to track **bKash / Nagad / Rocket** (BD mobile money); shared accounts; multi-currency. |
| **Goodbudget** | Digital envelopes; manual; multi-device household sync. |
| **Money Manager / Money Lover** | Receipt capture; asset-account "double record"; home-screen widgets. |
| **Actual Budget** (OSS, local-first) | Envelope/zero-based; **per-category rollover** + "month ahead / hold for next month"; own-your-data. |
| **Firefly III** (OSS) | Double-entry; **rules engine** for auto-categorization; recurring transactions; piggy-bank savings goals. |
| **Maybe** (OSS) | Net-worth-centric. |
| **Walnut** (India) | **SMS auto-capture** — parses bank/wallet transaction SMS into expenses. |
| **ezBookkeeping** (OSS) | Broad chart types incl. **Sankey** flow + radar; native mobile pages. |

## (A) Where Cost Calculator is strong vs. where it lags

### Genuinely strong / differentiated
- **Salary-cycle periods with balance chaining.** Almost every mainstream app is
  locked to calendar months. Modeling the actual pay cycle (opening → closing →
  next period's opening) matches how a salaried household in BD actually thinks.
- **Cash + mobile-money + virtual lending accounts as first-class.** Western apps
  assume bank-linked accounts; cash and bKash/Nagad are the real money rails here.
- **Lending tracker with partial settlements.** Informal personal lending is a
  South-Asia reality that mainstream apps handle poorly or not at all.
- **Integer-paisa money + arithmetic-expression entry** ("360+20+330"). No float
  drift, and expression entry is *faster* than the single-number fields most apps use.
- **Excel import/template + CSV export.** Smooths migration from the spreadsheet world.
- **Planner (payment windows + reminders)** and the new **trend charts** + Google login.

### Where it lags (gap → who does it well)
- **No fast capture / no mobile app or SMS parsing** → Walnut. Manual entry is the
  single biggest friction for a cash/mobile-money user.
- **No forward "safe to spend" runway** → PocketGuard, Rocket. All current metrics
  are backward-looking (spent, in-hand).
- **No recurring/scheduled auto-expenses** (rent, utilities, cash-out fees) → Firefly, most.
- **No auto-categorization / rules** → Firefly (rules), Copilot (AI).
- **No per-category budget rollover** (envelope behavior) → YNAB, Actual.
- **No savings goals** → Monarch, Firefly piggy banks.
- **No net-worth view** (assets + savings − owed + receivable) → Monarch, Maybe.
- **Web-only; likely not installable/offline** → most have PWA/native, important in
  a mobile-first market.
- **Limited household sharing; no 2FA / security settings** → Monarch, Goodbudget.

## (B) Prioritized feature recommendations

Effort = build cost; Impact = user value. ★ = strong fit for the
salary-cycle + cash/mobile-money + Bangladesh context.

### Do first — high impact, low/medium effort
1. **"Safe to spend" daily runway ★** — `remaining in-hand (or budget) ÷ days left
   in period`. Tiny compute on existing summary data; turns the dashboard
   forward-looking. *Impact: High · Effort: Low.*
2. **Quick-add accelerators ★** — default to last-used account, surface frequent
   subcategories, "save & add another", "repeat last expense". Builds on the existing
   FAB. *Impact: High · Effort: Low.*
3. **Recurring / scheduled expenses ★** — templates for rent, utilities, bKash
   cash-out fee; one-tap or auto-create at period start. *Impact: High · Effort: Med.*
4. **Per-category budget rollover** — optional "carry unspent Bazar into next period,"
   reusing the period-chaining you already have. *Impact: Med-High · Effort: Med.*

### Next — medium
5. **Savings goals** — target + progress bar per savings account. *Med / Med.*
6. **Net-worth-over-time** — extend the new 12-period trend to assets − owed +
   receivable. Data already exists. *Med / Low-Med.*
7. **Bill/subscription view** — surface upcoming recurring outflows (extends planner). *Med / Med.*
8. **PWA: installable + offline-first ★** — manifest + service worker + mobile
   bottom-nav. Big adoption lever in a mobile-first market. *High / Med.*

### Strategic / larger bets
9. **SMS transaction auto-capture ★ (mobile app)** — Android app reads bKash/Nagad/
   bank SMS and proposes pre-filled expenses. The biggest differentiator for this
   market (cf. Walnut), but it's a new platform. *Impact: High · Effort: High.*
10. **Rules / auto-categorization** — Firefly-style "if remarks contains X → category Y." *Med-High.*
11. **Household sharing / multi-user** — shared periods/accounts; touches the data
    model + auth. *High.*
12. **2FA + session/device management** in Settings. *Med.*

### Skip (YAGNI for this audience)
- Multi-currency, bank-aggregation/Plaid-style linking (no consumer API for
  bKash/Nagad; SMS parsing is the realistic path), bill-negotiation.

## (C) UI/UX improvements (best-practice grounded)

- **Add a forward metric to the dashboard hero.** Everything shown is backward-looking;
  a "safe to spend / days-left runway" card reframes toward decisions.
- **Don't signal by color alone.** Over-budget is red-only today — add an icon/label
  (WCAG; color-blind users). You already add `aria-label`s on charts — good; extend
  the discipline.
- **Bangladeshi digit grouping.** Large amounts should group as `12,34,567` (lakh/crore),
  not `1,234,567`. Sharp locale win; you already use `tabular-nums`.
- **Lean into expression entry.** It's a real strength — add a subtle hint/affordance
  and keyboard submit; pair with "save & add another" for batch entry.
- **Empty states as onboarding.** The "No periods yet → Import your Excel" hint is
  the right pattern; extend it to budget, lends, and planner with a clear primary
  action (and maybe a "load sample data" path).
- **Mobile.** Verify the dashboard grids collapse cleanly; make it installable; add a
  mobile bottom-nav. Most BD users are phone-first.
- **Consider a Sankey/flow chart** ("income → categories → accounts") for the "where
  did the money go" question — high signal for a *cost* tracker (cf. ezBookkeeping).
  Keep the current correct chart-to-data matching (bar=time, donut=distribution).
- **Trust signals.** Security copy near auth, the Google button (added), and a
  Settings section for 2FA/sessions raise perceived trust for a finance app.

## Source quality note
Primary-source claims (Actual Budget docs, Firefly III, ezBookkeeping, Maybe GitHub)
are reliable; market/secondary claims (SimilarWeb top-apps, Dhaka Tribune on Wallet
supporting bKash/Nagad, app-comparison blogs) should be re-verified before quoting
externally — automated verification did not complete this run.
