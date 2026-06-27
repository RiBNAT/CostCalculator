package service

import (
	"context"
	"errors"
	"time"

	"go.mongodb.org/mongo-driver/bson"

	"costcalculator/backend/internal/domain"
	"costcalculator/backend/internal/repo"
)

var (
	ErrPeriodNotFound  = errors.New("period not found")
	ErrPeriodClosed    = errors.New("period is closed")
	ErrPeriodNotLatest = errors.New("only the latest period can be reopened")
	ErrPeriodOverlap   = errors.New("period overlaps an existing period")
)

type Periods struct{ DB *repo.DB }

// CheckOverlap returns ErrPeriodOverlap when [start,end] intersects another period.
func (p *Periods) CheckOverlap(ctx context.Context, userID string, start, end time.Time, excludeID string) error {
	filter := bson.M{
		"userId":    userID,
		"startDate": bson.M{"$lte": end},
		"endDate":   bson.M{"$gte": start},
	}
	if excludeID != "" {
		filter["_id"] = bson.M{"$ne": excludeID}
	}
	n, err := p.DB.Periods.CountDocuments(ctx, filter)
	if err != nil {
		return err
	}
	if n > 0 {
		return ErrPeriodOverlap
	}
	return nil
}

// Previous returns the latest period ending before start, or nil.
func (p *Periods) Previous(ctx context.Context, userID string, start time.Time) (*domain.Period, error) {
	all, err := repo.FindAll[domain.Period](ctx, p.DB.Periods, bson.M{
		"userId": userID, "endDate": bson.M{"$lt": start},
	})
	if err != nil {
		return nil, err
	}
	var prev *domain.Period
	for i := range all {
		if prev == nil || all[i].EndDate.After(prev.EndDate) {
			prev = &all[i]
		}
	}
	return prev, nil
}

// ClosingBalances replays a period and returns (accountBalances, savingsBalances).
func (p *Periods) ClosingBalances(ctx context.Context, period *domain.Period) (map[string]int64, map[string]int64, error) {
	userID := period.UserID
	expenses, err := repo.FindAll[domain.Expense](ctx, p.DB.Expenses, bson.M{"userId": userID, "periodId": period.ID})
	if err != nil {
		return nil, nil, err
	}
	transfers, err := repo.FindAll[domain.Transfer](ctx, p.DB.Transfers, bson.M{"userId": userID, "periodId": period.ID})
	if err != nil {
		return nil, nil, err
	}
	accounts, err := repo.FindAll[domain.Account](ctx, p.DB.Accounts, bson.M{"userId": userID})
	if err != nil {
		return nil, nil, err
	}

	opening := map[string]int64{}
	for _, ob := range period.OpeningBalances {
		opening[ob.AccountID] = ob.Amount
	}
	balances := domain.ComputeBalances(opening, transfers, expenses)

	openingSav := map[string]int64{}
	for _, os := range period.OpeningSavings {
		openingSav[os.AccountID] = os.Amount
	}
	var savingsAccounts []domain.Account
	for _, a := range accounts {
		if a.Kind == domain.AccountSavings {
			savingsAccounts = append(savingsAccounts, a)
		}
	}
	savings := domain.SavingsBalances(openingSav, savingsAccounts, expenses)
	return balances, savings, nil
}

// Close marks a period closed and pushes its closing balances into the
// opening balances of every downstream period (chain recompute).
func (p *Periods) Close(ctx context.Context, userID, periodID string) error {
	period, err := repo.ByID[domain.Period](ctx, p.DB.Periods, userID, periodID)
	if err != nil {
		return err
	}
	if period == nil {
		return ErrPeriodNotFound
	}
	if _, err := repo.UpdateByID(ctx, p.DB.Periods, userID, periodID, bson.M{"status": domain.PeriodClosed}); err != nil {
		return err
	}
	period.Status = domain.PeriodClosed
	return p.recomputeDownstream(ctx, period)
}

func (p *Periods) recomputeDownstream(ctx context.Context, period *domain.Period) error {
	for {
		next, err := repo.FindOne[domain.Period](ctx, p.DB.Periods, bson.M{
			"userId": period.UserID, "previousPeriodId": period.ID,
		})
		if err != nil {
			return err
		}
		if next == nil {
			return nil
		}
		balances, savings, err := p.ClosingBalances(ctx, period)
		if err != nil {
			return err
		}
		next.OpeningBalances = toAccountAmounts(balances)
		next.OpeningSavings = toAccountAmounts(savings)
		if _, err := repo.UpdateByID(ctx, p.DB.Periods, period.UserID, next.ID, bson.M{
			"openingBalances": next.OpeningBalances,
			"openingSavings":  next.OpeningSavings,
		}); err != nil {
			return err
		}
		period = next
	}
}

// Reopen reopens the latest (terminal) period only.
func (p *Periods) Reopen(ctx context.Context, userID, periodID string) error {
	successor, err := repo.FindOne[domain.Period](ctx, p.DB.Periods, bson.M{
		"userId": userID, "previousPeriodId": periodID,
	})
	if err != nil {
		return err
	}
	if successor != nil {
		return ErrPeriodNotLatest
	}
	ok, err := repo.UpdateByID(ctx, p.DB.Periods, userID, periodID, bson.M{"status": domain.PeriodOpen})
	if err != nil {
		return err
	}
	if !ok {
		return ErrPeriodNotFound
	}
	return nil
}

// Repair re-derives the opening balances of every period downstream of the
// given period from its (recomputed) closing balances. It is idempotent and
// heals chains left inconsistent by a partial close or a back-dated edit.
func (p *Periods) Repair(ctx context.Context, userID, periodID string) error {
	period, err := repo.ByID[domain.Period](ctx, p.DB.Periods, userID, periodID)
	if err != nil {
		return err
	}
	if period == nil {
		return ErrPeriodNotFound
	}
	return p.recomputeDownstream(ctx, period)
}

// RequireOpen loads a period and fails when it is closed.
func (p *Periods) RequireOpen(ctx context.Context, userID, periodID string) (*domain.Period, error) {
	period, err := repo.ByID[domain.Period](ctx, p.DB.Periods, userID, periodID)
	if err != nil {
		return nil, err
	}
	if period == nil {
		return nil, ErrPeriodNotFound
	}
	if period.Status == domain.PeriodClosed {
		return nil, ErrPeriodClosed
	}
	return period, nil
}

func toAccountAmounts(m map[string]int64) []domain.AccountAmount {
	out := make([]domain.AccountAmount, 0, len(m))
	for id, v := range m {
		out = append(out, domain.AccountAmount{AccountID: id, Amount: v})
	}
	return out
}
