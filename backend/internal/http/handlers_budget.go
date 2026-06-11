package http

import (
	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"

	"ribnat/backend/internal/domain"
	"ribnat/backend/internal/repo"
)

type budgetHandlers struct{ db *repo.DB }

func (h *budgetHandlers) get(c *gin.Context) {
	b, err := repo.FindOne[domain.Budget](c, h.db.Budgets, bson.M{
		"userId": userID(c), "periodId": c.Param("id"),
	})
	if err != nil {
		Internal(c, err)
		return
	}
	if b == nil {
		b = &domain.Budget{UserID: userID(c), PeriodID: c.Param("id"), Items: []domain.BudgetItem{}}
	}
	c.JSON(200, b)
}

func (h *budgetHandlers) put(c *gin.Context) {
	var req struct {
		Items []domain.BudgetItem `json:"items" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, err.Error())
		return
	}
	for _, it := range req.Items {
		if it.Amount < 0 {
			BadRequest(c, "budget amounts must be >= 0")
			return
		}
	}
	uid := userID(c)
	b := domain.Budget{UserID: uid, PeriodID: c.Param("id"), Items: req.Items}
	upsert := options.Replace().SetUpsert(true)
	existing, err := repo.FindOne[domain.Budget](c, h.db.Budgets, bson.M{"userId": uid, "periodId": b.PeriodID})
	if err != nil {
		Internal(c, err)
		return
	}
	if existing != nil {
		b.ID = existing.ID
	} else {
		b.ID = repo.NewID()
	}
	if _, err := h.db.Budgets.ReplaceOne(c, bson.M{"userId": uid, "periodId": b.PeriodID}, b, upsert); err != nil {
		Internal(c, err)
		return
	}
	c.JSON(200, b)
}

// copyPrevious copies the previous period's budget items into this period.
func (h *budgetHandlers) copyPrevious(c *gin.Context) {
	uid := userID(c)
	period, err := repo.ByID[domain.Period](c, h.db.Periods, uid, c.Param("id"))
	if err != nil {
		Internal(c, err)
		return
	}
	if period == nil {
		NotFound(c)
		return
	}
	if period.PreviousPeriodID == "" {
		Err(c, 409, "no_previous", "period has no previous period")
		return
	}
	prev, err := repo.FindOne[domain.Budget](c, h.db.Budgets, bson.M{"userId": uid, "periodId": period.PreviousPeriodID})
	if err != nil {
		Internal(c, err)
		return
	}
	if prev == nil || len(prev.Items) == 0 {
		Err(c, 409, "no_previous", "previous period has no budget")
		return
	}
	b := domain.Budget{ID: repo.NewID(), UserID: uid, PeriodID: period.ID, Items: prev.Items}
	existing, err := repo.FindOne[domain.Budget](c, h.db.Budgets, bson.M{"userId": uid, "periodId": period.ID})
	if err != nil {
		Internal(c, err)
		return
	}
	if existing != nil {
		b.ID = existing.ID
	}
	if _, err := h.db.Budgets.ReplaceOne(c, bson.M{"userId": uid, "periodId": period.ID}, b,
		options.Replace().SetUpsert(true)); err != nil {
		Internal(c, err)
		return
	}
	c.JSON(200, b)
}
