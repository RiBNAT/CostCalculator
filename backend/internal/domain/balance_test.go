package domain

import (
	"testing"
	"time"
)

// Mirrors the Excel "Financial Status" panel:
// balance = opening - Σ outgoing(amount+fee) + Σ incoming(amount) - Σ expenses paid from account.
func TestComputeBalances(t *testing.T) {
	d := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	opening := map[string]int64{"cash": 232000, "scb": 38700, "bkash": 41700}

	transfers := []Transfer{
		// SCB -> Cash withdrawal 10,000 tk with 15 tk fee
		{Date: d, FromAccountID: "scb", ToAccountID: "cash", Amount: 1000000, Fee: 1500},
		// external income into SCB
		{Date: d, FromAccountID: "ext", ToAccountID: "scb", Amount: 5950000},
		// bKash -> LendGiven 5,100 with 5 fee
		{Date: d, FromAccountID: "bkash", ToAccountID: "lendgiven", Amount: 510000, Fee: 500},
	}
	expenses := []Expense{
		{Date: d, AccountID: "cash", Amount: 74000},
		{Date: d, AccountID: "bkash", Amount: 14800},
	}

	got := ComputeBalances(opening, transfers, expenses)

	want := map[string]int64{
		"cash":      232000 - 74000 + 1000000,
		"scb":       38700 - 1001500 + 5950000,
		"bkash":     41700 - 510500 - 14800,
		"lendgiven": 510000,
		"ext":       -5950000,
	}
	for id, w := range want {
		if got[id] != w {
			t.Errorf("balance[%s] = %d, want %d", id, got[id], w)
		}
	}
}

func TestInHand(t *testing.T) {
	accounts := []Account{
		{ID: "cash", Kind: AccountCash},
		{ID: "scb", Kind: AccountBank},
		{ID: "bkash", Kind: AccountMobile},
		{ID: "lendgiven", Kind: AccountVirtual, VirtualRole: RoleLendGiven},
		{ID: "exim25", Kind: AccountSavings},
	}
	balances := map[string]int64{
		"cash": 100, "scb": 200, "bkash": 300, "lendgiven": 5000, "exim25": 7000,
	}
	if got := InHand(balances, accounts); got != 600 {
		t.Errorf("InHand = %d, want 600 (liquid accounts only)", got)
	}
}

// Savings balances: opening + deposits recorded as Savings-category expenses
// whose subcategory equals the savings account name (Excel column R match).
func TestSavingsBalances(t *testing.T) {
	d := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	savingsAccounts := []Account{
		{ID: "exim25", Name: "EximBank_2.5", Kind: AccountSavings},
		{ID: "city10", Name: "CityBank_10", Kind: AccountSavings},
	}
	opening := map[string]int64{"exim25": 4250000, "city10": 1000000}
	expenses := []Expense{
		{Date: d, CategoryID: "savings", Subcategory: "EximBank_2.5", AccountID: "scb", Amount: 250000},
		{Date: d, CategoryID: "savings", Subcategory: "CityBank_10", AccountID: "scb", Amount: 1000000},
		{Date: d, CategoryID: "bazar", Subcategory: "DailyBazar", AccountID: "cash", Amount: 5000},
	}
	got := SavingsBalances(opening, savingsAccounts, expenses)
	if got["exim25"] != 4500000 {
		t.Errorf("exim25 = %d, want 4500000", got["exim25"])
	}
	if got["city10"] != 2000000 {
		t.Errorf("city10 = %d, want 2000000", got["city10"])
	}
}
