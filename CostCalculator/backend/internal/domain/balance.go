package domain

// ComputeBalances replays a period's transfers and expenses over the opening
// balances, mirroring the Excel Financial Status formulas:
//
//	balance = opening − Σ outgoing(amount+fee) + Σ incoming(amount) − Σ expenses paid from account
//
// Accounts that appear only in transfers (e.g. virtual LendGiven) start at 0.
func ComputeBalances(opening map[string]int64, transfers []Transfer, expenses []Expense) map[string]int64 {
	bal := make(map[string]int64, len(opening))
	for id, v := range opening {
		bal[id] = v
	}
	for _, tr := range transfers {
		bal[tr.FromAccountID] -= tr.Amount + tr.Fee
		bal[tr.ToAccountID] += tr.Amount
	}
	for _, e := range expenses {
		bal[e.AccountID] -= e.Amount
	}
	return bal
}

// InHand totals the balances of liquid accounts (cash, bank, mobile banking).
func InHand(balances map[string]int64, accounts []Account) int64 {
	var total int64
	for _, a := range accounts {
		if a.Liquid() {
			total += balances[a.ID]
		}
	}
	return total
}

// SavingsBalances computes current savings per savings account: opening plus
// deposits recorded as expenses whose subcategory equals the account name.
func SavingsBalances(opening map[string]int64, savingsAccounts []Account, expenses []Expense) map[string]int64 {
	byName := make(map[string]string, len(savingsAccounts)) // name -> id
	bal := make(map[string]int64, len(savingsAccounts))
	for _, a := range savingsAccounts {
		byName[a.Name] = a.ID
		bal[a.ID] = opening[a.ID]
	}
	for _, e := range expenses {
		if id, ok := byName[e.Subcategory]; ok {
			bal[id] += e.Amount
		}
	}
	return bal
}
