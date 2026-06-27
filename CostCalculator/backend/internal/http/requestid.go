package http

import (
	"crypto/rand"
	"encoding/hex"

	"github.com/gin-gonic/gin"
)

const ctxRequestID = "requestID"

// RequestID assigns a short random id to each request, stores it in the
// context, and echoes it back in the X-Request-Id header so a client error
// can be correlated with the server log line.
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := newRequestID()
		c.Set(ctxRequestID, id)
		c.Header("X-Request-Id", id)
		c.Next()
	}
}

func newRequestID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "unknown"
	}
	return hex.EncodeToString(b)
}

func requestID(c *gin.Context) string { return c.GetString(ctxRequestID) }
