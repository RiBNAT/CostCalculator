package service

import (
	"context"
	"sort"
	"time"

	"go.mongodb.org/mongo-driver/bson"

	"costcalculator/backend/internal/domain"
	"costcalculator/backend/internal/repo"
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

type SavingsHistoryPoint struct {
	PeriodID   string    `json:"periodId"`
	PeriodName string    `json:"periodName"`
	StartDate  time.Time `json:"startDate"`
	Total      int64     `json:"total"`
}

// SavingsHistory returns the total savings balance at the end of every period,
// oldest first — one call instead of a summary request per period.
func (s *Summary) SavingsHistory(ctx context.Context, userID string) ([]SavingsHistoryPoint, error) {
	periods, err := repo.FindAll[domain.Period](ctx, s.DB.Periods, bson.M{"userId": userID})
	if err != nil {
		return nil, err
	}
	sortPeriodsByStart(periods)
	out := make([]SavingsHistoryPoint, 0, len(periods))
	for i := range periods {
		_, savings, err := s.Periods.ClosingBalances(ctx, &periods[i])
		if err != nil {
			return nil, err
		}
		var total int64
		for _, v := range savings {
			total += v
		}
		out = append(out, SavingsHistoryPoint{
			PeriodID: periods[i].ID, PeriodName: periods[i].Name,
			StartDate: periods[i].StartDate, Total: total,
		})
	}
	return out, nil
}

func sortPeriodsByStart(periods []domain.Period) {
	sort.Slice(periods, func(i, j int) bool { return periods[i].StartDate.Before(periods[j].StartDate) })
}

// trendMaxPeriods caps the year-overview series length.
const trendMaxPeriods = 12

type TrendPoint struct {
	PeriodID   string    `json:"periodId"`
	PeriodName string    `json:"periodName"`
	StartDate  time.Time `json:"startDate"`
	TotalSpend int64     `json:"totalSpend"`
	TotalSaved int64     `json:"totalSaved"`
	NetWorth   int64     `json:"netWorth"` // closing in-hand + savings
}

type CategoryComparison struct {
	CategoryID string `json:"categoryId"`
	Name       string `json:"name"`
	Current    int64  `json:"current"`
	Previous   int64  `json:"previous"`
}

type PeriodTrends struct {
	Series             []TrendPoint         `json:"series"`             // oldest first, ending at the selected period
	PreviousPeriodName string               `json:"previousPeriodName"` // "" when there is no prior period
	Comparison         []CategoryComparison `json:"comparison"`         // current vs previous per category
}

// Trends builds the dashboard year-overview series (up to the last 12 periods
// ending at the selected one) plus a current-vs-previous per-category comparison.
func (s *Summary) Trends(ctx context.Context, userID, periodID string) (*PeriodTrends, error) {
	periods, err := repo.FindAll[domain.Period](ctx, s.DB.Periods, bson.M{"userId": userID})
	if err != nil {
		return nil, err
	}
	sortPeriodsByStart(periods)

	sel := -1
	for i := range periods {
		if periods[i].ID == periodID {
			sel = i
			break
		}
	}
	if sel < 0 {
		return nil, ErrPeriodNotFound
	}

	start := sel - (trendMaxPeriods - 1)
	if start < 0 {
		start = 0
	}

	accounts, err := repo.FindAll[domain.Account](ctx, s.DB.Accounts, bson.M{"userId": userID})
	if err != nil {
		return nil, err
	}

	out := &PeriodTrends{}
	for i := start; i <= sel; i++ {
		spend, err := s.periodSpend(ctx, userID, periods[i].ID)
		if err != nil {
			return nil, err
		}
		balances, savings, err := s.Periods.ClosingBalances(ctx, &periods[i])
		if err != nil {
			return nil, err
		}
		var saved int64
		for _, v := range savings {
			saved += v
		}
		out.Series = append(out.Series, TrendPoint{
			PeriodID: periods[i].ID, PeriodName: periods[i].Name,
			StartDate: periods[i].StartDate, TotalSpend: spend, TotalSaved: saved,
			NetWorth: domain.InHand(balances, accounts) + saved,
		})
	}

	// Current vs previous per-category comparison.
	current, err := s.categorySpend(ctx, userID, periods[sel].ID)
	if err != nil {
		return nil, err
	}
	previous := map[string]int64{}
	if sel > 0 {
		out.PreviousPeriodName = periods[sel-1].Name
		previous, err = s.categorySpend(ctx, userID, periods[sel-1].ID)
		if err != nil {
			return nil, err
		}
	}

	categories, err := repo.FindAll[domain.Category](ctx, s.DB.Categories, bson.M{"userId": userID})
	if err != nil {
		return nil, err
	}
	catName := map[string]string{}
	for _, c := range categories {
		catName[c.ID] = c.Name
	}
	seen := map[string]bool{}
	for id := range current {
		seen[id] = true
	}
	for id := range previous {
		seen[id] = true
	}
	for id := range seen {
		out.Comparison = append(out.Comparison, CategoryComparison{
			CategoryID: id, Name: catName[id], Current: current[id], Previous: previous[id],
		})
	}
	sort.Slice(out.Comparison, func(i, j int) bool {
		return out.Comparison[i].Current+out.Comparison[i].Previous >
			out.Comparison[j].Current+out.Comparison[j].Previous
	})
	return out, nil
}

func (s *Summary) periodSpend(ctx context.Context, userID, periodID string) (int64, error) {
	expenses, err := repo.FindAll[domain.Expense](ctx, s.DB.Expenses, bson.M{"userId": userID, "periodId": periodID})
	if err != nil {
		return 0, err
	}
	var total int64
	for _, e := range expenses {
		total += e.Amount
	}
	return total, nil
}

func (s *Summary) categorySpend(ctx context.Context, userID, periodID string) (map[string]int64, error) {
	expenses, err := repo.FindAll[domain.Expense](ctx, s.DB.Expenses, bson.M{"userId": userID, "periodId": periodID})
	if err != nil {
		return nil, err
	}
	totals := map[string]int64{}
	for _, e := range expenses {
		totals[e.CategoryID] += e.Amount
	}
	return totals, nil
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
	// When rollover is on, fold the previous period's unspent budget into this
	// period's effective budget (positive leftovers only).
	if budget != nil && budget.Rollover && period.PreviousPeriodID != "" {
		prevBudget, err := repo.FindOne[domain.Budget](ctx, s.DB.Budgets, bson.M{"userId": userID, "periodId": period.PreviousPeriodID})
		if err != nil {
			return nil, err
		}
		prevExpenses, err := repo.FindAll[domain.Expense](ctx, s.DB.Expenses, bson.M{"userId": userID, "periodId": period.PreviousPeriodID})
		if err != nil {
			return nil, err
		}
		var prevItems []domain.BudgetItem
		if prevBudget != nil {
			prevItems = prevBudget.Items
		}
		items = append(items, domain.RolloverItems(prevItems, prevExpenses, accounts)...)
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
