package http

import (
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"

	"costcalculator/backend/internal/domain"
	"costcalculator/backend/internal/repo"
	"costcalculator/backend/internal/service"
)

type entryHandlers struct {
	db      *repo.DB
	periods *service.Periods
}

// --- expenses ---

type expenseReq struct {
	Date        string `json:"date" binding:"required"`
	CategoryID  string `json:"categoryId" binding:"required"`
	Subcategory string `json:"subcategory" binding:"required"`
	AccountID   string `json:"accountId" binding:"required"`
	AmountExpr  string `json:"amountExpr" binding:"required"` // taka expression, e.g. "360+20+330"
	Remarks     string `json:"remarks"`
}

func (h *entryHandlers) buildExpense(c *gin.Context, uid string, period *domain.Period, req expenseReq) (*domain.Expense, bool) {
	date, err := parseDay(req.Date)
	if err != nil {
		BadRequest(c, "invalid date, expected YYYY-MM-DD")
		return nil, false
	}
	if !dateInPeriod(date, period) {
		BadRequest(c, dateRangeMessage(period))
		return nil, false
	}
	total, parts, err := domain.ParseAmountExpr(req.AmountExpr)
	if err != nil {
		BadRequest(c, "invalid amount: "+err.Error())
		return nil, false
	}
	if total <= 0 {
		BadRequest(c, "amount must be positive")
		return nil, false
	}
	cat, err := repo.ByID[domain.Category](c, h.db.Categories, uid, req.CategoryID)
	if err != nil {
		Internal(c, err)
		return nil, false
	}
	if cat == nil {
		BadRequest(c, "unknown category")
		return nil, false
	}
	found := false
	for _, s := range cat.Subcategories {
		if s.Name == req.Subcategory {
			found = true
			break
		}
	}
	if !found {
		BadRequest(c, "subcategory does not belong to category")
		return nil, false
	}
	acc, err := repo.ByID[domain.Account](c, h.db.Accounts, uid, req.AccountID)
	if err != nil {
		Internal(c, err)
		return nil, false
	}
	if acc == nil || !acc.Active {
		BadRequest(c, "unknown or inactive account")
		return nil, false
	}
	return &domain.Expense{
		UserID: uid, PeriodID: period.ID, Date: date,
		CategoryID: req.CategoryID, Subcategory: req.Subcategory,
		AccountID: req.AccountID, Amount: total, Breakdown: parts, Remarks: req.Remarks,
	}, true
}

func (h *entryHandlers) listExpenses(c *gin.Context) {
	filter := bson.M{"userId": userID(c), "periodId": c.Param("id")}
	if v := c.Query("categoryId"); v != "" {
		filter["categoryId"] = v
	}
	if v := c.Query("subcategory"); v != "" {
		filter["subcategory"] = v
	}
	if v := c.Query("accountId"); v != "" {
		filter["accountId"] = v
	}
	if v := c.Query("q"); v != "" {
		filter["remarks"] = bson.M{"$regex": v, "$options": "i"}
	}
	dateRange := bson.M{}
	if v := c.Query("from"); v != "" {
		if d, err := parseDay(v); err == nil {
			dateRange["$gte"] = d
		}
	}
	if v := c.Query("to"); v != "" {
		if d, err := parseDay(v); err == nil {
			dateRange["$lte"] = d
		}
	}
	if len(dateRange) > 0 {
		filter["date"] = dateRange
	}
	out, err := repo.FindAll[domain.Expense](c, h.db.Expenses, filter,
		options.Find().SetSort(bson.D{{Key: "date", Value: -1}, {Key: "_id", Value: -1}}))
	if err != nil {
		Internal(c, err)
		return
	}
	c.JSON(200, out)
}

func (h *entryHandlers) createExpense(c *gin.Context) {
	uid := userID(c)
	period, err := h.periods.RequireOpen(c, uid, c.Param("id"))
	if err != nil {
		periodGuardError(c, err)
		return
	}
	var req expenseReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BindError(c, err)
		return
	}
	e, ok := h.buildExpense(c, uid, period, req)
	if !ok {
		return
	}
	e.ID = repo.NewID()
	if _, err := h.db.Expenses.InsertOne(c, e); err != nil {
		Internal(c, err)
		return
	}
	c.JSON(201, e)
}

func (h *entryHandlers) updateExpense(c *gin.Context) {
	uid := userID(c)
	period, err := h.periods.RequireOpen(c, uid, c.Param("id"))
	if err != nil {
		periodGuardError(c, err)
		return
	}
	var req expenseReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BindError(c, err)
		return
	}
	e, ok := h.buildExpense(c, uid, period, req)
	if !ok {
		return
	}
	e.ID = c.Param("eid")
	replaced, err := repo.ReplaceByID(c, h.db.Expenses, uid, e.ID, e)
	if err != nil {
		Internal(c, err)
		return
	}
	if !replaced {
		NotFound(c)
		return
	}
	c.JSON(200, e)
}

func (h *entryHandlers) deleteExpense(c *gin.Context) {
	uid := userID(c)
	if _, err := h.periods.RequireOpen(c, uid, c.Param("id")); err != nil {
		periodGuardError(c, err)
		return
	}
	ok, err := repo.DeleteByID(c, h.db.Expenses, uid, c.Param("eid"))
	if err != nil {
		Internal(c, err)
		return
	}
	if !ok {
		NotFound(c)
		return
	}
	c.Status(204)
}

// --- transfers ---

type transferReq struct {
	Date          string `json:"date" binding:"required"`
	FromAccountID string `json:"fromAccountId" binding:"required"`
	ToAccountID   string `json:"toAccountId" binding:"required"`
	AmountExpr    string `json:"amountExpr" binding:"required"`
	FeeExpr       string `json:"feeExpr"`
	Note          string `json:"note"`
}

func (h *entryHandlers) buildTransfer(c *gin.Context, uid string, period *domain.Period, req transferReq) (*domain.Transfer, bool) {
	date, err := parseDay(req.Date)
	if err != nil {
		BadRequest(c, "invalid date, expected YYYY-MM-DD")
		return nil, false
	}
	if !dateInPeriod(date, period) {
		BadRequest(c, dateRangeMessage(period))
		return nil, false
	}
	if req.FromAccountID == req.ToAccountID {
		BadRequest(c, "from and to accounts must differ")
		return nil, false
	}
	amount, _, err := domain.ParseAmountExpr(req.AmountExpr)
	if err != nil || amount <= 0 {
		BadRequest(c, "invalid amount")
		return nil, false
	}
	var fee int64
	if req.FeeExpr != "" {
		fee, _, err = domain.ParseAmountExpr(req.FeeExpr)
		if err != nil || fee < 0 {
			BadRequest(c, "invalid fee")
			return nil, false
		}
	}
	for _, id := range []string{req.FromAccountID, req.ToAccountID} {
		acc, err := repo.ByID[domain.Account](c, h.db.Accounts, uid, id)
		if err != nil {
			Internal(c, err)
			return nil, false
		}
		if acc == nil || !acc.Active {
			BadRequest(c, "unknown or inactive account")
			return nil, false
		}
	}
	return &domain.Transfer{
		UserID: uid, PeriodID: period.ID, Date: date,
		FromAccountID: req.FromAccountID, ToAccountID: req.ToAccountID,
		Amount: amount, Fee: fee, Note: req.Note,
	}, true
}

func (h *entryHandlers) listTransfers(c *gin.Context) {
	filter := bson.M{"userId": userID(c), "periodId": c.Param("id")}
	out, err := repo.FindAll[domain.Transfer](c, h.db.Transfers, filter,
		options.Find().SetSort(bson.D{{Key: "date", Value: -1}, {Key: "_id", Value: -1}}))
	if err != nil {
		Internal(c, err)
		return
	}
	c.JSON(200, out)
}

func (h *entryHandlers) createTransfer(c *gin.Context) {
	uid := userID(c)
	period, err := h.periods.RequireOpen(c, uid, c.Param("id"))
	if err != nil {
		periodGuardError(c, err)
		return
	}
	var req transferReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BindError(c, err)
		return
	}
	t, ok := h.buildTransfer(c, uid, period, req)
	if !ok {
		return
	}
	t.ID = repo.NewID()
	if _, err := h.db.Transfers.InsertOne(c, t); err != nil {
		Internal(c, err)
		return
	}
	c.JSON(201, t)
}

func (h *entryHandlers) updateTransfer(c *gin.Context) {
	uid := userID(c)
	period, err := h.periods.RequireOpen(c, uid, c.Param("id"))
	if err != nil {
		periodGuardError(c, err)
		return
	}
	var req transferReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BindError(c, err)
		return
	}
	t, ok := h.buildTransfer(c, uid, period, req)
	if !ok {
		return
	}
	t.ID = c.Param("tid")
	replaced, err := repo.ReplaceByID(c, h.db.Transfers, uid, t.ID, t)
	if err != nil {
		Internal(c, err)
		return
	}
	if !replaced {
		NotFound(c)
		return
	}
	c.JSON(200, t)
}

func (h *entryHandlers) deleteTransfer(c *gin.Context) {
	uid := userID(c)
	if _, err := h.periods.RequireOpen(c, uid, c.Param("id")); err != nil {
		periodGuardError(c, err)
		return
	}
	ok, err := repo.DeleteByID(c, h.db.Transfers, uid, c.Param("tid"))
	if err != nil {
		Internal(c, err)
		return
	}
	if !ok {
		NotFound(c)
		return
	}
	c.Status(204)
}

func dateInPeriod(date time.Time, p *domain.Period) bool {
	return !date.Before(p.StartDate) && !date.After(p.EndDate)
}

func dateRangeMessage(p *domain.Period) string {
	return fmt.Sprintf("date must be within %s (%s – %s)",
		p.Name, p.StartDate.UTC().Format("2 Jan 2006"), p.EndDate.UTC().Format("2 Jan 2006"))
}

func periodGuardError(c *gin.Context, err error) {
	switch err {
	case service.ErrPeriodNotFound:
		NotFound(c)
	case service.ErrPeriodClosed:
		Err(c, 409, "period_closed", "period is closed; reopen it to edit entries")
	default:
		Internal(c, err)
	}
}
