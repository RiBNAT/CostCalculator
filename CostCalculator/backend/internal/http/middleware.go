package http

import (
	"strings"

	"github.com/gin-gonic/gin"

	"costcalculator/backend/internal/service"
)

const ctxUserID = "userID"

// AuthRequired validates the Bearer access token and stores the user id.
func AuthRequired(auth *service.Auth) gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		token, ok := strings.CutPrefix(header, "Bearer ")
		if !ok || token == "" {
			Err(c, 401, "unauthorized", "missing bearer token")
			return
		}
		uid, err := auth.Verify(token)
		if err != nil {
			Err(c, 401, "unauthorized", "invalid or expired token")
			return
		}
		c.Set(ctxUserID, uid)
		c.Next()
	}
}

func userID(c *gin.Context) string { return c.GetString(ctxUserID) }

// CORS allows the configured frontend origin.
func CORS(origin string) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", origin)
		c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	}
}
