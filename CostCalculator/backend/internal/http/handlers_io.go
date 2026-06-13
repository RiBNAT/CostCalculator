package http

import (
	"encoding/csv"
	"fmt"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"

	"costcalculator/backend/internal/domain"
	"costcalculator/backend/internal/importer"
	"costcalculator/backend/internal/repo"
	"costcalculator/backend/internal/template"
)

type ioHandlers struct {
	db  *repo.DB
	imp *importer.Importer
}

// importExcel accepts a multipart "file" field containing the CostSheet workbook.
func (h *ioHandlers) importExcel(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		BadRequest(c, "multipart field 'file' is required")
		return
	}
	r, err := file.Open()
	if err != nil {
		Internal(c, err)
		return
	}
	defer r.Close()
	report, err := h.imp.Run(c, userID(c), r)
	if err != nil {
		BadRequest(c, err.Error())
		return
	}
	c.JSON(200, report)
}

// downloadTemplate streams a blank monthly template personalized with the
// user's categories and accounts (dropdowns + prefilled rows).
func (h *ioHandlers) downloadTemplate(c *gin.Context) {
	uid := userID(c)
	cats, err := repo.FindAll[domain.Category](c, h.db.Categories, bson.M{"userId": uid})
	if err != nil {
		Internal(c, err)
		return
	}
	accs, err := repo.FindAll[domain.Account](c, h.db.Accounts, bson.M{"userId": uid})
	if err != nil {
		Internal(c, err)
		return
	}
	f, err := template.Generate(cats, accs)
	if err != nil {
		Internal(c, err)
		return
	}
	defer f.Close()
	c.Header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	c.Header("Content-Disposition", `attachment; filename="cost-calculator-monthly-template.xlsx"`)
	if err := f.Write(c.Writer); err != nil {
		Internal(c, err)
	}
}

// exportCSV streams a period's expenses and transfers as CSV.
func (h *ioHandlers) exportCSV(c *gin.Context) {
	uid := userID(c)
	periodID := c.Param("id")
	period, err := repo.ByID[domain.Period](c, h.db.Periods, uid, periodID)
	if err != nil {
		Internal(c, err)
		return
	}
	if period == nil {
		NotFound(c)
		return
	}
	expenses, err := repo.FindAll[domain.Expense](c, h.db.Expenses, bson.M{"userId": uid, "periodId": periodID},
		options.Find().SetSort(bson.D{{Key: "date", Value: 1}}))
	if err != nil {
		Internal(c, err)
		return
	}
	transfers, err := repo.FindAll[domain.Transfer](c, h.db.Transfers, bson.M{"userId": uid, "periodId": periodID},
		options.Find().SetSort(bson.D{{Key: "date", Value: 1}}))
	if err != nil {
		Internal(c, err)
		return
	}
	cats, _ := repo.FindAll[domain.Category](c, h.db.Categories, bson.M{"userId": uid})
	accs, _ := repo.FindAll[domain.Account](c, h.db.Accounts, bson.M{"userId": uid})
	catName := map[string]string{}
	for _, x := range cats {
		catName[x.ID] = x.Name
	}
	accName := map[string]string{}
	for _, x := range accs {
		accName[x.ID] = x.Name
	}

	c.Header("Content-Type", "text/csv")
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.csv"`, period.Name))
	w := csv.NewWriter(c.Writer)
	defer w.Flush()

	w.Write([]string{"type", "date", "category", "subcategory", "account/from", "to", "amount", "fee", "remarks"})
	for _, e := range expenses {
		w.Write([]string{
			"expense", e.Date.Format("2006-01-02"), catName[e.CategoryID], e.Subcategory,
			accName[e.AccountID], "", domain.FormatTaka(e.Amount), "", e.Remarks,
		})
	}
	for _, t := range transfers {
		w.Write([]string{
			"transfer", t.Date.Format("2006-01-02"), "", "",
			accName[t.FromAccountID], accName[t.ToAccountID],
			domain.FormatTaka(t.Amount), domain.FormatTaka(t.Fee), t.Note,
		})
	}
}
