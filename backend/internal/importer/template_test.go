package importer

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/bson"

	"ribnat/backend/internal/domain"
	"ribnat/backend/internal/repo"
	"ribnat/backend/internal/service"
	tpl "ribnat/backend/internal/template"
)

// Round-trip: generate the blank monthly template from seeded refdata, fill it
// like a user would, import it, and verify every section landed in MongoDB.
func TestTemplateRoundTrip(t *testing.T) {
	uri := os.Getenv("MONGO_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	dbName := fmt.Sprintf("ribnat_tpl_test_%d", time.Now().UnixNano())
	db, err := repo.Connect(ctx, uri, dbName)
	if err != nil {
		t.Skipf("mongo not available: %v", err)
	}
	defer db.Client.Database(dbName).Drop(context.Background())

	const userID = "tpl-user"
	if err := service.SeedDefaults(ctx, db, userID); err != nil {
		t.Fatal(err)
	}
	cats, _ := repo.FindAll[domain.Category](ctx, db.Categories, bson.M{"userId": userID})
	accs, _ := repo.FindAll[domain.Account](ctx, db.Accounts, bson.M{"userId": userID})

	f, err := tpl.Generate(cats, accs)
	if err != nil {
		t.Fatal(err)
	}

	// --- fill like a user ---
	f.SetCellValue(tpl.SheetConfig, "B4", "July 26")
	f.SetCellValue(tpl.SheetConfig, "B5", time.Date(2026, 6, 27, 0, 0, 0, 0, time.UTC))
	f.SetCellValue(tpl.SheetConfig, "B6", time.Date(2026, 7, 26, 0, 0, 0, 0, time.UTC))

	// expenses
	f.SetCellValue(tpl.SheetExpenses, "A2", time.Date(2026, 6, 28, 0, 0, 0, 0, time.UTC))
	f.SetCellValue(tpl.SheetExpenses, "B2", "Bazar")
	f.SetCellValue(tpl.SheetExpenses, "C2", "DailyBazar")
	f.SetCellValue(tpl.SheetExpenses, "D2", "Cash")
	f.SetCellValue(tpl.SheetExpenses, "E2", 740.5)
	f.SetCellValue(tpl.SheetExpenses, "F2", "groceries")
	f.SetCellValue(tpl.SheetExpenses, "A3", time.Date(2026, 6, 29, 0, 0, 0, 0, time.UTC))
	f.SetCellValue(tpl.SheetExpenses, "B3", "ExtraExpenses")
	f.SetCellValue(tpl.SheetExpenses, "C3", "Tea")
	f.SetCellValue(tpl.SheetExpenses, "D3", "bKash")
	f.SetCellValue(tpl.SheetExpenses, "E3", 30)

	// transfer
	f.SetCellValue(tpl.SheetTransactions, "A2", time.Date(2026, 6, 27, 0, 0, 0, 0, time.UTC))
	f.SetCellValue(tpl.SheetTransactions, "B2", "SCB")
	f.SetCellValue(tpl.SheetTransactions, "C2", "Cash")
	f.SetCellValue(tpl.SheetTransactions, "D2", 10000)
	f.SetCellValue(tpl.SheetTransactions, "E2", 15)

	// budget: rows are prefilled with Category/Subcategory; set first two amounts
	f.SetCellValue(tpl.SheetBudget, "C2", 13000)
	f.SetCellValue(tpl.SheetBudget, "C3", 1000)

	// finance: opening balance for Cash (row 3 is first prefilled account row)
	// find the row whose A == "Cash" inside the OPENING BALANCES section
	for r := 3; r < 40; r++ {
		v, _ := f.GetCellValue(tpl.SheetFinance, fmt.Sprintf("A%d", r))
		if v == "Cash" {
			f.SetCellValue(tpl.SheetFinance, fmt.Sprintf("B%d", r), 5000)
		}
		if v == "EximBank_2.5" {
			f.SetCellValue(tpl.SheetFinance, fmt.Sprintf("B%d", r), 45000)
		}
		if v == tpl.SecLends {
			f.SetCellValue(tpl.SheetFinance, fmt.Sprintf("A%d", r+2), "given")
			f.SetCellValue(tpl.SheetFinance, fmt.Sprintf("B%d", r+2), "Mubin")
			f.SetCellValue(tpl.SheetFinance, fmt.Sprintf("C%d", r+2), time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC))
			f.SetCellValue(tpl.SheetFinance, fmt.Sprintf("D%d", r+2), 5100)
			break
		}
	}

	// planner: one window + one reminder
	f.SetCellValue(tpl.SheetPlanner, "A3", "WifiBill")
	f.SetCellValue(tpl.SheetPlanner, "B3", "WifiBill")
	f.SetCellValue(tpl.SheetPlanner, "C3", time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC))
	f.SetCellValue(tpl.SheetPlanner, "D3", time.Date(2026, 7, 5, 0, 0, 0, 0, time.UTC))
	f.SetCellValue(tpl.SheetPlanner, "A47", time.Date(2026, 7, 10, 0, 0, 0, 0, time.UTC))
	f.SetCellValue(tpl.SheetPlanner, "B47", "Renew AI subscription")

	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		t.Fatal(err)
	}

	// --- import ---
	im := &Importer{DB: db, Periods: &service.Periods{DB: db}}
	report, err := im.Run(ctx, userID, bytes.NewReader(buf.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Sheets) != 1 || report.Sheets[0].Sheet != "July 26" {
		t.Fatalf("report = %+v", report.Sheets)
	}
	rep := report.Sheets[0]
	if rep.Expenses != 2 || rep.Transfers != 1 || rep.Budget != 2 || rep.Lends != 1 {
		t.Errorf("counts wrong: %+v", rep)
	}

	// --- verify documents ---
	period, err := repo.FindOne[domain.Period](ctx, db.Periods, bson.M{"userId": userID, "name": "July 26"})
	if err != nil || period == nil {
		t.Fatalf("period missing: %v", err)
	}
	if got := period.StartDate.Format("2006-01-02"); got != "2026-06-27" {
		t.Errorf("start = %s", got)
	}
	if period.Status != domain.PeriodOpen {
		t.Errorf("status = %s, want open", period.Status)
	}

	accByID := map[string]string{}
	for _, a := range accs {
		accByID[a.ID] = a.Name
	}
	var cashOpening, savOpening int64
	for _, ob := range period.OpeningBalances {
		if accByID[ob.AccountID] == "Cash" {
			cashOpening = ob.Amount
		}
	}
	for _, os := range period.OpeningSavings {
		if accByID[os.AccountID] == "EximBank_2.5" {
			savOpening = os.Amount
		}
	}
	if cashOpening != 500000 {
		t.Errorf("cash opening = %d, want 500000 paisa", cashOpening)
	}
	if savOpening != 4500000 {
		t.Errorf("savings opening = %d, want 4500000 paisa", savOpening)
	}

	exp, _ := repo.FindAll[domain.Expense](ctx, db.Expenses, bson.M{"userId": userID, "periodId": period.ID})
	if len(exp) != 2 {
		t.Fatalf("expenses = %d", len(exp))
	}
	var groceries *domain.Expense
	for i := range exp {
		if exp[i].Remarks == "groceries" {
			groceries = &exp[i]
		}
	}
	if groceries == nil || groceries.Amount != 74050 || groceries.Subcategory != "DailyBazar" {
		t.Errorf("groceries expense wrong: %+v", groceries)
	}

	tr, _ := repo.FindAll[domain.Transfer](ctx, db.Transfers, bson.M{"userId": userID, "periodId": period.ID})
	if len(tr) != 1 || tr[0].Amount != 1000000 || tr[0].Fee != 1500 {
		t.Errorf("transfer wrong: %+v", tr)
	}

	lend, _ := repo.FindOne[domain.Lend](ctx, db.Lends, bson.M{"userId": userID, "person": "Mubin"})
	if lend == nil || lend.Amount != 510000 || lend.Type != domain.LendGiven {
		t.Errorf("lend wrong: %+v", lend)
	}

	win, _ := repo.FindOne[domain.PaymentWindow](ctx, db.Windows, bson.M{"userId": userID, "periodId": period.ID})
	if win == nil || win.Name != "WifiBill" || win.Subcategory != "WifiBill" {
		t.Errorf("window wrong: %+v", win)
	}
	rem, _ := repo.FindOne[domain.Reminder](ctx, db.Reminders, bson.M{"userId": userID})
	if rem == nil || rem.Task != "Renew AI subscription" {
		t.Errorf("reminder wrong: %+v", rem)
	}

	// --- idempotent re-import ---
	report2, err := im.Run(ctx, userID, bytes.NewReader(buf.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	if len(report2.Sheets) != 1 || !report2.Sheets[0].Skipped {
		t.Errorf("re-import not skipped: %+v", report2.Sheets)
	}
	n, _ := db.Expenses.CountDocuments(ctx, bson.M{"userId": userID})
	if n != 2 {
		t.Errorf("expenses duplicated on re-import: %d", n)
	}

	// overlapping different-content template -> clear error
	f.SetCellValue(tpl.SheetExpenses, "F2", "changed")
	var buf2 bytes.Buffer
	f.Write(&buf2)
	if _, err := im.Run(ctx, userID, bytes.NewReader(buf2.Bytes())); err == nil {
		t.Error("overlapping period accepted without error")
	}
}
