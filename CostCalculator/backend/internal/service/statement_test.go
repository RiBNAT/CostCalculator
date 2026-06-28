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

	ext := domain.Account{ID: repo.NewID(), UserID: uid, Name: "Add", Kind: domain.AccountVirtual, VirtualRole: domain.RoleExternal, Active: true}
	sav := domain.Account{ID: repo.NewID(), UserID: uid, Name: "S", Kind: domain.AccountSavings, Active: true}
	cash := domain.Account{ID: repo.NewID(), UserID: uid, Name: "Cash", Kind: domain.AccountCash, Active: true}
	if _, err := db.Accounts.InsertMany(ctx, []any{ext, sav, cash}); err != nil {
		t.Fatal(err)
	}
	food := domain.Category{ID: repo.NewID(), UserID: uid, Name: "Food", Kind: domain.CategoryExpense, Active: true}
	svc := domain.Category{ID: repo.NewID(), UserID: uid, Name: "Savings", Kind: domain.CategorySavings, Active: true}
	if _, err := db.Categories.InsertMany(ctx, []any{food, svc}); err != nil {
		t.Fatal(err)
	}
	p1 := domain.Period{ID: repo.NewID(), UserID: uid, Name: "Jan 2026", StartDate: day("2026-01-01"), EndDate: day("2026-01-31"), Status: domain.PeriodOpen}
	if _, err := db.Periods.InsertOne(ctx, p1); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Transfers.InsertOne(ctx, domain.Transfer{ID: repo.NewID(), UserID: uid, PeriodID: p1.ID, Date: day("2026-01-05"), FromAccountID: ext.ID, ToAccountID: cash.ID, Amount: 100000}); err != nil {
		t.Fatal(err)
	}
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
