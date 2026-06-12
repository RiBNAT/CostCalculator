package http

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"costcalculator/backend/internal/config"
	"costcalculator/backend/internal/repo"
)

// When GOOGLE_CLIENT_ID is unset the feature is off: /auth/config advertises it
// disabled and /auth/google rejects with 503. Neither path touches the DB.
func TestGoogleSignInDisabled(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := NewRouter(config.Config{JWTSecret: "test", CORSOrigin: "*"}, &repo.DB{})

	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/auth/config", nil))
	if w.Code != 200 {
		t.Fatalf("config: %d %s", w.Code, w.Body.String())
	}
	var cfg map[string]any
	json.Unmarshal(w.Body.Bytes(), &cfg)
	if cfg["googleEnabled"] != false {
		t.Errorf("googleEnabled = %v, want false", cfg["googleEnabled"])
	}

	body, _ := json.Marshal(map[string]any{"idToken": "x"})
	req := httptest.NewRequest("POST", "/api/v1/auth/google", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w2 := httptest.NewRecorder()
	router.ServeHTTP(w2, req)
	if w2.Code != 503 {
		t.Errorf("google login disabled = %d, want 503", w2.Code)
	}
}
