package importer

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"
	"go.mongodb.org/mongo-driver/bson"

	"costcalculator/backend/internal/domain"
	"costcalculator/backend/internal/repo"
	"costcalculator/backend/internal/service"
)

// SheetReport summarizes what was imported from one sheet.
type SheetReport struct {
	Sheet     string   `json:"sheet"`
	Skipped   bool     `json:"skipped"`
	Expenses  int      `json:"expenses"`
	Transfers int      `json:"transfers"`
	Budget    int      `json:"budgetItems"`
	Lends     int      `json:"lends"`
	Warnings  []string `json:"warnings"`
}

type Report struct {
	Sheets []SheetReport `json:"sheets"`
}

type Importer struct {
	DB      *repo.DB
	Periods *service.Periods
}

// Run imports the mature-format sheets of a CostSheet workbook for one user.
func (im *Importer) Run(ctx context.Context, userID string, r io.Reader) (*Report, error) {
	f, err := excelize.OpenReader(r)
	if err != nil {
		return nil, fmt.Errorf("not a valid xlsx file: %w", err)
	}
	defer f.Close()

	categories, err := repo.FindAll[domain.Category](ctx, im.DB.Categories, bson.M{"userId": userID})
	if err != nil {
		return nil, err
	}
	accounts, err := repo.FindAll[domain.Account](ctx, im.DB.Accounts, bson.M{"userId": userID})
	if err != nil {
		return nil, err
	}
	catByName := map[string]*domain.Category{}
	for i := range categories {
		catByName[categories[i].Name] = &categories[i]
	}
	accByName := map[string]*domain.Account{}
	for i := range accounts {
		accByName[accounts[i].Name] = &accounts[i]
	}

	// monthly template format (downloaded from the website) — one period per file
	if isTemplate(f) {
		return im.importTemplate(ctx, userID, f, catByName, accByName)
	}

	report := &Report{}
	var imported []*domain.Period

	var matureSheets []string
	for _, sheet := range f.GetSheetList() {
		if isMatureSheet(f, sheet) {
			matureSheets = append(matureSheets, sheet)
		}
	}

	for i, sheet := range matureSheets {
		sr := SheetReport{Sheet: sheet}
		isFirst, isLast := i == 0, i == len(matureSheets)-1

		hash := sheetHash(f, sheet)
		dup, err := repo.FindOne[bson.M](ctx, im.DB.Imports, bson.M{"userId": userID, "sheet": sheet, "hash": hash})
		if err != nil {
			return nil, err
		}
		if dup != nil {
			sr.Skipped = true
			report.Sheets = append(report.Sheets, sr)
			continue
		}

		period, err := im.importSheet(ctx, f, sheet, userID, catByName, accByName, &sr, isFirst, isLast)
		if err != nil {
			return nil, fmt.Errorf("sheet %s: %w", sheet, err)
		}
		if period != nil {
			imported = append(imported, period)
		}
		if _, err := im.DB.Imports.InsertOne(ctx, bson.M{
			"_id": repo.NewID(), "userId": userID, "sheet": sheet, "hash": hash, "at": time.Now().UTC(),
		}); err != nil {
			return nil, err
		}
		report.Sheets = append(report.Sheets, sr)
	}

	// Chain periods oldest -> newest and close all but the last.
	sort.Slice(imported, func(i, j int) bool { return imported[i].StartDate.Before(imported[j].StartDate) })
	for i, p := range imported {
		if i > 0 {
			repo.UpdateByID(ctx, im.DB.Periods, userID, p.ID, bson.M{"previousPeriodId": imported[i-1].ID})
			p.PreviousPeriodID = imported[i-1].ID
		}
	}
	for i, p := range imported {
		if i < len(imported)-1 {
			if err := im.Periods.Close(ctx, userID, p.ID); err != nil {
				return nil, fmt.Errorf("closing %s: %w", p.Name, err)
			}
		}
	}
	return report, nil
}

// duplicatesExisting reports the name of an existing period whose range shares
// a start date with, contains, or is contained by [start, end]; "" when none.
func (im *Importer) duplicatesExisting(ctx context.Context, userID string, start, end time.Time) (string, error) {
	existing, err := repo.FindAll[domain.Period](ctx, im.DB.Periods, bson.M{
		"userId":    userID,
		"startDate": bson.M{"$lte": end},
		"endDate":   bson.M{"$gte": start},
	})
	if err != nil {
		return "", err
	}
	for _, other := range existing {
		sameStart := other.StartDate.Equal(start)
		contains := !other.StartDate.After(start) && !other.EndDate.Before(end)
		contained := !start.After(other.StartDate) && !end.Before(other.EndDate)
		if sameStart || contains || contained {
			return other.Name, nil
		}
	}
	return "", nil
}

// expenseDateRange scans the expense table (column P) for its min/max dates.
func expenseDateRange(f *excelize.File, sheet string) (time.Time, time.Time) {
	var min, max time.Time
	for r := 3; r <= 1000; r++ {
		d, ok := cellDate(f, sheet, "P", r)
		if !ok {
			continue
		}
		if min.IsZero() || d.Before(min) {
			min = d
		}
		if max.IsZero() || d.After(max) {
			max = d
		}
	}
	return min, max
}

// isMatureSheet detects the stable June-25+ layout by its expense table header.
func isMatureSheet(f *excelize.File, sheet string) bool {
	pd, _ := f.GetCellValue(sheet, "P2")
	q, _ := f.GetCellValue(sheet, "Q2")
	return strings.TrimSpace(pd) == "Date" && strings.TrimSpace(q) == "Category"
}

func (im *Importer) importSheet(
	ctx context.Context, f *excelize.File, sheet, userID string,
	catByName map[string]*domain.Category, accByName map[string]*domain.Account,
	sr *SheetReport, first, last bool,
) (*domain.Period, error) {
	warn := func(format string, args ...any) { sr.Warnings = append(sr.Warnings, fmt.Sprintf(format, args...)) }

	getCat := func(name string) *domain.Category {
		if c, ok := catByName[name]; ok {
			return c
		}
		c := &domain.Category{
			ID: repo.NewID(), UserID: userID, Name: name, Kind: domain.CategoryExpense,
			Subcategories: []domain.Subcategory{}, Active: true,
		}
		im.DB.Categories.InsertOne(ctx, c)
		catByName[name] = c
		warn("created missing category %q", name)
		return c
	}
	getAcc := func(name string) *domain.Account {
		if a, ok := accByName[name]; ok {
			return a
		}
		a := &domain.Account{ID: repo.NewID(), UserID: userID, Name: name, Kind: domain.AccountBank, Active: true}
		im.DB.Accounts.InsertOne(ctx, a)
		accByName[name] = a
		warn("created missing account %q", name)
		return a
	}

	// --- period date range from the daily panel (I column, rows 4..40) ---
	var minDate, maxDate time.Time
	for r := 4; r <= 40; r++ {
		d, ok := cellDate(f, sheet, "I", r)
		if !ok {
			continue
		}
		if minDate.IsZero() || d.Before(minDate) {
			minDate = d
		}
		if maxDate.IsZero() || d.After(maxDate) {
			maxDate = d
		}
	}
	if minDate.IsZero() {
		warn("no daily panel dates found; sheet skipped")
		sr.Skipped = true
		return nil, nil
	}

	period := &domain.Period{
		ID: repo.NewID(), UserID: userID, Name: sheet,
		StartDate: minDate, EndDate: maxDate, Status: domain.PeriodOpen,
		OpeningBalances: []domain.AccountAmount{}, OpeningSavings: []domain.AccountAmount{},
	}

	// --- opening balances from Financial Status "Start with" (first sheet only) ---
	if first {
		for r := 4; r <= 14; r++ {
			name, _ := f.GetCellValue(sheet, fmt.Sprintf("L%d", r))
			name = strings.TrimSpace(name)
			if name == "" || name == "Type" {
				continue
			}
			amount, ok := cellPaisa(f, sheet, "N", r)
			if !ok || amount == 0 {
				continue
			}
			if acc, ok := accByName[name]; ok {
				period.OpeningBalances = append(period.OpeningBalances, domain.AccountAmount{AccountID: acc.ID, Amount: amount})
			}
		}
		// savings opening: block starting at row with L=="Savings", names below with "Prev" in N
		for r := 30; r <= 45; r++ {
			label, _ := f.GetCellValue(sheet, fmt.Sprintf("L%d", r))
			if strings.TrimSpace(label) != "Savings" {
				continue
			}
			for sr2 := r + 2; sr2 <= r+8; sr2++ {
				name, _ := f.GetCellValue(sheet, fmt.Sprintf("L%d", sr2))
				name = strings.TrimSpace(name)
				if name == "" || name == "Type" {
					continue
				}
				if acc, ok := accByName[name]; ok && acc.Kind == domain.AccountSavings {
					if v, ok := cellPaisa(f, sheet, "N", sr2); ok {
						period.OpeningSavings = append(period.OpeningSavings, domain.AccountAmount{AccountID: acc.ID, Amount: v})
					}
				}
			}
			break
		}
	}
	// Salary cycles legitimately overlap a few days at the boundaries, so only
	// flag ranges that share a start date or fully contain one another — the
	// signature of a copied sheet whose daily-panel dates were never updated.
	// When that happens, fall back to the expense table's own dates; the
	// entries are real even when the panel is stale.
	if dup, err := im.duplicatesExisting(ctx, userID, minDate, maxDate); err != nil {
		return nil, err
	} else if dup != "" {
		expMin, expMax := expenseDateRange(f, sheet)
		if expMin.IsZero() {
			warn("date range %s – %s duplicates period %q and the sheet has no dated expenses; sheet skipped",
				minDate.Format("2006-01-02"), maxDate.Format("2006-01-02"), dup)
			sr.Skipped = true
			return nil, nil
		}
		if dup2, err := im.duplicatesExisting(ctx, userID, expMin, expMax); err != nil {
			return nil, err
		} else if dup2 != "" {
			warn("date range %s – %s duplicates period %q — check the sheet's daily panel dates; sheet skipped",
				minDate.Format("2006-01-02"), maxDate.Format("2006-01-02"), dup2)
			sr.Skipped = true
			return nil, nil
		}
		warn("daily panel range %s – %s duplicates period %q; using the expense dates %s – %s instead",
			minDate.Format("2006-01-02"), maxDate.Format("2006-01-02"), dup,
			expMin.Format("2006-01-02"), expMax.Format("2006-01-02"))
		period.StartDate, period.EndDate = expMin, expMax
	}
	if _, err := im.DB.Periods.InsertOne(ctx, period); err != nil {
		return nil, err
	}

	// --- expenses: P=date Q=category R=subcategory S=payment T=amount U=remarks ---
	for r := 3; r <= 1000; r++ {
		catName, _ := f.GetCellValue(sheet, fmt.Sprintf("Q%d", r))
		catName = strings.TrimSpace(catName)
		if catName == "" {
			continue
		}
		date, ok := cellDate(f, sheet, "P", r)
		if !ok {
			warn("row %d: expense without valid date skipped", r)
			continue
		}
		amount, ok := cellPaisa(f, sheet, "T", r)
		if !ok {
			warn("row %d: expense without amount skipped", r)
			continue
		}
		sub, _ := f.GetCellValue(sheet, fmt.Sprintf("R%d", r))
		payName, _ := f.GetCellValue(sheet, fmt.Sprintf("S%d", r))
		remarks, _ := f.GetCellValue(sheet, fmt.Sprintf("U%d", r))
		cat := getCat(catName)
		acc := getAcc(strings.TrimSpace(payName))

		var breakdown []int64
		if formula, _ := f.GetCellFormula(sheet, fmt.Sprintf("T%d", r)); formula != "" {
			if _, parts, err := domain.ParseAmountExpr(formula); err == nil {
				breakdown = parts
			}
		}
		e := domain.Expense{
			ID: repo.NewID(), UserID: userID, PeriodID: period.ID, Date: date,
			CategoryID: cat.ID, Subcategory: strings.TrimSpace(sub), AccountID: acc.ID,
			Amount: amount, Breakdown: breakdown, Remarks: strings.TrimSpace(remarks),
		}
		if _, err := im.DB.Expenses.InsertOne(ctx, e); err != nil {
			return nil, err
		}
		sr.Expenses++
	}

	// --- transfers: B=date C=fee D=amount E=from F=to (rows 4..39) ---
	for r := 4; r <= 39; r++ {
		from, _ := f.GetCellValue(sheet, fmt.Sprintf("E%d", r))
		to, _ := f.GetCellValue(sheet, fmt.Sprintf("F%d", r))
		from, to = strings.TrimSpace(from), strings.TrimSpace(to)
		if from == "" || to == "" || from == "None" || to == "None" {
			continue
		}
		amount, ok := cellPaisa(f, sheet, "D", r)
		if !ok || amount == 0 {
			continue
		}
		date, ok := cellDate(f, sheet, "B", r)
		if !ok {
			date = period.StartDate
			warn("row %d: transfer without date, using period start", r)
		}
		fee, _ := cellPaisa(f, sheet, "C", r)
		t := domain.Transfer{
			ID: repo.NewID(), UserID: userID, PeriodID: period.ID, Date: date,
			FromAccountID: getAcc(from).ID, ToAccountID: getAcc(to).ID, Amount: amount, Fee: fee,
		}
		if _, err := im.DB.Transfers.InsertOne(ctx, t); err != nil {
			return nil, err
		}
		sr.Transfers++
	}

	// --- budget block: rows 44..80, B=category (carried), F=subcategory, I=budget ---
	items := []domain.BudgetItem{}
	currentCat := ""
	for r := 44; r <= 80; r++ {
		if b, _ := f.GetCellValue(sheet, fmt.Sprintf("B%d", r)); strings.TrimSpace(b) != "" {
			v := strings.TrimSpace(b)
			if v != "Category" && !strings.HasPrefix(v, "C O N S") {
				currentCat = v
			}
			if strings.HasPrefix(v, "C O N S") { // constraints section reached
				break
			}
		}
		sub, _ := f.GetCellValue(sheet, fmt.Sprintf("F%d", r))
		sub = strings.TrimSpace(sub)
		if sub == "" || sub == "Subcategory" || currentCat == "" {
			continue
		}
		amount, ok := cellPaisa(f, sheet, "I", r)
		if !ok {
			continue
		}
		if _, exists := catByName[currentCat]; !exists {
			continue
		}
		items = append(items, domain.BudgetItem{CategoryID: catByName[currentCat].ID, Subcategory: sub, Amount: amount})
	}
	if len(items) > 0 {
		b := domain.Budget{ID: repo.NewID(), UserID: userID, PeriodID: period.ID, Items: items}
		if _, err := im.DB.Budgets.InsertOne(ctx, b); err != nil {
			return nil, err
		}
		sr.Budget = len(items)
	}

	// --- lends: header rows "LEND GIVEN TO" / "LEND TAKEN FROM" in column L ---
	if last { // the register carries forward each month; the latest sheet holds the current state
		for r := 10; r <= 40; r++ {
			label, _ := f.GetCellValue(sheet, fmt.Sprintf("L%d", r))
			label = strings.TrimSpace(label)
			var lt domain.LendType
			switch label {
			case "LEND GIVEN TO":
				lt = domain.LendGiven
			case "LEND TAKEN FROM":
				lt = domain.LendTaken
			default:
				continue
			}
			for lr := r + 2; lr <= r+8; lr++ {
				m, _ := f.GetCellValue(sheet, fmt.Sprintf("M%d", lr))
				n, _ := f.GetCellValue(sheet, fmt.Sprintf("N%d", lr))
				m, n = strings.TrimSpace(m), strings.TrimSpace(n)
				if m == "" && n == "" {
					continue
				}
				if m == "Given To" || m == "Taken From" || m == "Current" {
					continue
				}
				// columns vary between sheets: person/amount may be swapped
				var person string
				var amount int64
				if v, ok := cellPaisa(f, sheet, "M", lr); ok && v != 0 {
					amount, person = v, n
				} else if v, ok := cellPaisa(f, sheet, "N", lr); ok && v != 0 {
					amount, person = v, m
				} else {
					continue
				}
				if person == "" {
					continue
				}
				date, ok := cellDate(f, sheet, "L", lr)
				if !ok {
					date = period.StartDate
				}
				l := domain.Lend{
					ID: repo.NewID(), UserID: userID, Type: lt, Person: person, Date: date,
					Amount: amount, Settlements: []domain.Settlement{}, Status: domain.LendOpen,
				}
				if _, err := im.DB.Lends.InsertOne(ctx, l); err != nil {
					return nil, err
				}
				sr.Lends++
			}
		}
	}
	return period, nil
}

// cellPaisa reads a numeric cell (cached value for formulas) as paisa.
func cellPaisa(f *excelize.File, sheet, col string, row int) (int64, bool) {
	raw, err := f.GetCellValue(sheet, fmt.Sprintf("%s%d", col, row), excelize.Options{RawCellValue: true})
	if err != nil || strings.TrimSpace(raw) == "" {
		return 0, false
	}
	v, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil {
		return 0, false
	}
	return domain.TakaToPaisa(v), true
}

// cellDate reads a date cell, handling Excel serials and common string formats.
func cellDate(f *excelize.File, sheet, col string, row int) (time.Time, bool) {
	axis := fmt.Sprintf("%s%d", col, row)
	raw, err := f.GetCellValue(sheet, axis, excelize.Options{RawCellValue: true})
	if err != nil || strings.TrimSpace(raw) == "" {
		return time.Time{}, false
	}
	raw = strings.TrimSpace(raw)
	if serial, err := strconv.ParseFloat(raw, 64); err == nil {
		t, err := excelize.ExcelDateToTime(serial, false)
		if err != nil || t.Year() < 2000 {
			return time.Time{}, false
		}
		return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC), true
	}
	for _, layout := range []string{"2006-01-02", "02-01-06", "2/1/2006", "02/01/2006"} {
		if t, err := time.Parse(layout, raw); err == nil {
			return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC), true
		}
	}
	return time.Time{}, false
}

// sheetHash fingerprints the cells the importer reads, for idempotent re-runs.
func sheetHash(f *excelize.File, sheet string) string {
	h := sha256.New()
	rows, _ := f.GetRows(sheet, excelize.Options{RawCellValue: true})
	for _, row := range rows {
		for _, c := range row {
			io.WriteString(h, c)
			io.WriteString(h, "|")
		}
		io.WriteString(h, "\n")
	}
	return hex.EncodeToString(h.Sum(nil))
}
