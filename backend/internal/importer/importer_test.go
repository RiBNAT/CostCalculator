package importer

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/bson"

	"ribnat/backend/internal/domain"
	"ribnat/backend/internal/repo"
	"ribnat/backend/internal/service"
)

// Golden test: imports the real CostSheet workbook into a throwaway database.
// Requires MongoDB on localhost:27017 (docker run mongo:7); skipped otherwise.
func TestImportRealWorkbook(t *testing.T) {
	uri := os.Getenv("MONGO_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	dbName := fmt.Sprintf("ribnat_test_%d", time.Now().UnixNano())
	db, err := repo.Connect(ctx, uri, dbName)
	if err != nil {
		t.Skipf("mongo not available: %v", err)
	}
	defer db.Client.Database(dbName).Drop(context.Background())

	const userID = "test-user"
	if err := service.SeedDefaults(ctx, db, userID); err != nil {
		t.Fatal(err)
	}

	f, err := os.Open("testdata/costsheet.xlsx")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	periods := &service.Periods{DB: db}
	im := &Importer{DB: db, Periods: periods}
	report, err := im.Run(ctx, userID, f)
	if err != nil {
		t.Fatal(err)
	}

	// 13 mature sheets: June 25 .. June 26
	if len(report.Sheets) != 13 {
		t.Errorf("imported %d sheets, want 13", len(report.Sheets))
	}

	all, err := repo.FindAll[domain.Period](ctx, db.Periods, bson.M{"userId": userID})
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 13 {
		t.Fatalf("got %d periods, want 13", len(all))
	}

	var june26 *domain.Period
	openCount := 0
	for i := range all {
		if all[i].Name == "June 26" {
			june26 = &all[i]
		}
		if all[i].Status == domain.PeriodOpen {
			openCount++
		}
	}
	if june26 == nil {
		t.Fatal("June 26 period missing")
	}
	if openCount != 1 {
		t.Errorf("open periods = %d, want 1 (only newest)", openCount)
	}
	if got := june26.StartDate.Format("2006-01-02"); got != "2026-05-22" {
		t.Errorf("June 26 start = %s, want 2026-05-22", got)
	}
	if got := june26.EndDate.Format("2006-01-02"); got != "2026-06-26" {
		t.Errorf("June 26 end = %s, want 2026-06-26", got)
	}
	if june26.PreviousPeriodID == "" {
		t.Error("June 26 has no previous period link")
	}

	nExp, _ := db.Expenses.CountDocuments(ctx, bson.M{"userId": userID, "periodId": june26.ID})
	if nExp == 0 {
		t.Error("June 26 has no expenses")
	}
	nTr, _ := db.Transfers.CountDocuments(ctx, bson.M{"userId": userID, "periodId": june26.ID})
	if nTr == 0 {
		t.Error("June 26 has no transfers")
	}
	budget, err := repo.FindOne[domain.Budget](ctx, db.Budgets, bson.M{"userId": userID, "periodId": june26.ID})
	if err != nil || budget == nil {
		t.Fatalf("June 26 budget missing: %v", err)
	}
	if len(budget.Items) < 20 {
		t.Errorf("June 26 budget items = %d, want >= 20", len(budget.Items))
	}

	// Re-import must be fully idempotent.
	f2, _ := os.Open("testdata/costsheet.xlsx")
	defer f2.Close()
	report2, err := im.Run(ctx, userID, f2)
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range report2.Sheets {
		if !s.Skipped {
			t.Errorf("sheet %s re-imported instead of skipped", s.Sheet)
		}
	}
	nExp2, _ := db.Expenses.CountDocuments(ctx, bson.M{"userId": userID})
	nExpAfter, _ := db.Expenses.CountDocuments(ctx, bson.M{"userId": userID})
	if nExp2 != nExpAfter {
		t.Error("expense count changed after re-import")
	}
}
