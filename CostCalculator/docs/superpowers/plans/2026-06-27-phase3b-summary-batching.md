# Phase 3b — Summary Query Batching (N+1 fix)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the per-period query fan-out in `service/summary.go` so `SavingsHistory` and `Trends` issue a constant number of MongoDB queries instead of growing with the number of periods, with no change to their output.

**Architecture:** Today `ClosingBalances` re-fetches expenses, transfers, and accounts on every call, and `SavingsHistory`/`Trends` call it inside a per-period loop (≈3N queries for N periods, plus more in `Trends`). Introduce a prefetch step that loads all of a user's expenses, transfers, and accounts once, groups expenses/transfers by `periodId` in memory, and a pure `ClosingBalancesFrom` variant that computes from the prefetched maps. Rewrite `SavingsHistory` and `Trends` to prefetch once. `Build` (single period) keeps its existing path. Behavior is identical — only the query count drops.

**Tech Stack:** Go 1.26 + mongo-driver v1.17. Money is int64 paisa.

**Correctness guard:** `TestAPIFlow` already asserts savings-history length and summary numbers; this refactor must keep the full suite green. Task 3 adds a focused multi-period test pinning the batched results.

---

### Task 1: Prefetch helper + `ClosingBalancesFrom`

**Files:**
- Modify: `CostCalculator/backend/internal/service/periods.go`

- [ ] **Step 1: Add a grouping helper and a prefetched closing-balances variant**

In `CostCalculator/backend/internal/service/periods.go`, add these functions (place them after `ClosingBalances`):

```go
// periodData holds a user's movement documents grouped by period for batch
// computation, plus the account list (fetched once).
type periodData struct {
	accounts        []domain.Account
	savingsAccounts []domain.Account
	expensesByPid   map[string][]domain.Expense
	transfersByPid  map[string][]domain.Transfer
}

// LoadPeriodData fetches all of a user's expenses, transfers, and accounts in
// three queries and groups the movements by period id.
func (p *Periods) LoadPeriodData(ctx context.Context, userID string) (*periodData, error) {
	expenses, err := repo.FindAll[domain.Expense](ctx, p.DB.Expenses, bson.M{"userId": userID})
	if err != nil {
		return nil, err
	}
	transfers, err := repo.FindAll[domain.Transfer](ctx, p.DB.Transfers, bson.M{"userId": userID})
	if err != nil {
		return nil, err
	}
	accounts, err := repo.FindAll[domain.Account](ctx, p.DB.Accounts, bson.M{"userId": userID})
	if err != nil {
		return nil, err
	}
	pd := &periodData{
		accounts:       accounts,
		expensesByPid:  map[string][]domain.Expense{},
		transfersByPid: map[string][]domain.Transfer{},
	}
	for _, e := range expenses {
		pd.expensesByPid[e.PeriodID] = append(pd.expensesByPid[e.PeriodID], e)
	}
	for _, t := range transfers {
		pd.transfersByPid[t.PeriodID] = append(pd.transfersByPid[t.PeriodID], t)
	}
	for _, a := range accounts {
		if a.Kind == domain.AccountSavings {
			pd.savingsAccounts = append(pd.savingsAccounts, a)
		}
	}
	return pd, nil
}

// ClosingBalancesFrom computes a period's (accountBalances, savingsBalances)
// from prefetched data — no DB access. Mirrors ClosingBalances exactly.
func (pd *periodData) ClosingBalancesFrom(period *domain.Period) (map[string]int64, map[string]int64) {
	expenses := pd.expensesByPid[period.ID]
	transfers := pd.transfersByPid[period.ID]

	opening := map[string]int64{}
	for _, ob := range period.OpeningBalances {
		opening[ob.AccountID] = ob.Amount
	}
	balances := domain.ComputeBalances(opening, transfers, expenses)

	openingSav := map[string]int64{}
	for _, os := range period.OpeningSavings {
		openingSav[os.AccountID] = os.Amount
	}
	savings := domain.SavingsBalances(openingSav, pd.savingsAccounts, expenses)
	return balances, savings
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd CostCalculator/backend && go build ./...`
Expected: clean (helpers unused so far — that's fine; the build checks signatures).

- [ ] **Step 3: Commit**

```bash
git add CostCalculator/backend/internal/service/periods.go
git commit -m "feat(summary): prefetch helper and pure ClosingBalancesFrom variant"
```

---

### Task 2: Batch `SavingsHistory` and `Trends`

**Files:**
- Modify: `CostCalculator/backend/internal/service/summary.go`

- [ ] **Step 1: Rewrite `SavingsHistory` to prefetch once**

In `CostCalculator/backend/internal/service/summary.go`, replace the `SavingsHistory` method body:

```go
// SavingsHistory returns the total savings balance at the end of every period,
// oldest first — prefetches all movement data in a constant number of queries.
func (s *Summary) SavingsHistory(ctx context.Context, userID string) ([]SavingsHistoryPoint, error) {
	periods, err := repo.FindAll[domain.Period](ctx, s.DB.Periods, bson.M{"userId": userID})
	if err != nil {
		return nil, err
	}
	sortPeriodsByStart(periods)
	pd, err := s.Periods.LoadPeriodData(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]SavingsHistoryPoint, 0, len(periods))
	for i := range periods {
		_, savings := pd.ClosingBalancesFrom(&periods[i])
		var total int64
		for _, v := range savings {
			total += v
		}
		out = append(out, SavingsHistoryPoint{
			PeriodID: periods[i].ID, PeriodName: periods[i].Name,
			StartDate: periods[i].StartDate, Total: total,
		})
	}
	return out, nil
}
```

- [ ] **Step 2: Rewrite the `Trends` series loop to use prefetched data**

In `CostCalculator/backend/internal/service/summary.go`, inside `Trends`, replace the accounts fetch + series loop. Replace this block:

```go
	accounts, err := repo.FindAll[domain.Account](ctx, s.DB.Accounts, bson.M{"userId": userID})
	if err != nil {
		return nil, err
	}

	out := &PeriodTrends{}
	for i := start; i <= sel; i++ {
		spend, err := s.periodSpend(ctx, userID, periods[i].ID)
		if err != nil {
			return nil, err
		}
		balances, savings, err := s.Periods.ClosingBalances(ctx, &periods[i])
		if err != nil {
			return nil, err
		}
		var saved int64
		for _, v := range savings {
			saved += v
		}
		out.Series = append(out.Series, TrendPoint{
			PeriodID: periods[i].ID, PeriodName: periods[i].Name,
			StartDate: periods[i].StartDate, TotalSpend: spend, TotalSaved: saved,
			NetWorth: domain.InHand(balances, accounts) + saved,
		})
	}
```

with:

```go
	pd, err := s.Periods.LoadPeriodData(ctx, userID)
	if err != nil {
		return nil, err
	}
	accounts := pd.accounts

	out := &PeriodTrends{}
	for i := start; i <= sel; i++ {
		var spend int64
		for _, e := range pd.expensesByPid[periods[i].ID] {
			spend += e.Amount
		}
		balances, savings := pd.ClosingBalancesFrom(&periods[i])
		var saved int64
		for _, v := range savings {
			saved += v
		}
		out.Series = append(out.Series, TrendPoint{
			PeriodID: periods[i].ID, PeriodName: periods[i].Name,
			StartDate: periods[i].StartDate, TotalSpend: spend, TotalSaved: saved,
			NetWorth: domain.InHand(balances, accounts) + saved,
		})
	}
```

- [ ] **Step 3: Use prefetched data for the category comparison**

In `Trends`, the comparison currently calls `s.categorySpend` twice (two more queries). Replace the comparison source. Change this block:

```go
	// Current vs previous per-category comparison.
	current, err := s.categorySpend(ctx, userID, periods[sel].ID)
	if err != nil {
		return nil, err
	}
	previous := map[string]int64{}
	if sel > 0 {
		out.PreviousPeriodName = periods[sel-1].Name
		previous, err = s.categorySpend(ctx, userID, periods[sel-1].ID)
		if err != nil {
			return nil, err
		}
	}
```

with:

```go
	// Current vs previous per-category comparison (from prefetched data).
	current := categoryTotalsFrom(pd.expensesByPid[periods[sel].ID])
	previous := map[string]int64{}
	if sel > 0 {
		out.PreviousPeriodName = periods[sel-1].Name
		previous = categoryTotalsFrom(pd.expensesByPid[periods[sel-1].ID])
	}
```

Then add the helper at the end of `summary.go`:

```go
func categoryTotalsFrom(expenses []domain.Expense) map[string]int64 {
	totals := map[string]int64{}
	for _, e := range expenses {
		totals[e.CategoryID] += e.Amount
	}
	return totals
}
```

- [ ] **Step 4: Remove now-unused helpers**

`periodSpend` and `categorySpend` are no longer referenced after Steps 2–3. Delete both methods from `summary.go` to avoid dead code. (If `go build` reports either is still used elsewhere, keep that one.)

- [ ] **Step 5: Build and run the suite**

Run: `cd CostCalculator/backend && go build ./... && MONGO_URI=mongodb://localhost:27017 go test ./internal/http/ ./internal/service/ -v`
Expected: build clean; `TestAPIFlow` (savings history length, summary numbers) still PASS.

- [ ] **Step 6: Commit**

```bash
git add CostCalculator/backend/internal/service/summary.go
git commit -m "perf(summary): batch SavingsHistory and Trends to constant query count"
```

---

### Task 3: Multi-period regression test

**Files:**
- Test: `CostCalculator/backend/internal/http/trends_test.go` (extend if present) or create `CostCalculator/backend/internal/service/summary_batch_test.go`

- [ ] **Step 1: Write a focused multi-period test**

Create `CostCalculator/backend/internal/service/summary_batch_test.go`:

```go
package service

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/bson"

	"costcalculator/backend/internal/domain"
	"costcalculator/backend/internal/repo"
)

// Savings history across multiple periods must reflect each period's savings
// expenses, accumulated through the chain — exercises the batched path.
func TestSavingsHistoryAcrossPeriods(t *testing.T) {
	uri := os.Getenv("MONGO_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017"
	}
	dbName := fmt.Sprintf("costcalc_batch_test_%d", time.Now().UnixNano())
	db, err := repo.Connect(context.Background(), uri, dbName)
	if err != nil {
		t.Skipf("mongo not available: %v", err)
	}
	defer db.Client.Database(dbName).Drop(context.Background())
	ctx := context.Background()

	uid := "u1"
	// One savings account.
	sav := domain.Account{ID: repo.NewID(), UserID: uid, Name: "S", Kind: domain.AccountSavings, Active: true}
	if _, err := db.Accounts.InsertOne(ctx, sav); err != nil {
		t.Fatal(err)
	}
	// Two chained periods.
	p1 := domain.Period{ID: repo.NewID(), UserID: uid, Name: "P1",
		StartDate: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), EndDate: time.Date(2026, 1, 31, 0, 0, 0, 0, time.UTC),
		Status: domain.PeriodOpen, OpeningBalances: []domain.AccountAmount{}, OpeningSavings: []domain.AccountAmount{}}
	p2 := domain.Period{ID: repo.NewID(), UserID: uid, Name: "P2", PreviousPeriodID: p1.ID,
		StartDate: time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC), EndDate: time.Date(2026, 2, 28, 0, 0, 0, 0, time.UTC),
		Status: domain.PeriodOpen, OpeningBalances: []domain.AccountAmount{}, OpeningSavings: []domain.AccountAmount{}}
	if _, err := db.Periods.InsertMany(ctx, []any{p1, p2}); err != nil {
		t.Fatal(err)
	}
	// A savings expense in P1 (paisa).
	if _, err := db.Expenses.InsertOne(ctx, domain.Expense{
		ID: repo.NewID(), UserID: uid, PeriodID: p1.ID, Date: p1.StartDate,
		CategoryID: "c1", Subcategory: "x", AccountID: sav.ID, Amount: 5000,
	}); err != nil {
		t.Fatal(err)
	}

	s := &Summary{DB: db, Periods: &Periods{DB: db}}
	pts, err := s.SavingsHistory(ctx, uid)
	if err != nil {
		t.Fatal(err)
	}
	if len(pts) != 2 {
		t.Fatalf("points = %d, want 2", len(pts))
	}
	if pts[0].Total != 5000 {
		t.Errorf("P1 savings total = %d, want 5000", pts[0].Total)
	}
	_ = bson.M{} // keep bson import if unused elsewhere
}
```

> Adjust the expected `pts[0].Total` if `domain.SavingsBalances` treats savings-account expenses with a different sign — run the test once and align the assertion with the documented behavior in `domain/balance.go`, not by guessing. The goal is to pin whatever the correct value is so future refactors can't change it silently.

- [ ] **Step 2: Run the test**

Run: `cd CostCalculator/backend && MONGO_URI=mongodb://localhost:27017 go test ./internal/service/ -run TestSavingsHistoryAcrossPeriods -v`
Expected: PASS (after aligning the expected total with `domain.SavingsBalances` semantics).

- [ ] **Step 3: Commit**

```bash
git add CostCalculator/backend/internal/service/summary_batch_test.go
git commit -m "test(summary): multi-period savings-history regression for batched path"
```

---

## Final verification

- [ ] `cd CostCalculator/backend && go build ./... && go vet ./... && MONGO_URI=mongodb://localhost:27017 go test ./...` → clean / PASS.
- [ ] Spot-check query reduction: for N periods, `SavingsHistory` now issues 4 queries (periods + expenses + transfers + accounts) regardless of N, vs the previous ≈1+3N.

## Self-review (spec coverage)

| Phase 3 spec item | Covered by |
|---|---|
| #12 summary query batching | Tasks 1–3 |

**Scope note:** `Build` (single-period summary) is left as-is — it already issues a bounded number of queries for one period; batching it would add complexity for little gain. Its one redundant re-fetch (previous-period expenses during rollover) is minor and out of scope.
