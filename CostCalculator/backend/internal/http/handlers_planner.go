package http

import (
	"time"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"

	"costcalculator/backend/internal/domain"
	"costcalculator/backend/internal/repo"
)

type plannerHandlers struct{ db *repo.DB }

// --- payment windows ---

func (h *plannerHandlers) listWindows(c *gin.Context) {
	filter := bson.M{"userId": userID(c)}
	if v := c.Query("periodId"); v != "" {
		filter["periodId"] = v
	}
	windows, err := repo.FindAll[domain.PaymentWindow](c, h.db.Windows, filter,
		options.Find().SetSort(bson.D{{Key: "startDate", Value: 1}}))
	if err != nil {
		Internal(c, err)
		return
	}
	// attach statuses using period expenses
	type withStatus struct {
		domain.PaymentWindow
		Status domain.WindowStatusResult `json:"status"`
	}
	out := []withStatus{}
	expensesByPeriod := map[string][]domain.Expense{}
	for _, w := range windows {
		exp, ok := expensesByPeriod[w.PeriodID]
		if !ok {
			var err error
			exp, err = repo.FindAll[domain.Expense](c, h.db.Expenses, bson.M{"userId": userID(c), "periodId": w.PeriodID})
			if err != nil {
				Internal(c, err)
				return
			}
			expensesByPeriod[w.PeriodID] = exp
		}
		out = append(out, withStatus{w, domain.WindowStatus(w, exp, time.Now().UTC())})
	}
	c.JSON(200, out)
}

type windowReq struct {
	PeriodID    string `json:"periodId" binding:"required"`
	Name        string `json:"name" binding:"required"`
	CategoryID  string `json:"categoryId"`
	Subcategory string `json:"subcategory"`
	StartDate   string `json:"startDate" binding:"required"`
	EndDate     string `json:"endDate" binding:"required"`
}

func (h *plannerHandlers) createWindow(c *gin.Context) {
	var req windowReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BindError(c, err)
		return
	}
	start, err1 := parseDay(req.StartDate)
	end, err2 := parseDay(req.EndDate)
	if err1 != nil || err2 != nil || end.Before(start) {
		BadRequest(c, "invalid date range")
		return
	}
	w := domain.PaymentWindow{
		ID: repo.NewID(), UserID: userID(c), PeriodID: req.PeriodID, Name: req.Name,
		CategoryID: req.CategoryID, Subcategory: req.Subcategory, StartDate: start, EndDate: end,
	}
	if _, err := h.db.Windows.InsertOne(c, w); err != nil {
		Internal(c, err)
		return
	}
	c.JSON(201, w)
}

func (h *plannerHandlers) updateWindow(c *gin.Context) {
	var req windowReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BindError(c, err)
		return
	}
	start, err1 := parseDay(req.StartDate)
	end, err2 := parseDay(req.EndDate)
	if err1 != nil || err2 != nil || end.Before(start) {
		BadRequest(c, "invalid date range")
		return
	}
	ok, err := repo.UpdateByID(c, h.db.Windows, userID(c), c.Param("id"), bson.M{
		"periodId": req.PeriodID, "name": req.Name, "categoryId": req.CategoryID,
		"subcategory": req.Subcategory, "startDate": start, "endDate": end,
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

func (h *plannerHandlers) deleteWindow(c *gin.Context) {
	ok, err := repo.DeleteByID(c, h.db.Windows, userID(c), c.Param("id"))
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

// --- reminders ---

func (h *plannerHandlers) listReminders(c *gin.Context) {
	out, err := repo.FindAll[domain.Reminder](c, h.db.Reminders, bson.M{"userId": userID(c)},
		options.Find().SetSort(bson.D{{Key: "date", Value: 1}}))
	if err != nil {
		Internal(c, err)
		return
	}
	c.JSON(200, out)
}

type reminderReq struct {
	Date string `json:"date" binding:"required"`
	Task string `json:"task" binding:"required"`
	Done *bool  `json:"done"`
}

func (h *plannerHandlers) createReminder(c *gin.Context) {
	var req reminderReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BindError(c, err)
		return
	}
	date, err := parseDay(req.Date)
	if err != nil {
		BadRequest(c, "invalid date")
		return
	}
	r := domain.Reminder{ID: repo.NewID(), UserID: userID(c), Date: date, Task: req.Task}
	if _, err := h.db.Reminders.InsertOne(c, r); err != nil {
		Internal(c, err)
		return
	}
	c.JSON(201, r)
}

func (h *plannerHandlers) updateReminder(c *gin.Context) {
	var req reminderReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BindError(c, err)
		return
	}
	date, err := parseDay(req.Date)
	if err != nil {
		BadRequest(c, "invalid date")
		return
	}
	set := bson.M{"date": date, "task": req.Task}
	if req.Done != nil {
		set["done"] = *req.Done
	}
	ok, err := repo.UpdateByID(c, h.db.Reminders, userID(c), c.Param("id"), set)
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

func (h *plannerHandlers) deleteReminder(c *gin.Context) {
	ok, err := repo.DeleteByID(c, h.db.Reminders, userID(c), c.Param("id"))
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
