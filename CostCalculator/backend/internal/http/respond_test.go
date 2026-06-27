package http

import (
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestInternalDoesNotLeakErrorString(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "/x", nil)
	c.Set(ctxRequestID, "abc123")

	Internal(c, errors.New("mongo: connection refused at 10.0.0.5:27017"))

	body := w.Body.String()
	if strings.Contains(body, "connection refused") {
		t.Fatalf("internal error leaked to client: %s", body)
	}
	if !strings.Contains(body, "abc123") {
		t.Fatalf("response should reference the request id, got: %s", body)
	}
	if w.Code != 500 {
		t.Fatalf("status = %d, want 500", w.Code)
	}
}
