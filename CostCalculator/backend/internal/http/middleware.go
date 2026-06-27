package http

import (
	"strings"

	"github.com/gin-gonic/gin"

	"costcalculator/backend/internal/service"
)

const ctxUserID = "userID"

// AuthRequired validates the access token (Bearer header or rib_access cookie)
// and stores the user id.
func AuthRequired(auth *service.Auth) gin.HandlerFunc {
	return func(c *gin.Context) {
		token, ok := strings.CutPrefix(c.GetHeader("Authorization"), "Bearer ")
		if !ok || token == "" {
			if ck, err := c.Cookie(cookieAccess); err == nil {
				token = ck
			}
		}
		if token == "" {
			Err(c, 401, "unauthorized", "missing credentials")
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
