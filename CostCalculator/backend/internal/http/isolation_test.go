package http

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"costcalculator/backend/internal/config"
	"costcalculator/backend/internal/repo"
)

// A user must never reach another user's period via id-bearing routes.
func TestCrossUserPeriodAccessIsDenied(t *testing.T) {
	gin.SetMode(gin.TestMode)
	uri := os.Getenv("MONGO_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017"
	}
	dbName := fmt.Sprintf("costcalc_iso_test_%d", time.Now().UnixNano())
	db, err := repo.Connect(context.Background(), uri, dbName)
	if err != nil {
		t.Skipf("mongo not available: %v", err)
	}
	defer db.Client.Database(dbName).Drop(context.Background())

	router := NewRouter(config.Config{JWTSecret: "test", CORSOrigin: "*"}, db)
	do := func(method, path, token string, body any) (*httptest.ResponseRecorder, map[string]any) {
		var buf bytes.Buffer
		if body != nil {
			json.NewEncoder(&buf).Encode(body)
		}
		req := httptest.NewRequest(method, path, &buf)
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		var out map[string]any
		json.Unmarshal(w.Body.Bytes(), &out)
		return w, out
	}

	register := func(email string) string {
		_, resp := do("POST", "/api/v1/auth/register", "", map[string]any{
			"name": "U", "email": email, "password": "secret123",
		})
		return resp["tokens"].(map[string]any)["accessToken"].(string)
	}

	tokenA := register("a@example.com")
	tokenB := register("b@example.com")

	// User A creates a period.
	wC, p := do("POST", "/api/v1/periods", tokenA, map[string]any{
		"name": "A1", "startDate": "2026-03-01", "endDate": "2026-03-31",
	})
	if wC.Code != 201 {
		t.Fatalf("A create period: %d", wC.Code)
	}
	pid := p["id"].(string)

	// User B must NOT read A's period summary or status.
	for _, path := range []string{
		"/api/v1/periods/" + pid + "/summary",
		"/api/v1/periods/" + pid + "/status",
	} {
		wB, _ := do("GET", path, tokenB, nil)
		if wB.Code != 404 {
			t.Errorf("B reached A's %s: got %d, want 404", path, wB.Code)
		}
	}

	// User B must NOT mutate A's period (update or close).
	wU, _ := do("PUT", "/api/v1/periods/"+pid, tokenB, map[string]any{"name": "hijacked"})
	if wU.Code != 404 {
		t.Errorf("B updated A's period: got %d, want 404", wU.Code)
	}
	wClose, _ := do("POST", "/api/v1/periods/"+pid+"/close", tokenB, nil)
	if wClose.Code != 404 {
		t.Errorf("B closed A's period: got %d, want 404", wClose.Code)
	}

	// Sanity: A's period is untouched.
	wL, _ := do("GET", "/api/v1/periods", tokenA, nil)
	if wL.Code != 200 {
		t.Fatalf("A list periods: %d", wL.Code)
	}
}
