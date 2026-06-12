package importer

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"
	"go.mongodb.org/mongo-driver/bson"

	"ribnat/backend/internal/domain"
	"ribnat/backend/internal/repo"
	tpl "ribnat/backend/internal/template"
)

// isTemplate reports whether the workbook is a Ribnat monthly template.
func isTemplate(f *excelize.File) bool {
	v, _ := f.GetCellValue(tpl.SheetConfig, "A1")
	return strings.TrimSpace(v) == tpl.Marker
}

// refResolver maps category/account names to documents, creating missing ones
// with a warning (the same lenient behavior as the legacy CostSheet import).
type refResolver struct {
	im     *Importer
	userID string
	cats   map[string]*domain.Category
	accs   map[string]*domain.Account
	warn   func(format string, args ...any)
}

func (r *refResolver) category(ctx context.Context, name string) *domain.Category {
	if c, ok := r.cats[name]; ok {
		return c
	}
	c := &domain.Category{
		ID: repo.NewID(), UserID: r.userID, Name: name, Kind: domain.CategoryExpense,
		Subcategories: []domain.Subcategory{}, Active: true,
	}
	r.im.DB.Categories.InsertOne(ctx, c)
	r.cats[name] = c
	r.warn("created missing category %q", name)
	return c
}

func (r *refResolver) account(ctx context.Context, name string) *domain.Account {
	if a, ok := r.accs[name]; ok {
		return a
	}
	a := &domain.Account{ID: repo.NewID(), UserID: r.userID, Name: name, Kind: domain.AccountBank, Active: true}
	r.im.DB.Accounts.InsertOne(ctx, a)
	r.accs[name] = a
	r.warn("created missing account %q", name)
	return a
}

// importTemplate imports one period from a filled monthly template.
func (im *Importer) importTemplate(
	ctx context.Context, userID string, f *excelize.File,
	catByName map[string]*domain.Category, accByName map[string]*domain.Account,
) (*Report, error) {
	name, _ := f.GetCellValue(tpl.SheetConfig, "B4")
	name = strings.TrimSpace(name)
	start, okS := cellDate(f, tpl.SheetConfig, "B", 5)
	end, okE := cellDate(f, tpl.SheetConfig, "B", 6)
	if name == "" || !okS || !okE || end.Before(start) {
		return nil, fmt.Errorf("Config sheet: Period Name (B4), Start Date (B5) and End Date (B6) must be filled with a valid range")
	}

	sr := SheetReport{Sheet: name}
	report := &Report{Sheets: []SheetReport{}}
	warn := func(format string, args ...any) { sr.Warnings = append(sr.Warnings, fmt.Sprintf(format, args...)) }
	res := &refResolver{im: im, userID: userID, cats: catByName, accs: accByName, warn: warn}

	// idempotency: one combined hash across all template sheets
	h := sha256.New()
	for _, s := range []string{tpl.SheetConfig, tpl.SheetExpenses, tpl.SheetTransactions, tpl.SheetBudget, tpl.SheetFinance, tpl.SheetPlanner} {
		io.WriteString(h, sheetHash(f, s))
	}
	hash := hex.EncodeToString(h.Sum(nil))
	key := "template:" + name
	dup, err := repo.FindOne[bson.M](ctx, im.DB.Imports, bson.M{"userId": userID, "sheet": key, "hash": hash})
	if err != nil {
		return nil, err
	}
	if dup != nil {
		sr.Skipped = true
		report.Sheets = append(report.Sheets, sr)
		return report, nil
	}

	if err := im.Periods.CheckOverlap(ctx, userID, start, end, ""); err != nil {
		return nil, fmt.Errorf("period %q (%s – %s) overlaps an existing period", name,
			start.Format("2006-01-02"), end.Format("2006-01-02"))
	}

	period := &domain.Period{
		ID: repo.NewID(), UserID: userID, Name: name,
		StartDate: start, EndDate: end, Status: domain.PeriodOpen,
		OpeningBalances: []domain.AccountAmount{}, OpeningSavings: []domain.AccountAmount{},
	}
	prev, err := im.Periods.Previous(ctx, userID, start)
	if err != nil {
		return nil, err
	}
	if prev != nil {
		period.PreviousPeriodID = prev.ID
	}

	// ---- Finance: openings, savings openings, new lends ----
	sec := ""
	lends := 0
	for r := 1; r <= 200; r++ {
		a, _ := f.GetCellValue(tpl.SheetFinance, fmt.Sprintf("A%d", r))
		a = strings.TrimSpace(a)
		switch a {
		case tpl.SecOpening, tpl.SecSavings, tpl.SecLends:
			sec = a
			continue
		case "", "Account", "Type (given/taken)":
			continue
		}
		switch sec {
		case tpl.SecOpening, tpl.SecSavings:
			amount, ok := cellPaisa(f, tpl.SheetFinance, "B", r)
			if !ok {
				continue
			}
			acc := res.account(ctx, a)
			entry := domain.AccountAmount{AccountID: acc.ID, Amount: amount}
			if sec == tpl.SecSavings {
				period.OpeningSavings = append(period.OpeningSavings, entry)
			} else {
				period.OpeningBalances = append(period.OpeningBalances, entry)
			}
		case tpl.SecLends:
			lt := domain.LendType(strings.ToLower(a))
			if lt != domain.LendGiven && lt != domain.LendTaken {
				warn("Finance row %d: lend type must be given or taken, got %q", r, a)
				continue
			}
			person, _ := f.GetCellValue(tpl.SheetFinance, fmt.Sprintf("B%d", r))
			amount, okA := cellPaisa(f, tpl.SheetFinance, "D", r)
			if strings.TrimSpace(person) == "" || !okA || amount <= 0 {
				warn("Finance row %d: lend needs person and amount; skipped", r)
				continue
			}
			date, ok := cellDate(f, tpl.SheetFinance, "C", r)
			if !ok {
				date = start
			}
			notes, _ := f.GetCellValue(tpl.SheetFinance, fmt.Sprintf("E%d", r))
			l := domain.Lend{
				ID: repo.NewID(), UserID: userID, Type: lt, Person: strings.TrimSpace(person),
				Date: date, Amount: amount, Settlements: []domain.Settlement{},
				Status: domain.LendOpen, Notes: strings.TrimSpace(notes),
			}
			if _, err := im.DB.Lends.InsertOne(ctx, l); err != nil {
				return nil, err
			}
			lends++
		}
	}
	sr.Lends = lends

	// no openings provided -> roll over from the previous period's closing
	if len(period.OpeningBalances) == 0 && prev != nil {
		balances, savings, err := im.Periods.ClosingBalances(ctx, prev)
		if err != nil {
			return nil, err
		}
		for id, v := range balances {
			period.OpeningBalances = append(period.OpeningBalances, domain.AccountAmount{AccountID: id, Amount: v})
		}
		if len(period.OpeningSavings) == 0 {
			for id, v := range savings {
				period.OpeningSavings = append(period.OpeningSavings, domain.AccountAmount{AccountID: id, Amount: v})
			}
		}
		warn("no opening balances in Finance sheet; rolled over from %q", prev.Name)
	}

	if _, err := im.DB.Periods.InsertOne(ctx, period); err != nil {
		return nil, err
	}

	// ---- Expenses: Date | Category | Subcategory | Payment | Amount | Remarks ----
	for r := 2; r <= 2000; r++ {
		catName, _ := f.GetCellValue(tpl.SheetExpenses, fmt.Sprintf("B%d", r))
		catName = strings.TrimSpace(catName)
		amount, okA := cellPaisa(f, tpl.SheetExpenses, "E", r)
		if catName == "" && !okA {
			continue
		}
		date, okD := cellDate(f, tpl.SheetExpenses, "A", r)
		if catName == "" || !okA || !okD {
			warn("Expenses row %d: needs date, category and amount; skipped", r)
			continue
		}
		sub, _ := f.GetCellValue(tpl.SheetExpenses, fmt.Sprintf("C%d", r))
		pay, _ := f.GetCellValue(tpl.SheetExpenses, fmt.Sprintf("D%d", r))
		remarks, _ := f.GetCellValue(tpl.SheetExpenses, fmt.Sprintf("F%d", r))
		var breakdown []int64
		if formula, _ := f.GetCellFormula(tpl.SheetExpenses, fmt.Sprintf("E%d", r)); formula != "" {
			if _, parts, err := domain.ParseAmountExpr(formula); err == nil {
				breakdown = parts
			}
		}
		e := domain.Expense{
			ID: repo.NewID(), UserID: userID, PeriodID: period.ID, Date: date,
			CategoryID: res.category(ctx, catName).ID, Subcategory: strings.TrimSpace(sub),
			AccountID: res.account(ctx, strings.TrimSpace(pay)).ID,
			Amount: amount, Breakdown: breakdown, Remarks: strings.TrimSpace(remarks),
		}
		if _, err := im.DB.Expenses.InsertOne(ctx, e); err != nil {
			return nil, err
		}
		sr.Expenses++
	}

	// ---- Transactions: Date | From | To | Amount | Fee | Note ----
	for r := 2; r <= 2000; r++ {
		from, _ := f.GetCellValue(tpl.SheetTransactions, fmt.Sprintf("B%d", r))
		to, _ := f.GetCellValue(tpl.SheetTransactions, fmt.Sprintf("C%d", r))
		from, to = strings.TrimSpace(from), strings.TrimSpace(to)
		if from == "" && to == "" {
			continue
		}
		amount, okA := cellPaisa(f, tpl.SheetTransactions, "D", r)
		date, okD := cellDate(f, tpl.SheetTransactions, "A", r)
		if from == "" || to == "" || !okA || amount <= 0 || !okD {
			warn("Transactions row %d: needs date, from, to and amount; skipped", r)
			continue
		}
		fee, _ := cellPaisa(f, tpl.SheetTransactions, "E", r)
		note, _ := f.GetCellValue(tpl.SheetTransactions, fmt.Sprintf("F%d", r))
		t := domain.Transfer{
			ID: repo.NewID(), UserID: userID, PeriodID: period.ID, Date: date,
			FromAccountID: res.account(ctx, from).ID, ToAccountID: res.account(ctx, to).ID,
			Amount: amount, Fee: fee, Note: strings.TrimSpace(note),
		}
		if _, err := im.DB.Transfers.InsertOne(ctx, t); err != nil {
			return nil, err
		}
		sr.Transfers++
	}

	// ---- Budget: Category | Subcategory | Amount ----
	items := []domain.BudgetItem{}
	for r := 2; r <= 500; r++ {
		catName, _ := f.GetCellValue(tpl.SheetBudget, fmt.Sprintf("A%d", r))
		sub, _ := f.GetCellValue(tpl.SheetBudget, fmt.Sprintf("B%d", r))
		catName, sub = strings.TrimSpace(catName), strings.TrimSpace(sub)
		if catName == "" || sub == "" {
			continue
		}
		amount, ok := cellPaisa(f, tpl.SheetBudget, "C", r)
		if !ok || amount <= 0 {
			continue
		}
		items = append(items, domain.BudgetItem{CategoryID: res.category(ctx, catName).ID, Subcategory: sub, Amount: amount})
	}
	if len(items) > 0 {
		b := domain.Budget{ID: repo.NewID(), UserID: userID, PeriodID: period.ID, Items: items}
		if _, err := im.DB.Budgets.InsertOne(ctx, b); err != nil {
			return nil, err
		}
		sr.Budget = len(items)
	}

	// ---- Planner: payment windows + reminders ----
	sec = ""
	for r := 1; r <= 200; r++ {
		a, _ := f.GetCellValue(tpl.SheetPlanner, fmt.Sprintf("A%d", r))
		a = strings.TrimSpace(a)
		switch a {
		case tpl.SecWindows, tpl.SecReminders:
			sec = a
			continue
		case "", "Name", "Date":
			continue
		}
		switch sec {
		case tpl.SecWindows:
			ws, okS := cellDate(f, tpl.SheetPlanner, "C", r)
			we, okE := cellDate(f, tpl.SheetPlanner, "D", r)
			if !okS || !okE || we.Before(ws) {
				warn("Planner row %d: payment window needs a valid start/end; skipped", r)
				continue
			}
			sub, _ := f.GetCellValue(tpl.SheetPlanner, fmt.Sprintf("B%d", r))
			sub = strings.TrimSpace(sub)
			w := domain.PaymentWindow{
				ID: repo.NewID(), UserID: userID, PeriodID: period.ID, Name: a,
				Subcategory: sub, StartDate: ws, EndDate: we,
			}
			for _, c := range res.cats {
				for _, s := range c.Subcategories {
					if s.Name == sub {
						w.CategoryID = c.ID
					}
				}
			}
			if _, err := im.DB.Windows.InsertOne(ctx, w); err != nil {
				return nil, err
			}
		case tpl.SecReminders:
			// column A holds the date in the reminders section
			date, ok := cellDate(f, tpl.SheetPlanner, "A", r)
			task, _ := f.GetCellValue(tpl.SheetPlanner, fmt.Sprintf("B%d", r))
			task = strings.TrimSpace(task)
			if !ok || task == "" {
				continue
			}
			rem := domain.Reminder{ID: repo.NewID(), UserID: userID, Date: date, Task: task}
			if _, err := im.DB.Reminders.InsertOne(ctx, rem); err != nil {
				return nil, err
			}
		}
	}

	if _, err := im.DB.Imports.InsertOne(ctx, bson.M{
		"_id": repo.NewID(), "userId": userID, "sheet": key, "hash": hash, "at": time.Now().UTC(),
	}); err != nil {
		return nil, err
	}
	report.Sheets = append(report.Sheets, sr)
	return report, nil
}
