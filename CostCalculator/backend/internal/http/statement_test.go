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

func TestStatementEndpoint(t *testing.T) {
	gin.SetMode(gin.TestMode)
	uri := os.Getenv("MONGO_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017/?directConnection=true"
	}
	dbName := fmt.Sprintf("costcalc_stmt_ep_%d", time.Now().UnixNano())
	db, err := repo.Connect(context.Background(), uri, dbName)
	if err != nil {
		t.Skipf("mongo not available: %v", err)
	}
	defer db.Client.Database(dbName).Drop(context.Background())

	router := NewRouter(config.Config{JWTSecret: "test", CORSOrigin: "*"}, db)
	do := func(method, path, token string, body any) *httptest.ResponseRecorder {
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
		return w
	}

	var reg map[string]any
	wReg := do("POST", "/api/v1/auth/register", "", map[string]any{"name": "S", "email": "s@example.com", "password": "secret123"})
	json.Unmarshal(wReg.Body.Bytes(), &reg)
	token := reg["tokens"].(map[string]any)["accessToken"].(string)

	w := do("GET", "/api/v1/statement?from=2026-01-01&to=2026-12-31", token, nil)
	if w.Code != 200 {
		t.Fatalf("statement: %d %s", w.Code, w.Body.String())
	}
	var rep map[string]any
	json.Unmarshal(w.Body.Bytes(), &rep)
	if _, ok := rep["kpis"]; !ok {
		t.Errorf("response missing kpis: %s", w.Body.String())
	}

	if w := do("GET", "/api/v1/statement?from=nope&to=2026-12-31", token, nil); w.Code != 400 {
		t.Errorf("bad from: got %d, want 400", w.Code)
	}
	if w := do("GET", "/api/v1/statement?from=2026-12-31&to=2026-01-01", token, nil); w.Code != 400 {
		t.Errorf("reversed range: got %d, want 400", w.Code)
	}
	if w := do("GET", "/api/v1/statement?from=2026-01-01&to=2026-12-31", "", nil); w.Code != 401 {
		t.Errorf("no auth: got %d, want 401", w.Code)
	}
}
