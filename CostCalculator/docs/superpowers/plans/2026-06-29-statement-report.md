# Statement / Year-in-Review Report — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a printable financial statement over a chosen Month / Year / custom date range, with user-selectable sections, exported via the browser's print-to-PDF.

**Architecture:** A backend read endpoint `GET /api/v1/statement?from=&to=` returns an aggregated `StatementReport` (flows over the calendar range). The frontend adds a 2-step "Download report" wizard on Insights that opens a print-styled `/statement` route (outside the app shell) which renders the selected sections and triggers `window.print()`. Visual reference: `docs/mockups/carbon/index.html` (Insights → Download report).

**Tech Stack:** Go 1.26 + Gin + MongoDB (backend); Next.js 14 App Router + React 18 + TanStack Query (frontend `web/`). Money is int64 paisa.

**Conventions:** error helpers `BadRequest/Internal` in `respond.go`; caller via `userID(c)`; repo generics `FindAll[T]`; tests use real Mongo with `MONGO_URI='mongodb://localhost:27017/?directConnection=true'` and `t.Skipf` when absent; income = transfers out of the virtual `external` account; savings deposit = expense whose `subcategory` equals a savings account's `name`.

---

### Task 1: Backend — `StatementReport` + `Summary.Statement`

**Files:**
- Modify: `CostCalculator/backend/internal/service/summary.go` (append types + method)
- Test: `CostCalculator/backend/internal/service/statement_test.go`

- [ ] **Step 1: Write the failing test**

Create `CostCalculator/backend/internal/service/statement_test.go`:

```go
package service

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"costcalculator/backend/internal/domain"
	"costcalculator/backend/internal/repo"
)

func TestStatementAggregatesRange(t *testing.T) {
	uri := os.Getenv("MONGO_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017/?directConnection=true"
	}
	dbName := fmt.Sprintf("costcalc_stmt_test_%d", time.Now().UnixNano())
	db, err := repo.Connect(context.Background(), uri, dbName)
	if err != nil {
		t.Skipf("mongo not available: %v", err)
	}
	defer db.Client.Database(dbName).Drop(context.Background())
	ctx := context.Background()
	uid := "u1"
	day := func(s string) time.Time { d, _ := time.Parse("2006-01-02", s); return d }

	// accounts: external (income source) + a savings account named "S"
	ext := domain.Account{ID: repo.NewID(), UserID: uid, Name: "Add", Kind: domain.AccountVirtual, VirtualRole: domain.RoleExternal, Active: true}
	sav := domain.Account{ID: repo.NewID(), UserID: uid, Name: "S", Kind: domain.AccountSavings, Active: true}
	cash := domain.Account{ID: repo.NewID(), UserID: uid, Name: "Cash", Kind: domain.AccountCash, Active: true}
	if _, err := db.Accounts.InsertMany(ctx, []any{ext, sav, cash}); err != nil {
		t.Fatal(err)
	}
	// categories
	food := domain.Category{ID: repo.NewID(), UserID: uid, Name: "Food", Kind: domain.CategoryExpense, Active: true}
	svc := domain.Category{ID: repo.NewID(), UserID: uid, Name: "Savings", Kind: domain.CategorySavings, Active: true}
	if _, err := db.Categories.InsertMany(ctx, []any{food, svc}); err != nil {
		t.Fatal(err)
	}
	// period p1 = January
	p1 := domain.Period{ID: repo.NewID(), UserID: uid, Name: "Jan 2026", StartDate: day("2026-01-01"), EndDate: day("2026-01-31"), Status: domain.PeriodOpen}
	if _, err := db.Periods.InsertOne(ctx, p1); err != nil {
		t.Fatal(err)
	}
	// income transfer (external -> cash), 1000.00 = 100000 paisa
	if _, err := db.Transfers.InsertOne(ctx, domain.Transfer{ID: repo.NewID(), UserID: uid, PeriodID: p1.ID, Date: day("2026-01-05"), FromAccountID: ext.ID, ToAccountID: cash.ID, Amount: 100000}); err != nil {
		t.Fatal(err)
	}
	// expenses: Food 30000, savings deposit (subcat "S") 5000
	if _, err := db.Expenses.InsertMany(ctx, []any{
		domain.Expense{ID: repo.NewID(), UserID: uid, PeriodID: p1.ID, Date: day("2026-01-10"), CategoryID: food.ID, Subcategory: "Lunch", AccountID: cash.ID, Amount: 30000},
		domain.Expense{ID: repo.NewID(), UserID: uid, PeriodID: p1.ID, Date: day("2026-01-15"), CategoryID: svc.ID, Subcategory: "S", AccountID: cash.ID, Amount: 5000},
	}); err != nil {
		t.Fatal(err)
	}

	s := &Summary{DB: db, Periods: &Periods{DB: db}}
	rep, err := s.Statement(ctx, uid, day("2026-01-01"), day("2026-01-31"))
	if err != nil {
		t.Fatal(err)
	}
	if rep.KPIs.TotalIncome != 100000 {
		t.Errorf("income = %d, want 100000", rep.KPIs.TotalIncome)
	}
	if rep.KPIs.TotalSpent != 35000 {
		t.Errorf("spent = %d, want 35000", rep.KPIs.TotalSpent)
	}
	if rep.KPIs.NetSaved != 65000 {
		t.Errorf("netSaved = %d, want 65000", rep.KPIs.NetSaved)
	}
	if rep.KPIs.SavingsRatePct != 65 {
		t.Errorf("rate = %d, want 65", rep.KPIs.SavingsRatePct)
	}
	if len(rep.Categories) != 2 || rep.Categories[0].Total != 30000 {
		t.Errorf("categories = %+v, want Food 30000 first", rep.Categories)
	}
	if len(rep.Savings) != 1 || rep.Savings[0].Deposited != 5000 {
		t.Errorf("savings = %+v, want S 5000", rep.Savings)
	}
	if len(rep.Periods) != 1 || rep.Periods[0].Income != 100000 || rep.Periods[0].Spent != 35000 || rep.Periods[0].Saved != 65000 {
		t.Errorf("periods = %+v, want one cycle 100000/35000/65000", rep.Periods)
	}
}

func TestStatementEmptyRange(t *testing.T) {
	uri := os.Getenv("MONGO_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017/?directConnection=true"
	}
	dbName := fmt.Sprintf("costcalc_stmt_empty_%d", time.Now().UnixNano())
	db, err := repo.Connect(context.Background(), uri, dbName)
	if err != nil {
		t.Skipf("mongo not available: %v", err)
	}
	defer db.Client.Database(dbName).Drop(context.Background())
	day := func(s string) time.Time { d, _ := time.Parse("2006-01-02", s); return d }
	s := &Summary{DB: db, Periods: &Periods{DB: db}}
	rep, err := s.Statement(context.Background(), "nobody", day("2026-01-01"), day("2026-12-31"))
	if err != nil {
		t.Fatal(err)
	}
	if rep.KPIs.TotalIncome != 0 || rep.KPIs.SavingsRatePct != 0 {
		t.Errorf("empty range should be zeroed, got %+v", rep.KPIs)
	}
	if rep.Categories == nil || rep.Periods == nil || rep.Savings == nil {
		t.Error("slices must be non-nil (empty arrays) so JSON is [] not null")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd CostCalculator/backend && MONGO_URI='mongodb://localhost:27017/?directConnection=true' go test ./internal/service/ -run TestStatement -v`
Expected: FAIL — `rep.Statement` / `StatementReport` undefined (compile error).

- [ ] **Step 3: Append the types and method to `summary.go`**

At the end of `CostCalculator/backend/internal/service/summary.go`, add:

```go
type StatementKPIs struct {
	TotalIncome    int64 `json:"totalIncome"`
	TotalSpent     int64 `json:"totalSpent"`
	NetSaved       int64 `json:"netSaved"`
	SavingsRatePct int   `json:"savingsRatePct"`
}
type StatementCategory struct {
	CategoryID string `json:"categoryId"`
	Name       string `json:"name"`
	Total      int64  `json:"total"`
}
type StatementSub struct {
	CategoryID  string `json:"categoryId"`
	Name        string `json:"name"`
	Subcategory string `json:"subcategory"`
	Total       int64  `json:"total"`
}
type StatementSaving struct {
	AccountID string `json:"accountId"`
	Name      string `json:"name"`
	Deposited int64  `json:"deposited"`
}
type StatementLends struct {
	GivenOutstanding int64 `json:"givenOutstanding"`
	TakenOutstanding int64 `json:"takenOutstanding"`
	SettledInRange   int64 `json:"settledInRange"`
}
type StatementPeriod struct {
	PeriodID string    `json:"periodId"`
	Name     string    `json:"name"`
	Start    time.Time `json:"start"`
	End      time.Time `json:"end"`
	Income   int64     `json:"income"`
	Spent    int64     `json:"spent"`
	Saved    int64     `json:"saved"`
}
type StatementReport struct {
	From             time.Time           `json:"from"`
	To               time.Time           `json:"to"`
	KPIs             StatementKPIs       `json:"kpis"`
	Categories       []StatementCategory `json:"categories"`
	TopSubcategories []StatementSub      `json:"topSubcategories"`
	Savings          []StatementSaving   `json:"savings"`
	Lends            StatementLends      `json:"lends"`
	Periods          []StatementPeriod   `json:"periods"`
}

// Statement aggregates a user's flows over the calendar range [from, to]
// (inclusive). Dates are stored at UTC midnight, so $lte to-midnight is inclusive.
func (s *Summary) Statement(ctx context.Context, userID string, from, to time.Time) (*StatementReport, error) {
	dateFilter := bson.M{"$gte": from, "$lte": to}
	expenses, err := repo.FindAll[domain.Expense](ctx, s.DB.Expenses, bson.M{"userId": userID, "date": dateFilter})
	if err != nil {
		return nil, err
	}
	transfers, err := repo.FindAll[domain.Transfer](ctx, s.DB.Transfers, bson.M{"userId": userID, "date": dateFilter})
	if err != nil {
		return nil, err
	}
	accounts, err := repo.FindAll[domain.Account](ctx, s.DB.Accounts, bson.M{"userId": userID})
	if err != nil {
		return nil, err
	}
	categories, err := repo.FindAll[domain.Category](ctx, s.DB.Categories, bson.M{"userId": userID})
	if err != nil {
		return nil, err
	}
	lends, err := repo.FindAll[domain.Lend](ctx, s.DB.Lends, bson.M{"userId": userID})
	if err != nil {
		return nil, err
	}

	var externalID string
	savingsByName := map[string]domain.Account{}
	for _, a := range accounts {
		if a.Kind == domain.AccountVirtual && a.VirtualRole == domain.RoleExternal {
			externalID = a.ID
		}
		if a.Kind == domain.AccountSavings {
			savingsByName[a.Name] = a
		}
	}
	catName := map[string]string{}
	for _, c := range categories {
		catName[c.ID] = c.Name
	}

	rep := &StatementReport{
		From: from, To: to,
		Categories:       []StatementCategory{},
		TopSubcategories: []StatementSub{},
		Savings:          []StatementSaving{},
		Periods:          []StatementPeriod{},
	}

	periodIncome := map[string]int64{}
	for _, t := range transfers {
		if externalID != "" && t.FromAccountID == externalID {
			rep.KPIs.TotalIncome += t.Amount
			periodIncome[t.PeriodID] += t.Amount
		}
	}

	catTotals := map[string]int64{}
	subTotals := map[string]*StatementSub{}
	savDep := map[string]int64{}
	periodSpend := map[string]int64{}
	for _, e := range expenses {
		rep.KPIs.TotalSpent += e.Amount
		catTotals[e.CategoryID] += e.Amount
		periodSpend[e.PeriodID] += e.Amount
		k := e.CategoryID + "|" + e.Subcategory
		if subTotals[k] == nil {
			subTotals[k] = &StatementSub{CategoryID: e.CategoryID, Name: catName[e.CategoryID], Subcategory: e.Subcategory}
		}
		subTotals[k].Total += e.Amount
		if _, ok := savingsByName[e.Subcategory]; ok {
			savDep[e.Subcategory] += e.Amount
		}
	}
	rep.KPIs.NetSaved = rep.KPIs.TotalIncome - rep.KPIs.TotalSpent
	if rep.KPIs.TotalIncome > 0 {
		rep.KPIs.SavingsRatePct = int(rep.KPIs.NetSaved * 100 / rep.KPIs.TotalIncome)
	}

	for id, total := range catTotals {
		rep.Categories = append(rep.Categories, StatementCategory{CategoryID: id, Name: catName[id], Total: total})
	}
	sort.Slice(rep.Categories, func(i, j int) bool { return rep.Categories[i].Total > rep.Categories[j].Total })

	for _, sub := range subTotals {
		rep.TopSubcategories = append(rep.TopSubcategories, *sub)
	}
	sort.Slice(rep.TopSubcategories, func(i, j int) bool { return rep.TopSubcategories[i].Total > rep.TopSubcategories[j].Total })
	if len(rep.TopSubcategories) > 6 {
		rep.TopSubcategories = rep.TopSubcategories[:6]
	}

	for name, acc := range savingsByName {
		if dep := savDep[name]; dep != 0 {
			rep.Savings = append(rep.Savings, StatementSaving{AccountID: acc.ID, Name: name, Deposited: dep})
		}
	}
	sort.Slice(rep.Savings, func(i, j int) bool { return rep.Savings[i].Deposited > rep.Savings[j].Deposited })

	for _, l := range lends {
		if l.Status == domain.LendOpen {
			switch l.Type {
			case domain.LendGiven:
				rep.Lends.GivenOutstanding += l.Outstanding()
			case domain.LendTaken:
				rep.Lends.TakenOutstanding += l.Outstanding()
			}
		}
		for _, st := range l.Settlements {
			if !st.Date.Before(from) && !st.Date.After(to) {
				rep.Lends.SettledInRange += st.Amount
			}
		}
	}

	periods, err := repo.FindAll[domain.Period](ctx, s.DB.Periods, bson.M{
		"userId": userID, "startDate": bson.M{"$lte": to}, "endDate": bson.M{"$gte": from},
	})
	if err != nil {
		return nil, err
	}
	sortPeriodsByStart(periods)
	for i := range periods {
		inc, sp := periodIncome[periods[i].ID], periodSpend[periods[i].ID]
		rep.Periods = append(rep.Periods, StatementPeriod{
			PeriodID: periods[i].ID, Name: periods[i].Name, Start: periods[i].StartDate, End: periods[i].EndDate,
			Income: inc, Spent: sp, Saved: inc - sp,
		})
	}
	return rep, nil
}
```

(`sort`, `time`, `bson`, `domain`, `repo` are already imported in `summary.go`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd CostCalculator/backend && MONGO_URI='mongodb://localhost:27017/?directConnection=true' go test ./internal/service/ -run TestStatement -v`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add CostCalculator/backend/internal/service/summary.go CostCalculator/backend/internal/service/statement_test.go
git commit -m "feat(statement): Summary.Statement aggregates flows over a date range"
```

---

### Task 2: Backend — endpoint, route, and `{userId, date}` index

**Files:**
- Modify: `CostCalculator/backend/internal/http/handlers_periods.go` (add handler — it already holds `summary`)
- Modify: `CostCalculator/backend/internal/http/router.go` (add route)
- Modify: `CostCalculator/backend/internal/repo/mongo.go` (add index)
- Test: `CostCalculator/backend/internal/http/api_test.go` is unaffected; add a focused handler test below.

- [ ] **Step 1: Write the failing handler test**

Create `CostCalculator/backend/internal/http/statement_test.go`:

```go
package http

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"costcalculator/backend/internal/config"
	"costcalculator/backend/internal/repo"
)

func TestStatementEndpoint(t *testing.T) {
	gin.SetMode(gin.TestMode)
	uri := os.Getenv("MONGO_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017/?directConnection=true"
	}
	dbName := fmt.Sprintf("costcalc_stmt_ep_%d", time.Now().UnixNano())
	db, err := repo.Connect(context.Background(), uri, dbName)
	if err != nil {
		t.Skipf("mongo not available: %v", err)
	}
	defer db.Client.Database(dbName).Drop(context.Background())

	router := NewRouter(config.Config{JWTSecret: "test", CORSOrigin: "*"}, db)
	do := func(method, path, token string, body any) *httptest.ResponseRecorder {
		var buf bytes.Buffer
		if body != nil {
			json.NewEncoder(&buf).Encode(body)
		}
		req := httptest.NewRequest(method, path, &buf)
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		return w
	}

	var reg map[string]any
	wReg := do("POST", "/api/v1/auth/register", "", map[string]any{"name": "S", "email": "s@example.com", "password": "secret123"})
	json.Unmarshal(wReg.Body.Bytes(), &reg)
	token := reg["tokens"].(map[string]any)["accessToken"].(string)

	// valid range
	w := do("GET", "/api/v1/statement?from=2026-01-01&to=2026-12-31", token, nil)
	if w.Code != 200 {
		t.Fatalf("statement: %d %s", w.Code, w.Body.String())
	}
	var rep map[string]any
	json.Unmarshal(w.Body.Bytes(), &rep)
	if _, ok := rep["kpis"]; !ok {
		t.Errorf("response missing kpis: %s", w.Body.String())
	}

	// bad dates -> 400
	if w := do("GET", "/api/v1/statement?from=nope&to=2026-12-31", token, nil); w.Code != 400 {
		t.Errorf("bad from: got %d, want 400", w.Code)
	}
	// to before from -> 400
	if w := do("GET", "/api/v1/statement?from=2026-12-31&to=2026-01-01", token, nil); w.Code != 400 {
		t.Errorf("reversed range: got %d, want 400", w.Code)
	}
	// unauthenticated -> 401
	if w := do("GET", "/api/v1/statement?from=2026-01-01&to=2026-12-31", "", nil); w.Code != 401 {
		t.Errorf("no auth: got %d, want 401", w.Code)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd CostCalculator/backend && MONGO_URI='mongodb://localhost:27017/?directConnection=true' go test ./internal/http/ -run TestStatementEndpoint -v`
Expected: FAIL — route `/statement` returns 404 (handler not wired).

- [ ] **Step 3: Add the handler**

In `CostCalculator/backend/internal/http/handlers_periods.go`, add after the `getSummary` handler:

```go
func (h *periodHandlers) statement(c *gin.Context) {
	from, err1 := time.Parse("2006-01-02", c.Query("from"))
	to, err2 := time.Parse("2006-01-02", c.Query("to"))
	if err1 != nil || err2 != nil {
		BadRequest(c, "from and to must be YYYY-MM-DD dates")
		return
	}
	if to.Before(from) {
		BadRequest(c, "to must not be before from")
		return
	}
	rep, err := h.summary.Statement(c, userID(c), from, to)
	if err != nil {
		Internal(c, err)
		return
	}
	c.JSON(200, rep)
}
```

(`time` is already imported in `handlers_periods.go`.)

- [ ] **Step 4: Wire the route**

In `CostCalculator/backend/internal/http/router.go`, add inside the protected group, next to the other top-level reads (e.g. right after `p.GET("/savings/history", ph.savingsHistory)`):

```go
		p.GET("/statement", ph.statement)
```

- [ ] **Step 5: Add the `{userId, date}` index**

In `CostCalculator/backend/internal/repo/mongo.go`, inside `ensureIndexes`, after the existing `{userId, periodId, date}` loop for expenses/transfers, add:

```go
	for _, c := range []*mongo.Collection{db.Expenses, db.Transfers} {
		if _, err := c.Indexes().CreateOne(ctx, mongo.IndexModel{
			Keys: bson.D{{Key: "userId", Value: 1}, {Key: "date", Value: 1}},
		}); err != nil {
			return err
		}
	}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd CostCalculator/backend && MONGO_URI='mongodb://localhost:27017/?directConnection=true' go test ./internal/http/ -run TestStatementEndpoint -v && go build ./... && go vet ./...`
Expected: PASS; build + vet clean.

- [ ] **Step 7: Commit**

```bash
git add CostCalculator/backend/internal/http/handlers_periods.go CostCalculator/backend/internal/http/router.go CostCalculator/backend/internal/repo/mongo.go CostCalculator/backend/internal/http/statement_test.go
git commit -m "feat(statement): GET /statement endpoint + userId,date index"
```

---

### Task 3: Frontend — types + API client

**Files:**
- Modify: `CostCalculator/web/lib/types.ts` (add statement types)
- Modify: `CostCalculator/web/lib/api.ts` (add `statement`)

- [ ] **Step 1: Add the statement types**

In `CostCalculator/web/lib/types.ts`, append (these are hand-written response aggregates, consistent with the Phase 3a codegen split):

```ts
// Statement / year-in-review report (Go: service.StatementReport).
export interface StatementKPIs { totalIncome: number; totalSpent: number; netSaved: number; savingsRatePct: number; }
export interface StatementCategory { categoryId: string; name: string; total: number; }
export interface StatementSub { categoryId: string; name: string; subcategory: string; total: number; }
export interface StatementSaving { accountId: string; name: string; deposited: number; }
export interface StatementLends { givenOutstanding: number; takenOutstanding: number; settledInRange: number; }
export interface StatementPeriod { periodId: string; name: string; start: string; end: string; income: number; spent: number; saved: number; }
export interface StatementReport {
  from: string; to: string; kpis: StatementKPIs;
  categories: StatementCategory[]; topSubcategories: StatementSub[];
  savings: StatementSaving[]; lends: StatementLends; periods: StatementPeriod[];
}
```

- [ ] **Step 2: Add the API call**

In `CostCalculator/web/lib/api.ts`, add `StatementReport` to the type import list at the top, and add this line in the `api` object next to `savingsHistory`:

```ts
  statement: (from: string, to: string) => request<StatementReport>("GET", `/statement?from=${from}&to=${to}`),
```

- [ ] **Step 3: Typecheck**

Run: `cd CostCalculator/web && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add CostCalculator/web/lib/types.ts CostCalculator/web/lib/api.ts
git commit -m "feat(web): statement types + api.statement client"
```

---

### Task 4: Frontend — statement + print styles

**Files:**
- Modify: `CostCalculator/web/app/globals.css` (append statement + print rules)

- [ ] **Step 1: Append the statement styles and print rules**

At the end of `CostCalculator/web/app/globals.css`, add (ported from the approved mockup, plus a print block and the standalone page wrapper):

```css
/* ===== statement / report (year-in-review) ===== */
.stmt-page{max-width:820px;margin:0 auto;padding:24px;}
.stmt-actions{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;}
.stmt{font-family:var(--font-family-ui);color:var(--standard-0);}
.stmt-head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid var(--standard-0);padding-bottom:14px;margin-bottom:20px;}
.stmt-title{font-family:var(--font-family-brand);font-weight:600;font-size:22px;}
.stmt-sub{color:var(--standard-600);font-size:13px;margin-top:4px;}
.stmt-brand{font-family:var(--font-family-brand);font-weight:600;font-size:16px;color:var(--blue-0);}
.stmt-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px;}
.stmt-k{border:1px solid var(--standard-1000);border-radius:10px;padding:12px;}
.stmt-k .l{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--standard-600);font-weight:600;}
.stmt-k .v{font-family:var(--font-family-brand);font-weight:500;font-size:20px;margin-top:6px;}
.stmt-sec{margin-bottom:24px;break-inside:avoid;}
.stmt-sec-h{font-family:var(--font-family-brand);font-weight:500;font-size:15px;margin:0 0 12px;padding-bottom:6px;border-bottom:1px solid var(--standard-1000);}
.stmt-bar{display:flex;align-items:center;gap:10px;margin-bottom:8px;font-size:13px;}
.stmt-bar .nm{width:150px;flex:0 0 auto;}
.stmt-bar .track{flex:1;height:8px;border-radius:99px;background:var(--standard-1100);overflow:hidden;}
.stmt-bar .fill{height:100%;border-radius:99px;}
.stmt-bar .vl{width:95px;text-align:right;font-variant-numeric:tabular-nums;}
.stmt-table{width:100%;border-collapse:collapse;font-size:13px;}
.stmt-table th{text-align:left;padding:8px 10px;border-bottom:1px solid var(--standard-1000);font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--standard-600);}
.stmt-table td{padding:8px 10px;border-bottom:1px solid var(--standard-1100);}
.stmt-table .num{text-align:right;font-variant-numeric:tabular-nums;}
.stmt-empty{color:var(--standard-600);font-size:14px;padding:12px 0;}

/* ===== report wizard (dialog) ===== */
.wiz-tabs{display:flex;gap:8px;margin-bottom:20px;}
.wiz-tab{flex:1;display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:10px;border:1px solid var(--standard-1000);font-family:var(--font-family-brand);font-weight:500;font-size:13px;color:var(--standard-600);background:var(--standard-1400);}
.wiz-tab.active{border-color:var(--blue-0);color:var(--standard-0);background:var(--standard-1300);}
.wiz-no{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:600;background:var(--standard-1100);color:var(--standard-600);}
.wiz-tab.active .wiz-no{background:var(--blue-0);color:#fff;}
.seg{display:flex;gap:4px;padding:4px;background:var(--standard-1300);border-radius:var(--radius-pill);margin-bottom:18px;}
.seg-btn{flex:1;height:34px;border:none;background:none;border-radius:var(--radius-pill);font-family:var(--font-family-ui);font-weight:600;font-size:13px;color:var(--standard-600);cursor:pointer;}
.seg-btn.active{background:var(--standard-1400);color:var(--standard-0);box-shadow:0 1px 3px rgba(0,0,0,.1);}
.rng-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.rep-hint{color:var(--standard-600);font-size:13px;margin:0 0 14px;}
.rep-opt{display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border:1px solid var(--standard-1000);border-radius:10px;margin-bottom:8px;cursor:pointer;}
.rep-opt:hover{border-color:var(--standard-700);}
.rep-opt input{width:18px;height:18px;margin-top:1px;accent-color:var(--blue-0);flex:0 0 auto;}
.rep-opt .rt{font-weight:500;}
.rep-opt small{color:var(--standard-600);display:block;margin-top:2px;}

@media print{
  .stmt-actions{display:none !important;}
  .stmt-page{max-width:none;padding:0;}
  body{background:#fff !important;}
  @page{margin:16mm;}
}
```

- [ ] **Step 2: Verify build still compiles CSS**

Run: `cd CostCalculator/web && npm run build`
Expected: build succeeds (CSS is bundled).

- [ ] **Step 3: Commit**

```bash
git add CostCalculator/web/app/globals.css
git commit -m "feat(web): statement + report-wizard styles and print rules"
```

---

### Task 5: Frontend — the `/statement` print page

**Files:**
- Create: `CostCalculator/web/app/statement/page.tsx`

- [ ] **Step 1: Create the print page**

Create `CostCalculator/web/app/statement/page.tsx`:

```tsx
"use client";
import { Suspense, useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { taka } from "@/lib/money";
import { colorFor } from "@/lib/format";
import { Icon, Spinner, ErrorState } from "@/components/ui";

const ALL = ["kpis", "income", "categories", "savings", "period", "lends"];

function fmt(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function StatementInner() {
  const sp = useSearchParams();
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  const sections = (sp.get("sections") || "kpis,income,categories,savings,period").split(",").filter((s) => ALL.includes(s));
  const has = (s: string) => sections.includes(s);
  const printed = useRef(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["statement", from, to],
    queryFn: () => api.statement(from, to),
    enabled: !!from && !!to,
  });

  useEffect(() => {
    if (data && !printed.current) { printed.current = true; setTimeout(() => window.print(), 400); }
  }, [data]);

  if (!from || !to) return <div className="stmt-page"><ErrorState message="Missing date range." onRetry={undefined} /></div>;
  if (isLoading) return <div className="stmt-page"><Spinner /></div>;
  if (isError || !data) return <div className="stmt-page"><ErrorState message={(error as Error)?.message} onRetry={() => refetch()} /></div>;

  const k = data.kpis;
  const catMax = Math.max(1, ...data.categories.map((c) => c.total));
  const incMax = Math.max(1, k.totalIncome, k.totalSpent, k.netSaved);
  const noActivity = k.totalIncome === 0 && k.totalSpent === 0;

  return (
    <div className="stmt-page">
      <div className="stmt-actions">
        <Link href="/insights" className="ob-btn ob-btn--ghost"><Icon name="arrow-left" /> Back</Link>
        <button className="ob-btn ob-btn--primary" onClick={() => window.print()}><Icon name="download" /> Save as PDF</button>
      </div>

      <div className="stmt">
        <div className="stmt-head">
          <div>
            <div className="stmt-title">Financial statement</div>
            <div className="stmt-sub">{fmt(from)} – {fmt(to)} · generated {fmt(new Date().toISOString())}</div>
          </div>
          <div className="stmt-brand">৳ Ribnat</div>
        </div>

        {noActivity && <p className="stmt-empty">No activity in this range.</p>}

        {has("kpis") && (
          <div className="stmt-kpis">
            <div className="stmt-k"><div className="l">Income</div><div className="v num">{taka(k.totalIncome)}</div></div>
            <div className="stmt-k"><div className="l">Spent</div><div className="v num">{taka(k.totalSpent)}</div></div>
            <div className="stmt-k"><div className="l">Net saved</div><div className="v num">{taka(k.netSaved)}</div></div>
            <div className="stmt-k"><div className="l">Savings rate</div><div className="v num">{k.totalIncome > 0 ? `${k.savingsRatePct}%` : "—"}</div></div>
          </div>
        )}

        {has("income") && (
          <div className="stmt-sec">
            <h3 className="stmt-sec-h">Income &amp; spending</h3>
            <Bar nm="Income" pct={Math.round(k.totalIncome / incMax * 100)} color="var(--marketing-green)" v={k.totalIncome} />
            <Bar nm="Spent" pct={Math.round(k.totalSpent / incMax * 100)} color="var(--blue-0)" v={k.totalSpent} />
            <Bar nm="Net saved" pct={Math.max(0, Math.round(k.netSaved / incMax * 100))} color="var(--marketing-purple)" v={k.netSaved} />
          </div>
        )}

        {has("categories") && data.categories.length > 0 && (
          <div className="stmt-sec">
            <h3 className="stmt-sec-h">Spending by category</h3>
            {data.categories.map((c) => (
              <Bar key={c.categoryId} nm={c.name} pct={Math.round(c.total / catMax * 100)} color={colorFor(c.categoryId)} v={c.total} />
            ))}
          </div>
        )}

        {has("period") && data.periods.length > 0 && (
          <div className="stmt-sec">
            <h3 className="stmt-sec-h">Period breakdown</h3>
            <table className="stmt-table">
              <thead><tr><th>Cycle</th><th className="num">Income</th><th className="num">Spent</th><th className="num">Saved</th></tr></thead>
              <tbody>
                {data.periods.map((p) => (
                  <tr key={p.periodId}><td>{p.name}</td><td className="num">{taka(p.income)}</td><td className="num">{taka(p.spent)}</td><td className="num">{taka(p.saved)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {has("savings") && data.savings.length > 0 && (
          <div className="stmt-sec">
            <h3 className="stmt-sec-h">Savings</h3>
            <table className="stmt-table">
              <thead><tr><th>Account</th><th className="num">Deposited</th></tr></thead>
              <tbody>{data.savings.map((s) => <tr key={s.accountId}><td>{s.name}</td><td className="num">{taka(s.deposited)}</td></tr>)}</tbody>
            </table>
          </div>
        )}

        {has("lends") && (
          <div className="stmt-sec">
            <h3 className="stmt-sec-h">Lends</h3>
            <table className="stmt-table">
              <thead><tr><th>Type</th><th className="num">Amount</th></tr></thead>
              <tbody>
                <tr><td>Given · outstanding</td><td className="num">{taka(data.lends.givenOutstanding)}</td></tr>
                <tr><td>Taken · outstanding</td><td className="num">{taka(data.lends.takenOutstanding)}</td></tr>
                <tr><td>Settled this range</td><td className="num">{taka(data.lends.settledInRange)}</td></tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Bar({ nm, pct, color, v }: { nm: string; pct: number; color: string; v: number }) {
  return (
    <div className="stmt-bar">
      <span className="nm">{nm}</span>
      <span className="track"><span className="fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} /></span>
      <span className="vl">{taka(v)}</span>
    </div>
  );
}

export default function StatementPage() {
  return <Suspense fallback={<div className="stmt-page"><Spinner /></div>}><StatementInner /></Suspense>;
}
```

- [ ] **Step 2: Typecheck + build**

Run: `cd CostCalculator/web && npx tsc --noEmit && npm run build`
Expected: both succeed; `/statement` appears in the route list.

- [ ] **Step 3: Commit**

```bash
git add "CostCalculator/web/app/statement/page.tsx"
git commit -m "feat(web): /statement print page with selectable sections + auto-print"
```

---

### Task 6: Frontend — the Download-report wizard + Insights entry point

**Files:**
- Create: `CostCalculator/web/components/ReportDialog.tsx`
- Modify: `CostCalculator/web/app/(app)/insights/page.tsx` (add button + dialog state)

- [ ] **Step 1: Create the wizard dialog**

Create `CostCalculator/web/components/ReportDialog.tsx`:

```tsx
"use client";
import { useState } from "react";
import { Modal } from "./Modal";
import { Icon } from "./ui";

type RangeKind = "month" | "year" | "custom";
const SECTIONS: { key: string; title: string; desc: string; on: boolean }[] = [
  { key: "kpis", title: "Summary KPIs", desc: "Income, spent, net saved, savings rate", on: true },
  { key: "income", title: "Income & spending", desc: "Totals and cash-flow overview", on: true },
  { key: "categories", title: "Category breakdown", desc: "Spending by category with chart", on: true },
  { key: "savings", title: "Savings", desc: "Deposits per savings account", on: true },
  { key: "period", title: "Period breakdown", desc: "Income, spent & saved per cycle", on: true },
  { key: "lends", title: "Lends", desc: "Given, taken & settled", on: false },
];

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function ReportDialog({ onClose }: { onClose: () => void }) {
  const now = new Date();
  const [step, setStep] = useState<1 | 2>(1);
  const [kind, setKind] = useState<RangeKind>("month");
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [from, setFrom] = useState(`${now.getFullYear()}-01-01`);
  const [to, setTo] = useState(`${now.getFullYear()}-12-31`);
  const [secs, setSecs] = useState<Record<string, boolean>>(Object.fromEntries(SECTIONS.map((s) => [s.key, s.on])));

  const years = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];

  const resolveRange = () => {
    if (kind === "month") return { f: `${year}-${pad(month + 1)}-01`, t: `${year}-${pad(month + 1)}-${pad(lastDay(year, month))}` };
    if (kind === "year") return { f: `${year}-01-01`, t: `${year}-12-31` };
    return { f: from, t: to };
  };

  const download = () => {
    const { f, t } = resolveRange();
    const keys = SECTIONS.filter((s) => secs[s.key]).map((s) => s.key).join(",");
    window.open(`/statement?from=${f}&to=${t}&sections=${keys}`, "_blank", "noopener");
    onClose();
  };

  const footer = step === 1 ? (
    <>
      <button className="ob-btn ob-btn--ghost" onClick={onClose}>Cancel</button>
      <button className="ob-btn ob-btn--primary" onClick={() => setStep(2)}>Next <Icon name="arrow-right" /></button>
    </>
  ) : (
    <>
      <button className="ob-btn ob-btn--secondary" onClick={() => setStep(1)}><Icon name="arrow-left" /> Back</button>
      <button className="ob-btn ob-btn--primary" onClick={download}><Icon name="download" /> Download</button>
    </>
  );

  return (
    <Modal title="Download report" onClose={onClose} footer={footer} width={560}>
      <div className="wiz-tabs">
        <div className={`wiz-tab${step >= 1 ? " active" : ""}`} onClick={() => setStep(1)}><span className="wiz-no">1</span> Time range</div>
        <div className={`wiz-tab${step >= 2 ? " active" : ""}`} onClick={() => setStep(2)}><span className="wiz-no">2</span> Sections</div>
      </div>

      {step === 1 ? (
        <>
          <div className="seg">
            {(["month", "year", "custom"] as RangeKind[]).map((r) => (
              <button key={r} type="button" className={`seg-btn${kind === r ? " active" : ""}`} onClick={() => setKind(r)}>
                {r === "month" ? "Month" : r === "year" ? "Year" : "Date range"}
              </button>
            ))}
          </div>
          {kind === "month" && (
            <div className="rng-grid">
              <div className="ff"><label>Month</label><select className="ob-input" value={month} onChange={(e) => setMonth(+e.target.value)}>{MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}</select></div>
              <div className="ff"><label>Year</label><select className="ob-input" value={year} onChange={(e) => setYear(+e.target.value)}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></div>
            </div>
          )}
          {kind === "year" && (
            <div className="ff"><label>Year</label><select className="ob-input" value={year} onChange={(e) => setYear(+e.target.value)}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></div>
          )}
          {kind === "custom" && (
            <div className="rng-grid">
              <div className="ff"><label>From</label><input type="date" className="ob-input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div className="ff"><label>To</label><input type="date" className="ob-input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="rep-hint">Choose what to include in the PDF.</p>
          {SECTIONS.map((s) => (
            <label className="rep-opt" key={s.key}>
              <input type="checkbox" checked={!!secs[s.key]} onChange={(e) => setSecs((p) => ({ ...p, [s.key]: e.target.checked }))} />
              <div><span className="rt">{s.title}</span><small>{s.desc}</small></div>
            </label>
          ))}
        </>
      )}
    </Modal>
  );
}
```

- [ ] **Step 2: Add the entry point on Insights**

In `CostCalculator/web/app/(app)/insights/page.tsx`:

Add the import near the other component imports:

```tsx
import { ReportDialog } from "@/components/ReportDialog";
```

Add dialog state inside `InsightsPage` (next to the other hooks, after `const pid = selected?.id;`):

```tsx
  const [showReport, setShowReport] = useState(false);
```

(`useState` is already imported via `react` in this file? It imports `useMemo` — change the React import line `import { useMemo } from "react";` to `import { useMemo, useState } from "react";`.)

Change the header actions block from:

```tsx
      <div className="bc-actions"><button className="ob-btn ob-btn--secondary" onClick={exportCsv}><Icon name="arrow-up-from-bracket" /> Export CSV</button></div>
```

to:

```tsx
      <div className="bc-actions">
        <button className="ob-btn ob-btn--secondary" onClick={exportCsv}><Icon name="arrow-up-from-bracket" /> Export CSV</button>
        <button className="ob-btn ob-btn--primary" onClick={() => setShowReport(true)}><Icon name="file-arrow-down" /> Download report</button>
      </div>
```

Render the dialog — add just before the final closing `</>` of the component's returned fragment (after the closing `</div>` of `.page`):

```tsx
      {showReport && <ReportDialog onClose={() => setShowReport(false)} />}
```

- [ ] **Step 3: Typecheck + build**

Run: `cd CostCalculator/web && npx tsc --noEmit && npm run build`
Expected: both succeed.

- [ ] **Step 4: Verify in the browser (preview workflow)**

Start the full stack. On Insights, click **Download report** → confirm the 2-step wizard (Month/Year/Date range → Next → sections with Period checked, Lends unchecked) → **Download** opens `/statement` in a new tab showing the statement and the print dialog. Screenshot the statement page as proof. Toggle Lends on and a custom range to confirm sections/range flow through.

- [ ] **Step 5: Commit**

```bash
git add CostCalculator/web/components/ReportDialog.tsx "CostCalculator/web/app/(app)/insights/page.tsx"
git commit -m "feat(web): Download-report wizard on Insights -> print statement"
```

---

## Final verification

- [ ] **Backend:** `cd CostCalculator/backend && MONGO_URI='mongodb://localhost:27017/?directConnection=true' go test ./... && go build ./... && go vet ./...` → PASS / clean.
- [ ] **Frontend:** `cd CostCalculator/web && npx tsc --noEmit && npm run build` → both succeed.
- [ ] **Type drift:** `cd CostCalculator/backend && ./tools/check-types.sh` → up to date (no Go domain structs changed, so `types.gen.ts` is unaffected).
- [ ] **Manual:** Insights → Download report → Month → Next → Download → statement prints; repeat with Year and a custom range, and with Lends toggled on.

## Self-review (spec coverage)

| Spec item | Task |
|---|---|
| `GET /statement?from=&to=` + `StatementReport` | Tasks 1–2 |
| `{userId, date}` index | Task 2 |
| Month / Year / custom range → from/to | Task 6 (`resolveRange`) |
| Sections with defaults (period on, lends off) | Task 6 (`SECTIONS`) |
| Print-to-PDF via `window.print()` + print CSS | Tasks 4–5 |
| Print route outside app shell | Task 5 (`app/statement`) |
| Empty range / no income / bad dates | Task 1 (empty test), Task 2 (400s), Task 5 (`noActivity`, rate "—") |
| Tests | Task 1 (service), Task 2 (endpoint) |

**Consistency check:** `StatementReport` JSON keys (Go `json` tags) match the TS interface in Task 3 and the field accesses in Task 5 (`kpis.totalIncome`, `categories[].total`, `periods[].saved`, `savings[].deposited`, `lends.givenOutstanding`). Section keys (`kpis,income,categories,savings,period,lends`) are identical in Task 5 (`ALL`/`has`) and Task 6 (`SECTIONS`/`download`).
