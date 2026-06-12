package http

import (
	"time"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"

	"costcalculator/backend/internal/domain"
	"costcalculator/backend/internal/repo"
	"costcalculator/backend/internal/service"
)

type periodHandlers struct {
	db      *repo.DB
	periods *service.Periods
	summary *service.Summary
}

func (h *periodHandlers) list(c *gin.Context) {
	ps, err := repo.FindAll[domain.Period](c, h.db.Periods, bson.M{"userId": userID(c)},
		options.Find().SetSort(bson.D{{Key: "startDate", Value: -1}}))
	if err != nil {
		Internal(c, err)
		return
	}
	c.JSON(200, ps)
}

func (h *periodHandlers) savingsHistory(c *gin.Context) {
	points, err := h.summary.SavingsHistory(c, userID(c))
	if err != nil {
		Internal(c, err)
		return
	}
	c.JSON(200, points)
}

type periodReq struct {
	Name      string `json:"name" binding:"required"`
	StartDate string `json:"startDate" binding:"required"` // YYYY-MM-DD
	EndDate   string `json:"endDate" binding:"required"`
}

func parseDay(s string) (time.Time, error) { return time.Parse("2006-01-02", s) }

func (h *periodHandlers) create(c *gin.Context) {
	var req periodReq
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
	uid := userID(c)
	if err := h.periods.CheckOverlap(c, uid, start, end, ""); err == service.ErrPeriodOverlap {
		Err(c, 409, "overlap", "period overlaps an existing period")
		return
	} else if err != nil {
		Internal(c, err)
		return
	}

	p := domain.Period{
		ID: repo.NewID(), UserID: uid, Name: req.Name,
		StartDate: start, EndDate: end, Status: domain.PeriodOpen,
		OpeningBalances: []domain.AccountAmount{}, OpeningSavings: []domain.AccountAmount{},
	}
	prev, err := h.periods.Previous(c, uid, start)
	if err != nil {
		Internal(c, err)
		return
	}
	if prev != nil {
		p.PreviousPeriodID = prev.ID
		balances, savings, err := h.periods.ClosingBalances(c, prev)
		if err != nil {
			Internal(c, err)
			return
		}
		for id, v := range balances {
			p.OpeningBalances = append(p.OpeningBalances, domain.AccountAmount{AccountID: id, Amount: v})
		}
		for id, v := range savings {
			p.OpeningSavings = append(p.OpeningSavings, domain.AccountAmount{AccountID: id, Amount: v})
		}
	}
	if _, err := h.db.Periods.InsertOne(c, p); err != nil {
		Err(c, 409, "duplicate", "period with this name exists")
		return
	}
	c.JSON(201, p)
}

func (h *periodHandlers) update(c *gin.Context) {
	var req struct {
		Name            string                 `json:"name"`
		StartDate       string                 `json:"startDate"`
		EndDate         string                 `json:"endDate"`
		OpeningBalances []domain.AccountAmount `json:"openingBalances"`
		OpeningSavings  []domain.AccountAmount `json:"openingSavings"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		BindError(c, err)
		return
	}
	set := bson.M{}
	if req.Name != "" {
		set["name"] = req.Name
	}
	if req.StartDate != "" && req.EndDate != "" {
		start, err1 := parseDay(req.StartDate)
		end, err2 := parseDay(req.EndDate)
		if err1 != nil || err2 != nil || end.Before(start) {
			BadRequest(c, "invalid date range")
			return
		}
		if err := h.periods.CheckOverlap(c, userID(c), start, end, c.Param("id")); err == service.ErrPeriodOverlap {
			Err(c, 409, "overlap", "period overlaps an existing period")
			return
		} else if err != nil {
			Internal(c, err)
			return
		}
		set["startDate"], set["endDate"] = start, end
	}
	if req.OpeningBalances != nil {
		set["openingBalances"] = req.OpeningBalances
	}
	if req.OpeningSavings != nil {
		set["openingSavings"] = req.OpeningSavings
	}
	if len(set) == 0 {
		BadRequest(c, "nothing to update")
		return
	}
	ok, err := repo.UpdateByID(c, h.db.Periods, userID(c), c.Param("id"), set)
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

func (h *periodHandlers) close(c *gin.Context) {
	err := h.periods.Close(c, userID(c), c.Param("id"))
	switch err {
	case nil:
		c.Status(204)
	case service.ErrPeriodNotFound:
		NotFound(c)
	default:
		Internal(c, err)
	}
}

func (h *periodHandlers) reopen(c *gin.Context) {
	err := h.periods.Reopen(c, userID(c), c.Param("id"))
	switch err {
	case nil:
		c.Status(204)
	case service.ErrPeriodNotFound:
		NotFound(c)
	case service.ErrPeriodNotLatest:
		Err(c, 409, "not_latest", "only the latest period can be reopened")
	default:
		Internal(c, err)
	}
}

func (h *periodHandlers) status(c *gin.Context) {
	period, err := repo.ByID[domain.Period](c, h.db.Periods, userID(c), c.Param("id"))
	if err != nil {
		Internal(c, err)
		return
	}
	if period == nil {
		NotFound(c)
		return
	}
	balances, savings, err := h.periods.ClosingBalances(c, period)
	if err != nil {
		Internal(c, err)
		return
	}
	accounts, err := repo.FindAll[domain.Account](c, h.db.Accounts, bson.M{"userId": userID(c)})
	if err != nil {
		Internal(c, err)
		return
	}
	c.JSON(200, gin.H{
		"balances": balances,
		"savings":  savings,
		"inHand":   domain.InHand(balances, accounts),
	})
}

func (h *periodHandlers) trends(c *gin.Context) {
	t, err := h.summary.Trends(c, userID(c), c.Param("id"))
	if err == service.ErrPeriodNotFound {
		NotFound(c)
		return
	}
	if err != nil {
		Internal(c, err)
		return
	}
	c.JSON(200, t)
}

func (h *periodHandlers) getSummary(c *gin.Context) {
	sum, err := h.summary.Build(c, userID(c), c.Param("id"), time.Now().UTC())
	if err == service.ErrPeriodNotFound {
		NotFound(c)
		return
	}
	if err != nil {
		Internal(c, err)
		return
	}
	c.JSON(200, sum)
}
