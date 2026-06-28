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

// Savings history across multiple periods must reflect each period's savings
// deposits (expenses whose subcategory == a savings account name) — exercises
// the batched LoadPeriodData/ClosingBalancesFrom path.
func TestSavingsHistoryAcrossPeriods(t *testing.T) {
	uri := os.Getenv("MONGO_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017/?directConnection=true"
	}
	dbName := fmt.Sprintf("costcalc_batch_test_%d", time.Now().UnixNano())
	db, err := repo.Connect(context.Background(), uri, dbName)
	if err != nil {
		t.Skipf("mongo not available: %v", err)
	}
	defer db.Client.Database(dbName).Drop(context.Background())
	ctx := context.Background()

	uid := "u1"
	// One savings account named "S"; deposits are expenses with subcategory "S".
	sav := domain.Account{ID: repo.NewID(), UserID: uid, Name: "S", Kind: domain.AccountSavings, Active: true}
	if _, err := db.Accounts.InsertOne(ctx, sav); err != nil {
		t.Fatal(err)
	}
	p1 := domain.Period{ID: repo.NewID(), UserID: uid, Name: "P1",
		StartDate: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), EndDate: time.Date(2026, 1, 31, 0, 0, 0, 0, time.UTC),
		Status: domain.PeriodOpen, OpeningBalances: []domain.AccountAmount{}, OpeningSavings: []domain.AccountAmount{}}
	p2 := domain.Period{ID: repo.NewID(), UserID: uid, Name: "P2", PreviousPeriodID: p1.ID,
		StartDate: time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC), EndDate: time.Date(2026, 2, 28, 0, 0, 0, 0, time.UTC),
		Status: domain.PeriodOpen, OpeningBalances: []domain.AccountAmount{}, OpeningSavings: []domain.AccountAmount{}}
	if _, err := db.Periods.InsertMany(ctx, []any{p1, p2}); err != nil {
		t.Fatal(err)
	}
	// A savings deposit in P1 (paisa): subcategory "S" credits the "S" account.
	if _, err := db.Expenses.InsertOne(ctx, domain.Expense{
		ID: repo.NewID(), UserID: uid, PeriodID: p1.ID, Date: p1.StartDate,
		CategoryID: "c1", Subcategory: "S", AccountID: "cash", Amount: 5000,
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
	// P2 has no savings deposits and opening savings are zero.
	if pts[1].Total != 0 {
		t.Errorf("P2 savings total = %d, want 0", pts[1].Total)
	}
}
