// Package template generates the blank monthly-import workbook that users can
// download from the website, fill in, and upload on the Import page.
package template

import (
	"fmt"

	"github.com/xuri/excelize/v2"

	"ribnat/backend/internal/domain"
)

// Marker identifies a workbook as a Ribnat monthly template (Config!A1).
const Marker = "RIBNAT_TEMPLATE_V1"

// Sheet names of the template format.
const (
	SheetConfig       = "Config"
	SheetExpenses     = "Expenses"
	SheetTransactions = "Transactions"
	SheetBudget       = "Budget"
	SheetFinance      = "Finance"
	SheetPlanner      = "Planner"
)

// Section headers inside Finance and Planner (column A).
const (
	SecOpening   = "OPENING BALANCES"
	SecSavings   = "SAVINGS OPENING"
	SecLends     = "NEW LENDS"
	SecWindows   = "PAYMENT WINDOWS"
	SecReminders = "REMINDERS"
)

const maxRows = 1000

// Generate builds a blank one-month template personalized with the user's
// categories and accounts (used for dropdown validation and prefilled rows).
// All amounts in the template are entered in taka.
func Generate(categories []domain.Category, accounts []domain.Account) (*excelize.File, error) {
	f := excelize.NewFile()
	f.SetSheetName("Sheet1", SheetConfig)
	for _, s := range []string{SheetExpenses, SheetTransactions, SheetBudget, SheetFinance, SheetPlanner} {
		if _, err := f.NewSheet(s); err != nil {
			return nil, err
		}
	}

	header, err := f.NewStyle(&excelize.Style{
		Font: &excelize.Font{Bold: true, Color: "FFFFFF", Size: 11},
		Fill: excelize.Fill{Type: "pattern", Color: []string{"3949AB"}, Pattern: 1},
	})
	if err != nil {
		return nil, err
	}
	section, err := f.NewStyle(&excelize.Style{
		Font: &excelize.Font{Bold: true, Color: "1A237E", Size: 12},
	})
	if err != nil {
		return nil, err
	}
	dateFmt, err := f.NewStyle(&excelize.Style{NumFmt: 14}) // m/d/yy
	if err != nil {
		return nil, err
	}
	label, err := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true}})
	if err != nil {
		return nil, err
	}

	// ---------- reference lists ----------
	var catNames, subNames, payNames, allAccNames, savNames []string
	var liquidOrVirtual, savingsAccs []domain.Account
	for _, c := range categories {
		if !c.Active {
			continue
		}
		catNames = append(catNames, c.Name)
		for _, s := range c.Subcategories {
			if s.Active {
				subNames = append(subNames, s.Name)
			}
		}
	}
	for _, a := range accounts {
		if !a.Active {
			continue
		}
		allAccNames = append(allAccNames, a.Name)
		switch {
		case a.Kind == domain.AccountSavings:
			savNames = append(savNames, a.Name)
			savingsAccs = append(savingsAccs, a)
		case a.Liquid():
			payNames = append(payNames, a.Name)
			liquidOrVirtual = append(liquidOrVirtual, a)
		default: // virtual accounts participate in transfers and openings
			liquidOrVirtual = append(liquidOrVirtual, a)
		}
	}

	// ---------- Config ----------
	f.SetCellValue(SheetConfig, "A1", Marker)
	f.SetCellValue(SheetConfig, "A2", "Ribnat monthly template — fill the green cells, then upload on the Import page. Amounts are in taka.")
	f.SetCellValue(SheetConfig, "A4", "Period Name")
	f.SetCellValue(SheetConfig, "A5", "Start Date")
	f.SetCellValue(SheetConfig, "A6", "End Date")
	f.SetCellStyle(SheetConfig, "A4", "A6", label)
	f.SetCellStyle(SheetConfig, "B5", "B6", dateFmt)
	fillable, _ := f.NewStyle(&excelize.Style{
		Fill:   excelize.Fill{Type: "pattern", Color: []string{"E6F4EA"}, Pattern: 1},
		Border: []excelize.Border{{Type: "bottom", Color: "0F9D58", Style: 1}},
	})
	f.SetCellStyle(SheetConfig, "B4", "B4", fillable)
	fillableDate, _ := f.NewStyle(&excelize.Style{
		NumFmt: 14,
		Fill:   excelize.Fill{Type: "pattern", Color: []string{"E6F4EA"}, Pattern: 1},
		Border: []excelize.Border{{Type: "bottom", Color: "0F9D58", Style: 1}},
	})
	f.SetCellStyle(SheetConfig, "B5", "B6", fillableDate)

	refCols := []struct {
		col   string
		title string
		items []string
	}{
		{"D", "Categories", catNames},
		{"E", "Subcategories", subNames},
		{"F", "Payment Methods", payNames},
		{"G", "All Accounts", allAccNames},
		{"H", "Savings Accounts", savNames},
	}
	for _, rc := range refCols {
		f.SetCellValue(SheetConfig, rc.col+"1", rc.title)
		f.SetCellStyle(SheetConfig, rc.col+"1", rc.col+"1", header)
		for i, v := range rc.items {
			f.SetCellValue(SheetConfig, fmt.Sprintf("%s%d", rc.col, i+2), v)
		}
	}
	f.SetColWidth(SheetConfig, "A", "B", 22)
	f.SetColWidth(SheetConfig, "D", "H", 20)

	listRef := func(col string, n int) string {
		if n < 1 {
			n = 1
		}
		return fmt.Sprintf("%s!$%s$2:$%s$%d", SheetConfig, col, col, n+1)
	}

	addDropdown := func(sheet, sqref, ref string) error {
		dv := excelize.NewDataValidation(true)
		dv.Sqref = sqref
		dv.SetSqrefDropList(ref)
		return f.AddDataValidation(sheet, dv)
	}

	// ---------- Expenses ----------
	expHeaders := []string{"Date", "Category", "Subcategory", "Payment Method", "Amount (taka)", "Remarks"}
	for i, h := range expHeaders {
		cell := fmt.Sprintf("%c1", 'A'+i)
		f.SetCellValue(SheetExpenses, cell, h)
	}
	f.SetCellStyle(SheetExpenses, "A1", "F1", header)
	f.SetCellStyle(SheetExpenses, "A2", fmt.Sprintf("A%d", maxRows), dateFmt)
	f.SetColWidth(SheetExpenses, "A", "F", 18)
	f.SetColWidth(SheetExpenses, "F", "F", 30)
	if err := addDropdown(SheetExpenses, fmt.Sprintf("B2:B%d", maxRows), listRef("D", len(catNames))); err != nil {
		return nil, err
	}
	if err := addDropdown(SheetExpenses, fmt.Sprintf("C2:C%d", maxRows), listRef("E", len(subNames))); err != nil {
		return nil, err
	}
	if err := addDropdown(SheetExpenses, fmt.Sprintf("D2:D%d", maxRows), listRef("F", len(payNames))); err != nil {
		return nil, err
	}

	// ---------- Transactions ----------
	trHeaders := []string{"Date", "From", "To", "Amount (taka)", "Fee (taka)", "Note"}
	for i, h := range trHeaders {
		f.SetCellValue(SheetTransactions, fmt.Sprintf("%c1", 'A'+i), h)
	}
	f.SetCellStyle(SheetTransactions, "A1", "F1", header)
	f.SetCellStyle(SheetTransactions, "A2", fmt.Sprintf("A%d", maxRows), dateFmt)
	f.SetColWidth(SheetTransactions, "A", "F", 18)
	for _, col := range []string{"B", "C"} {
		if err := addDropdown(SheetTransactions, fmt.Sprintf("%s2:%s%d", col, col, maxRows), listRef("G", len(allAccNames))); err != nil {
			return nil, err
		}
	}

	// ---------- Budget (prefilled with category/subcategory rows) ----------
	for i, h := range []string{"Category", "Subcategory", "Budget (taka)"} {
		f.SetCellValue(SheetBudget, fmt.Sprintf("%c1", 'A'+i), h)
	}
	f.SetCellStyle(SheetBudget, "A1", "C1", header)
	f.SetColWidth(SheetBudget, "A", "C", 22)
	row := 2
	for _, c := range categories {
		if !c.Active {
			continue
		}
		for _, s := range c.Subcategories {
			if !s.Active {
				continue
			}
			f.SetCellValue(SheetBudget, fmt.Sprintf("A%d", row), c.Name)
			f.SetCellValue(SheetBudget, fmt.Sprintf("B%d", row), s.Name)
			row++
		}
	}

	// ---------- Finance ----------
	f.SetCellValue(SheetFinance, "A1", SecOpening)
	f.SetCellStyle(SheetFinance, "A1", "A1", section)
	f.SetCellValue(SheetFinance, "A2", "Account")
	f.SetCellValue(SheetFinance, "B2", "Amount (taka)")
	f.SetCellStyle(SheetFinance, "A2", "B2", header)
	row = 3
	for _, a := range liquidOrVirtual {
		f.SetCellValue(SheetFinance, fmt.Sprintf("A%d", row), a.Name)
		row++
	}
	row++ // gap
	f.SetCellValue(SheetFinance, fmt.Sprintf("A%d", row), SecSavings)
	f.SetCellStyle(SheetFinance, fmt.Sprintf("A%d", row), fmt.Sprintf("A%d", row), section)
	row++
	f.SetCellValue(SheetFinance, fmt.Sprintf("A%d", row), "Account")
	f.SetCellValue(SheetFinance, fmt.Sprintf("B%d", row), "Amount (taka)")
	f.SetCellStyle(SheetFinance, fmt.Sprintf("A%d", row), fmt.Sprintf("B%d", row), header)
	row++
	for _, a := range savingsAccs {
		f.SetCellValue(SheetFinance, fmt.Sprintf("A%d", row), a.Name)
		row++
	}
	row++ // gap
	f.SetCellValue(SheetFinance, fmt.Sprintf("A%d", row), SecLends)
	f.SetCellStyle(SheetFinance, fmt.Sprintf("A%d", row), fmt.Sprintf("A%d", row), section)
	row++
	lendHeaderRow := row
	for i, h := range []string{"Type (given/taken)", "Person", "Date", "Amount (taka)", "Notes"} {
		f.SetCellValue(SheetFinance, fmt.Sprintf("%c%d", 'A'+i, row), h)
	}
	f.SetCellStyle(SheetFinance, fmt.Sprintf("A%d", row), fmt.Sprintf("E%d", row), header)
	f.SetCellStyle(SheetFinance, fmt.Sprintf("C%d", lendHeaderRow+1), fmt.Sprintf("C%d", lendHeaderRow+40), dateFmt)
	dvLend := excelize.NewDataValidation(true)
	dvLend.Sqref = fmt.Sprintf("A%d:A%d", lendHeaderRow+1, lendHeaderRow+40)
	dvLend.SetDropList([]string{"given", "taken"})
	if err := f.AddDataValidation(SheetFinance, dvLend); err != nil {
		return nil, err
	}
	f.SetColWidth(SheetFinance, "A", "E", 20)

	// ---------- Planner ----------
	f.SetCellValue(SheetPlanner, "A1", SecWindows)
	f.SetCellStyle(SheetPlanner, "A1", "A1", section)
	for i, h := range []string{"Name", "Linked Subcategory", "Start Date", "End Date"} {
		f.SetCellValue(SheetPlanner, fmt.Sprintf("%c2", 'A'+i), h)
	}
	f.SetCellStyle(SheetPlanner, "A2", "D2", header)
	f.SetCellStyle(SheetPlanner, "C3", "D42", dateFmt)
	if err := addDropdown(SheetPlanner, "B3:B42", listRef("E", len(subNames))); err != nil {
		return nil, err
	}

	f.SetCellValue(SheetPlanner, "A45", SecReminders)
	f.SetCellStyle(SheetPlanner, "A45", "A45", section)
	f.SetCellValue(SheetPlanner, "A46", "Date")
	f.SetCellValue(SheetPlanner, "B46", "Task")
	f.SetCellStyle(SheetPlanner, "A46", "B46", header)
	f.SetCellStyle(SheetPlanner, "A47", "A90", dateFmt)
	f.SetColWidth(SheetPlanner, "A", "D", 20)
	f.SetColWidth(SheetPlanner, "B", "B", 28)

	f.SetActiveSheet(0)
	return f, nil
}
