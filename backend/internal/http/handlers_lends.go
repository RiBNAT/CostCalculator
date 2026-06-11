package http

import (
	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"

	"ribnat/backend/internal/domain"
	"ribnat/backend/internal/repo"
)

type lendHandlers struct{ db *repo.DB }

func (h *lendHandlers) list(c *gin.Context) {
	filter := bson.M{"userId": userID(c)}
	if v := c.Query("status"); v != "" {
		filter["status"] = v
	}
	if v := c.Query("type"); v != "" {
		filter["type"] = v
	}
	out, err := repo.FindAll[domain.Lend](c, h.db.Lends, filter,
		options.Find().SetSort(bson.D{{Key: "date", Value: -1}}))
	if err != nil {
		Internal(c, err)
		return
	}
	c.JSON(200, out)
}

type lendReq struct {
	Type       domain.LendType `json:"type" binding:"required,oneof=given taken"`
	Person     string          `json:"person" binding:"required"`
	Date       string          `json:"date" binding:"required"`
	AmountExpr string          `json:"amountExpr" binding:"required"`
	Notes      string          `json:"notes"`
}

func (h *lendHandlers) create(c *gin.Context) {
	var req lendReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, err.Error())
		return
	}
	date, err := parseDay(req.Date)
	if err != nil {
		BadRequest(c, "invalid date")
		return
	}
	amount, _, err := domain.ParseAmountExpr(req.AmountExpr)
	if err != nil || amount <= 0 {
		BadRequest(c, "invalid amount")
		return
	}
	l := domain.Lend{
		ID: repo.NewID(), UserID: userID(c), Type: req.Type, Person: req.Person,
		Date: date, Amount: amount, Settlements: []domain.Settlement{},
		Status: domain.LendOpen, Notes: req.Notes,
	}
	if _, err := h.db.Lends.InsertOne(c, l); err != nil {
		Internal(c, err)
		return
	}
	c.JSON(201, l)
}

func (h *lendHandlers) update(c *gin.Context) {
	var req lendReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, err.Error())
		return
	}
	date, err := parseDay(req.Date)
	if err != nil {
		BadRequest(c, "invalid date")
		return
	}
	amount, _, err := domain.ParseAmountExpr(req.AmountExpr)
	if err != nil || amount <= 0 {
		BadRequest(c, "invalid amount")
		return
	}
	ok, err := repo.UpdateByID(c, h.db.Lends, userID(c), c.Param("id"), bson.M{
		"type": req.Type, "person": req.Person, "date": date, "amount": amount, "notes": req.Notes,
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

func (h *lendHandlers) delete(c *gin.Context) {
	ok, err := repo.DeleteByID(c, h.db.Lends, userID(c), c.Param("id"))
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

func (h *lendHandlers) settle(c *gin.Context) {
	var req struct {
		Date       string `json:"date" binding:"required"`
		AmountExpr string `json:"amountExpr" binding:"required"`
		Note       string `json:"note"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, err.Error())
		return
	}
	date, err := parseDay(req.Date)
	if err != nil {
		BadRequest(c, "invalid date")
		return
	}
	amount, _, err := domain.ParseAmountExpr(req.AmountExpr)
	if err != nil || amount <= 0 {
		BadRequest(c, "invalid amount")
		return
	}
	uid := userID(c)
	l, err := repo.ByID[domain.Lend](c, h.db.Lends, uid, c.Param("id"))
	if err != nil {
		Internal(c, err)
		return
	}
	if l == nil {
		NotFound(c)
		return
	}
	l.Settlements = append(l.Settlements, domain.Settlement{Date: date, Amount: amount, Note: req.Note})
	if l.Outstanding() <= 0 {
		l.Status = domain.LendSettled
	}
	if _, err := repo.UpdateByID(c, h.db.Lends, uid, l.ID, bson.M{
		"settlements": l.Settlements, "status": l.Status,
	}); err != nil {
		Internal(c, err)
		return
	}
	c.JSON(200, l)
}
