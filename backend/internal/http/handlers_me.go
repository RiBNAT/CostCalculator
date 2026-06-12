package http

import (
	"strings"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"golang.org/x/crypto/bcrypt"

	"ribnat/backend/internal/domain"
	"ribnat/backend/internal/repo"
)

type meHandlers struct{ db *repo.DB }

func (h *meHandlers) load(c *gin.Context) *domain.User {
	u, err := repo.FindOne[domain.User](c, h.db.Users, bson.M{"_id": userID(c)})
	if err != nil {
		Internal(c, err)
		return nil
	}
	if u == nil {
		Err(c, 401, "unauthorized", "user no longer exists")
		return nil
	}
	return u
}

func (h *meHandlers) get(c *gin.Context) {
	if u := h.load(c); u != nil {
		c.JSON(200, u)
	}
}

// updateProfile changes name and phone.
func (h *meHandlers) updateProfile(c *gin.Context) {
	var req struct {
		Name  string `json:"name" binding:"required"`
		Phone string `json:"phone"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, err.Error())
		return
	}
	u := h.load(c)
	if u == nil {
		return
	}
	if _, err := h.db.Users.UpdateOne(c, bson.M{"_id": u.ID},
		bson.M{"$set": bson.M{"name": req.Name, "phone": strings.TrimSpace(req.Phone)}}); err != nil {
		Internal(c, err)
		return
	}
	u.Name, u.Phone = req.Name, strings.TrimSpace(req.Phone)
	c.JSON(200, u)
}

// updateEmail requires the current password.
func (h *meHandlers) updateEmail(c *gin.Context) {
	var req struct {
		Email    string `json:"email" binding:"required,email"`
		Password string `json:"password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, err.Error())
		return
	}
	u := h.load(c)
	if u == nil {
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(req.Password)) != nil {
		Err(c, 403, "wrong_password", "current password is incorrect")
		return
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if email != u.Email {
		if existing, err := repo.FindOne[domain.User](c, h.db.Users, bson.M{"email": email}); err != nil {
			Internal(c, err)
			return
		} else if existing != nil {
			Err(c, 409, "email_taken", "email already registered")
			return
		}
	}
	if _, err := h.db.Users.UpdateOne(c, bson.M{"_id": u.ID}, bson.M{"$set": bson.M{"email": email}}); err != nil {
		Internal(c, err)
		return
	}
	u.Email = email
	c.JSON(200, u)
}

// updatePassword verifies the current password before setting a new one.
func (h *meHandlers) updatePassword(c *gin.Context) {
	var req struct {
		CurrentPassword string `json:"currentPassword" binding:"required"`
		NewPassword     string `json:"newPassword" binding:"required,min=8"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, err.Error())
		return
	}
	u := h.load(c)
	if u == nil {
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(req.CurrentPassword)) != nil {
		Err(c, 403, "wrong_password", "current password is incorrect")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), 12)
	if err != nil {
		Internal(c, err)
		return
	}
	if _, err := h.db.Users.UpdateOne(c, bson.M{"_id": u.ID}, bson.M{"$set": bson.M{"passwordHash": string(hash)}}); err != nil {
		Internal(c, err)
		return
	}
	c.Status(204)
}
