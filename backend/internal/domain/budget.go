package domain

// BudgetLine is one subcategory row of the budget report.
type BudgetLine struct {
	CategoryID  string `json:"categoryId"`
	Subcategory string `json:"subcategory"`
	Budget      int64  `json:"budget"`
	Actual      int64  `json:"actual"`
	Remaining   int64  `json:"remaining"`
}

// CategoryRollup aggregates all lines of one category.
type CategoryRollup struct {
	CategoryID string `json:"categoryId"`
	Budget     int64  `json:"budget"`
	Actual     int64  `json:"actual"`
	Remaining  int64  `json:"remaining"`
}

// BudgetTotals mirrors the Excel Total / Cash / Non-Cash footer.
type BudgetTotals struct {
	Budget        int64 `json:"budget"`
	Actual        int64 `json:"actual"`
	Remaining     int64 `json:"remaining"`
	CashActual    int64 `json:"cashActual"`
	NonCashActual int64 `json:"nonCashActual"`
}

// BudgetReportResult is the full budget-vs-actual view for a period.
type BudgetReportResult struct {
	Lines      []BudgetLine     `json:"lines"`
	Categories []CategoryRollup `json:"categories"`
	Totals     BudgetTotals     `json:"totals"`
}

type catSub struct{ cat, sub string }

// BudgetReport joins budget items with actual spend per (category, subcategory).
// Expenses without a budget line appear with Budget 0 so overspend is visible.
func BudgetReport(items []BudgetItem, expenses []Expense, accounts []Account) BudgetReportResult {
	cashAccounts := make(map[string]bool)
	for _, a := range accounts {
		if a.Kind == AccountCash {
			cashAccounts[a.ID] = true
		}
	}

	budget := make(map[catSub]int64)
	order := []catSub{}
	for _, it := range items {
		k := catSub{it.CategoryID, it.Subcategory}
		if _, seen := budget[k]; !seen {
			order = append(order, k)
		}
		budget[k] += it.Amount
	}

	actual := make(map[catSub]int64)
	var cashActual, nonCashActual int64
	for _, e := range expenses {
		k := catSub{e.CategoryID, e.Subcategory}
		if _, seen := budget[k]; !seen {
			if _, tracked := actual[k]; !tracked {
				order = append(order, k)
			}
		}
		actual[k] += e.Amount
		if cashAccounts[e.AccountID] {
			cashActual += e.Amount
		} else {
			nonCashActual += e.Amount
		}
	}

	res := BudgetReportResult{}
	catBudget := make(map[string]int64)
	catActual := make(map[string]int64)
	catOrder := []string{}
	for _, k := range order {
		line := BudgetLine{
			CategoryID:  k.cat,
			Subcategory: k.sub,
			Budget:      budget[k],
			Actual:      actual[k],
			Remaining:   budget[k] - actual[k],
		}
		res.Lines = append(res.Lines, line)
		if _, seen := catBudget[k.cat]; !seen {
			if _, seen2 := catActual[k.cat]; !seen2 {
				catOrder = append(catOrder, k.cat)
			}
		}
		catBudget[k.cat] += line.Budget
		catActual[k.cat] += line.Actual
		res.Totals.Budget += line.Budget
		res.Totals.Actual += line.Actual
	}
	for _, c := range catOrder {
		res.Categories = append(res.Categories, CategoryRollup{
			CategoryID: c,
			Budget:     catBudget[c],
			Actual:     catActual[c],
			Remaining:  catBudget[c] - catActual[c],
		})
	}
	res.Totals.Remaining = res.Totals.Budget - res.Totals.Actual
	res.Totals.CashActual = cashActual
	res.Totals.NonCashActual = nonCashActual
	return res
}
