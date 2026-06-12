package http

import (
	"context"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"

	"costcalculator/backend/internal/domain"
	"costcalculator/backend/internal/repo"
	"costcalculator/backend/internal/service"
)

// mongoUsers adapts repo.DB to service.UserStore.
type mongoUsers struct{ db *repo.DB }

func (m mongoUsers) ByEmail(ctx context.Context, email string) (*domain.User, error) {
	return repo.FindOne[domain.User](ctx, m.db.Users, bson.M{"email": email})
}

func (m mongoUsers) Insert(ctx context.Context, u *domain.User) error {
	u.ID = repo.NewID()
	_, err := m.db.Users.InsertOne(ctx, u)
	return err
}

func (m mongoUsers) Update(ctx context.Context, u *domain.User) error {
	_, err := m.db.Users.ReplaceOne(ctx, bson.M{"_id": u.ID}, u)
	return err
}

type authHandlers struct {
	auth           *service.Auth
	db             *repo.DB
	googleClientID string
}

// config exposes the public client config the SPA needs to render the Google button.
func (h *authHandlers) config(c *gin.Context) {
	c.JSON(200, gin.H{
		"googleEnabled":  h.googleClientID != "",
		"googleClientId": h.googleClientID,
	})
}

func (h *authHandlers) google(c *gin.Context) {
	if h.googleClientID == "" || h.auth.Google == nil {
		Err(c, 503, "google_disabled", "Google sign-in is not configured")
		return
	}
	var req struct {
		IDToken string `json:"idToken" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		BindError(c, err)
		return
	}
	u, pair, created, err := h.auth.LoginWithGoogle(c, req.IDToken)
	if err == service.ErrGoogleEmailUnverified {
		Err(c, 401, "email_unverified", "your Google account email is not verified")
		return
	}
	if err != nil {
		Err(c, 401, "invalid_token", "could not verify Google sign-in")
		return
	}
	if created {
		if err := service.SeedDefaults(c, h.db, u.ID); err != nil {
			Internal(c, err)
			return
		}
	}
	c.JSON(200, gin.H{"user": u, "tokens": pair})
}

func (h *authHandlers) register(c *gin.Context) {
	var req struct {
		Name     string `json:"name" binding:"required"`
		Email    string `json:"email" binding:"required,email"`
		Password string `json:"password" binding:"required,min=8"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		BindError(c, err)
		return
	}
	u, err := h.auth.Register(c, req.Name, req.Email, req.Password)
	if err == service.ErrEmailTaken {
		Err(c, 409, "email_taken", "email already registered")
		return
	}
	if err != nil {
		Internal(c, err)
		return
	}
	if err := service.SeedDefaults(c, h.db, u.ID); err != nil {
		Internal(c, err)
		return
	}
	_, pair, err := h.auth.Login(c, req.Email, req.Password)
	if err != nil {
		Internal(c, err)
		return
	}
	c.JSON(201, gin.H{"user": u, "tokens": pair})
}

func (h *authHandlers) login(c *gin.Context) {
	var req struct {
		Email    string `json:"email" binding:"required"`
		Password string `json:"password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		BindError(c, err)
		return
	}
	u, pair, err := h.auth.Login(c, req.Email, req.Password)
	if err == service.ErrInvalidCredentials {
		Err(c, 401, "invalid_credentials", "invalid email or password")
		return
	}
	if err != nil {
		Internal(c, err)
		return
	}
	c.JSON(200, gin.H{"user": u, "tokens": pair})
}

func (h *authHandlers) refresh(c *gin.Context) {
	var req struct {
		RefreshToken string `json:"refreshToken" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		BindError(c, err)
		return
	}
	pair, err := h.auth.Refresh(c, req.RefreshToken)
	if err != nil {
		Err(c, 401, "invalid_token", "invalid refresh token")
		return
	}
	c.JSON(200, gin.H{"tokens": pair})
}
