package http

import (
	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"

	"ribnat/backend/internal/domain"
	"ribnat/backend/internal/repo"
)

type refdataHandlers struct{ db *repo.DB }

// --- categories ---

func (h *refdataHandlers) listCategories(c *gin.Context) {
	cats, err := repo.FindAll[domain.Category](c, h.db.Categories, bson.M{"userId": userID(c)})
	if err != nil {
		Internal(c, err)
		return
	}
	c.JSON(200, cats)
}

type categoryReq struct {
	Name          string               `json:"name" binding:"required"`
	Kind          domain.CategoryKind  `json:"kind" binding:"required,oneof=expense savings pay"`
	Subcategories []domain.Subcategory `json:"subcategories"`
	Active        *bool                `json:"active"`
}

func (h *refdataHandlers) createCategory(c *gin.Context) {
	var req categoryReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, err.Error())
		return
	}
	cat := domain.Category{
		ID: repo.NewID(), UserID: userID(c), Name: req.Name, Kind: req.Kind,
		Subcategories: req.Subcategories, Active: true,
	}
	if cat.Subcategories == nil {
		cat.Subcategories = []domain.Subcategory{}
	}
	if _, err := h.db.Categories.InsertOne(c, cat); err != nil {
		Err(c, 409, "duplicate", "category with this name exists")
		return
	}
	c.JSON(201, cat)
}

func (h *refdataHandlers) updateCategory(c *gin.Context) {
	var req categoryReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, err.Error())
		return
	}
	set := bson.M{"name": req.Name, "kind": req.Kind, "subcategories": req.Subcategories}
	if req.Active != nil {
		set["active"] = *req.Active
	}
	ok, err := repo.UpdateByID(c, h.db.Categories, userID(c), c.Param("id"), set)
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

// deleteCategory soft-deactivates: expense history may reference it.
func (h *refdataHandlers) deleteCategory(c *gin.Context) {
	ok, err := repo.UpdateByID(c, h.db.Categories, userID(c), c.Param("id"), bson.M{"active": false})
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

// --- accounts ---

func (h *refdataHandlers) listAccounts(c *gin.Context) {
	accs, err := repo.FindAll[domain.Account](c, h.db.Accounts, bson.M{"userId": userID(c)})
	if err != nil {
		Internal(c, err)
		return
	}
	c.JSON(200, accs)
}

type accountReq struct {
	Name   string             `json:"name" binding:"required"`
	Kind   domain.AccountKind `json:"kind" binding:"required,oneof=bank mobile cash savings virtual"`
	Active *bool              `json:"active"`
}

func (h *refdataHandlers) createAccount(c *gin.Context) {
	var req accountReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, err.Error())
		return
	}
	acc := domain.Account{ID: repo.NewID(), UserID: userID(c), Name: req.Name, Kind: req.Kind, Active: true}
	if _, err := h.db.Accounts.InsertOne(c, acc); err != nil {
		Err(c, 409, "duplicate", "account with this name exists")
		return
	}
	c.JSON(201, acc)
}

func (h *refdataHandlers) updateAccount(c *gin.Context) {
	var req accountReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, err.Error())
		return
	}
	set := bson.M{"name": req.Name, "kind": req.Kind}
	if req.Active != nil {
		set["active"] = *req.Active
	}
	ok, err := repo.UpdateByID(c, h.db.Accounts, userID(c), c.Param("id"), set)
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

func (h *refdataHandlers) deleteAccount(c *gin.Context) {
	ok, err := repo.UpdateByID(c, h.db.Accounts, userID(c), c.Param("id"), bson.M{"active": false})
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
