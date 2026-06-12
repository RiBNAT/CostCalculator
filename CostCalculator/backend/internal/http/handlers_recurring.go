package http

import (
	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"

	"costcalculator/backend/internal/domain"
	"costcalculator/backend/internal/repo"
)

type recurringHandlers struct{ db *repo.DB }

func (h *recurringHandlers) list(c *gin.Context) {
	items, err := repo.FindAll[domain.RecurringExpense](c, h.db.Recurrings, bson.M{"userId": userID(c)})
	if err != nil {
		Internal(c, err)
		return
	}
	c.JSON(200, items)
}

type recurringReq struct {
	Label       string `json:"label" binding:"required"`
	CategoryID  string `json:"categoryId" binding:"required"`
	Subcategory string `json:"subcategory" binding:"required"`
	AccountID   string `json:"accountId" binding:"required"`
	Amount      int64  `json:"amount" binding:"required,gt=0"`
}

func (h *recurringHandlers) create(c *gin.Context) {
	var req recurringReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BindError(c, err)
		return
	}
	r := domain.RecurringExpense{
		ID: repo.NewID(), UserID: userID(c), Label: req.Label,
		CategoryID: req.CategoryID, Subcategory: req.Subcategory, AccountID: req.AccountID, Amount: req.Amount,
	}
	if _, err := h.db.Recurrings.InsertOne(c, r); err != nil {
		Internal(c, err)
		return
	}
	c.JSON(201, r)
}

func (h *recurringHandlers) update(c *gin.Context) {
	var req recurringReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BindError(c, err)
		return
	}
	ok, err := repo.UpdateByID(c, h.db.Recurrings, userID(c), c.Param("id"), bson.M{
		"label": req.Label, "categoryId": req.CategoryID, "subcategory": req.Subcategory,
		"accountId": req.AccountID, "amount": req.Amount,
	})
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

func (h *recurringHandlers) delete(c *gin.Context) {
	ok, err := repo.DeleteByID(c, h.db.Recurrings, userID(c), c.Param("id"))
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
