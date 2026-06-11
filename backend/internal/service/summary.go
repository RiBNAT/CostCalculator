package service

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/bson"

	"ribnat/backend/internal/domain"
	"ribnat/backend/internal/repo"
)

type AccountStatus struct {
	Account domain.Account `json:"account"`
	Opening int64          `json:"opening"`
	Current int64          `json:"current"`
}

type DailySpend struct {
	Date    string `json:"date"` // YYYY-MM-DD
	Weekday string `json:"weekday"`
	Total   int64  `json:"total"`
}

type CategoryTotal struct {
	CategoryID string `json:"categoryId"`
	Name       string `json:"name"`
	Total      int64  `json:"total"`
}

type WindowWithStatus struct {
	Window domain.PaymentWindow      `json:"window"`
	Status domain.WindowStatusResult `json:"status"`
}

type LendTotals struct {
	Given int64 `json:"given"`
	Taken int64 `json:"taken"`
}

type PeriodSummary struct {
	Period         domain.Period             `json:"period"`
	Accounts       []AccountStatus           `json:"accounts"`
	InHand         int64                     `json:"inHand"`
	DailySeries    []DailySpend              `json:"dailySeries"`
	CategoryTotals []CategoryTotal           `json:"categoryTotals"`
	Budget         domain.BudgetReportResult `json:"budget"`
	Windows        []WindowWithStatus        `json:"windows"`
	Reminders      []domain.Reminder         `json:"reminders"`
	Savings        []AccountStatus           `json:"savings"`
	LendTotals     LendTotals                `json:"lendTotals"`
}

type Summary struct {
	DB      *repo.DB
	Periods *Periods
}

func (s *Summary) Build(ctx context.Context, userID, periodID string, today time.Time) (*PeriodSummary, error) {
	period, err := repo.ByID[domain.Period](ctx, s.DB.Periods, userID, periodID)
	if err != nil {
		return nil, err
	}
	if period == nil {
		return nil, ErrPeriodNotFound
	}

	expenses, err := repo.FindAll[domain.Expense](ctx, s.DB.Expenses, bson.M{"userId": userID, "periodId": periodID})
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

	balances, savings, err := s.Periods.ClosingBalances(ctx, period)
	if err != nil {
		return nil, err
	}

	opening := map[string]int64{}
	for _, ob := range period.OpeningBalances {
		opening[ob.AccountID] = ob.Amount
	}
	openingSav := map[string]int64{}
	for _, os := range period.OpeningSavings {
		openingSav[os.AccountID] = os.Amount
	}

	sum := &PeriodSummary{Period: *period}
	for _, a := range accounts {
		if !a.Active {
			continue
		}
		st := AccountStatus{Account: a, Opening: opening[a.ID], Current: balances[a.ID]}
		switch a.Kind {
		case domain.AccountSavings:
			st.Opening = openingSav[a.ID]
			st.Current = savings[a.ID]
			sum.Savings = append(sum.Savings, st)
		default:
			sum.Accounts = append(sum.Accounts, st)
		}
	}
	sum.InHand = domain.InHand(balances, accounts)

	// Daily series across the full period range, zero-filled.
	perDay := map[string]int64{}
	for _, e := range expenses {
		perDay[e.Date.UTC().Format("2006-01-02")] += e.Amount
	}
	for d := period.StartDate.UTC(); !d.After(period.EndDate.UTC()); d = d.AddDate(0, 0, 1) {
		key := d.Format("2006-01-02")
		sum.DailySeries = append(sum.DailySeries, DailySpend{
			Date: key, Weekday: d.Weekday().String(), Total: perDay[key],
		})
	}

	// Category totals.
	catName := map[string]string{}
	for _, c := range categories {
		catName[c.ID] = c.Name
	}
	catTotals := map[string]int64{}
	for _, e := range expenses {
		catTotals[e.CategoryID] += e.Amount
	}
	for id, total := range catTotals {
		sum.CategoryTotals = append(sum.CategoryTotals, CategoryTotal{CategoryID: id, Name: catName[id], Total: total})
	}

	// Budget report.
	budget, err := repo.FindOne[domain.Budget](ctx, s.DB.Budgets, bson.M{"userId": userID, "periodId": periodID})
	if err != nil {
		return nil, err
	}
	var items []domain.BudgetItem
	if budget != nil {
		items = budget.Items
	}
	sum.Budget = domain.BudgetReport(items, expenses, accounts)

	// Payment windows with status.
	windows, err := repo.FindAll[domain.PaymentWindow](ctx, s.DB.Windows, bson.M{"userId": userID, "periodId": periodID})
	if err != nil {
		return nil, err
	}
	for _, w := range windows {
		sum.Windows = append(sum.Windows, WindowWithStatus{Window: w, Status: domain.WindowStatus(w, expenses, today)})
	}

	// Reminders due within the period (undone first by date).
	reminders, err := repo.FindAll[domain.Reminder](ctx, s.DB.Reminders, bson.M{
		"userId": userID,
		"date":   bson.M{"$gte": period.StartDate, "$lte": period.EndDate},
	})
	if err != nil {
		return nil, err
	}
	sum.Reminders = reminders

	// Lend outstanding totals.
	lends, err := repo.FindAll[domain.Lend](ctx, s.DB.Lends, bson.M{"userId": userID, "status": domain.LendOpen})
	if err != nil {
		return nil, err
	}
	for _, l := range lends {
		switch l.Type {
		case domain.LendGiven:
			sum.LendTotals.Given += l.Outstanding()
		case domain.LendTaken:
			sum.LendTotals.Taken += l.Outstanding()
		}
	}
	return sum, nil
}
