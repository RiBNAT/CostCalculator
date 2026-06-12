package domain

import (
	"testing"
	"time"
)

func TestBudgetReport(t *testing.T) {
	d := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	accounts := []Account{
		{ID: "cash", Kind: AccountCash},
		{ID: "bkash", Kind: AccountMobile},
	}
	items := []BudgetItem{
		{CategoryID: "rent", Subcategory: "HouseRent", Amount: 1300000},
		{CategoryID: "rent", Subcategory: "WifiBill", Amount: 84000},
		{CategoryID: "bazar", Subcategory: "DailyBazar", Amount: 450000},
	}
	expenses := []Expense{
		{Date: d, CategoryID: "rent", Subcategory: "HouseRent", AccountID: "cash", Amount: 1300000},
		{Date: d, CategoryID: "rent", Subcategory: "WifiBill", AccountID: "bkash", Amount: 84000},
		{Date: d, CategoryID: "bazar", Subcategory: "DailyBazar", AccountID: "cash", Amount: 295000},
		// unbudgeted spend still shows as actual
		{Date: d, CategoryID: "bazar", Subcategory: "Fruits", AccountID: "cash", Amount: 41000},
	}

	rep := BudgetReport(items, expenses, accounts)

	find := func(cat, sub string) *BudgetLine {
		for i := range rep.Lines {
			if rep.Lines[i].CategoryID == cat && rep.Lines[i].Subcategory == sub {
				return &rep.Lines[i]
			}
		}
		return nil
	}
	hr := find("rent", "HouseRent")
	if hr == nil || hr.Actual != 1300000 || hr.Remaining != 0 {
		t.Fatalf("HouseRent line wrong: %+v", hr)
	}
	fruits := find("bazar", "Fruits")
	if fruits == nil || fruits.Budget != 0 || fruits.Actual != 41000 || fruits.Remaining != -41000 {
		t.Fatalf("unbudgeted Fruits line wrong: %+v", fruits)
	}

	if rep.Totals.Budget != 1834000 {
		t.Errorf("total budget = %d, want 1834000", rep.Totals.Budget)
	}
	if rep.Totals.Actual != 1720000 {
		t.Errorf("total actual = %d, want 1720000", rep.Totals.Actual)
	}
	// cash actual = 1300000+295000+41000; non-cash = 84000 (bkash)
	if rep.Totals.CashActual != 1636000 || rep.Totals.NonCashActual != 84000 {
		t.Errorf("cash split wrong: cash=%d nonCash=%d", rep.Totals.CashActual, rep.Totals.NonCashActual)
	}

	var rentRollup *CategoryRollup
	for i := range rep.Categories {
		if rep.Categories[i].CategoryID == "rent" {
			rentRollup = &rep.Categories[i]
		}
	}
	if rentRollup == nil || rentRollup.Budget != 1384000 || rentRollup.Actual != 1384000 {
		t.Fatalf("rent rollup wrong: %+v", rentRollup)
	}
}

func TestRolloverItems(t *testing.T) {
	d := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	accounts := []Account{{ID: "cash", Kind: AccountCash}}
	prevItems := []BudgetItem{
		{CategoryID: "bazar", Subcategory: "DailyBazar", Amount: 500000}, // budgeted 5000
		{CategoryID: "rent", Subcategory: "HouseRent", Amount: 1000000},  // budgeted 10000
	}
	prevExpenses := []Expense{
		{Date: d, CategoryID: "bazar", Subcategory: "DailyBazar", AccountID: "cash", Amount: 300000}, // spent 3000 → 2000 left
		{Date: d, CategoryID: "rent", Subcategory: "HouseRent", AccountID: "cash", Amount: 1200000},  // overspent → no rollover
	}

	out := RolloverItems(prevItems, prevExpenses, accounts)

	if len(out) != 1 {
		t.Fatalf("rollover items = %d, want 1 (only positive leftovers): %+v", len(out), out)
	}
	if out[0].CategoryID != "bazar" || out[0].Subcategory != "DailyBazar" || out[0].Amount != 200000 {
		t.Errorf("rollover item = %+v, want bazar/DailyBazar 200000", out[0])
	}
}
