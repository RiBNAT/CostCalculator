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

// Repair re-derives downstream opening balances. After a back-dated expense in
// an earlier period, calling repair must update the next period's opening
// balances to match the earlier period's new closing balances.
func TestPeriodRepairRecomputesDownstream(t *testing.T) {
	gin.SetMode(gin.TestMode)
	uri := os.Getenv("MONGO_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017"
	}
	dbName := fmt.Sprintf("costcalc_repair_test_%d", time.Now().UnixNano())
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

	_, resp := do("POST", "/api/v1/auth/register", "", map[string]any{
		"name": "R", "email": "r@example.com", "password": "secret123",
	})
	token := resp["tokens"].(map[string]any)["accessToken"].(string)

	// Resolve a seeded category+subcategory and a cash account.
	reqC := httptest.NewRequest("GET", "/api/v1/categories", nil)
	reqC.Header.Set("Authorization", "Bearer "+token)
	wC := httptest.NewRecorder()
	router.ServeHTTP(wC, reqC)
	var cats []map[string]any
	json.Unmarshal(wC.Body.Bytes(), &cats)
	var bazarID string
	for _, c := range cats {
		if c["name"] == "Bazar" {
			bazarID = c["id"].(string)
		}
	}
	reqA := httptest.NewRequest("GET", "/api/v1/accounts", nil)
	reqA.Header.Set("Authorization", "Bearer "+token)
	wA := httptest.NewRecorder()
	router.ServeHTTP(wA, reqA)
	var accs []map[string]any
	json.Unmarshal(wA.Body.Bytes(), &accs)
	var cashID string
	for _, a := range accs {
		if a["name"] == "Cash" {
			cashID = a["id"].(string)
		}
	}

	// Period 1, then period 2 chained after it.
	_, p1 := do("POST", "/api/v1/periods", token, map[string]any{
		"name": "M1", "startDate": "2026-01-01", "endDate": "2026-01-31",
	})
	p1ID := p1["id"].(string)
	_, p2 := do("POST", "/api/v1/periods", token, map[string]any{
		"name": "M2", "startDate": "2026-02-01", "endDate": "2026-02-28",
	})
	p2ID := p2["id"].(string)

	// Back-dated expense in period 1 (period still open) changes its closing balances.
	wE, _ := do("POST", "/api/v1/periods/"+p1ID+"/expenses", token, map[string]any{
		"date": "2026-01-15", "categoryId": bazarID, "subcategory": "DailyBazar",
		"accountId": cashID, "amountExpr": "100",
	})
	if wE.Code != 201 {
		t.Fatalf("expense: %d", wE.Code)
	}

	// Repair from period 1 cascades new opening balances into period 2.
	wR, _ := do("POST", "/api/v1/periods/"+p1ID+"/repair", token, nil)
	if wR.Code != 204 {
		t.Fatalf("repair: %d", wR.Code)
	}

	// Period 2's status (opening-derived closing) should now reflect -100 in cash.
	reqS := httptest.NewRequest("GET", "/api/v1/periods/"+p2ID+"/status", nil)
	reqS.Header.Set("Authorization", "Bearer "+token)
	wS := httptest.NewRecorder()
	router.ServeHTTP(wS, reqS)
	if wS.Code != 200 {
		t.Fatalf("status: %d %s", wS.Code, wS.Body.String())
	}
	var status map[string]any
	json.Unmarshal(wS.Body.Bytes(), &status)
	balances := status["balances"].(map[string]any)
	if got := balances[cashID]; got == nil || got.(float64) != -10000 {
		t.Fatalf("period 2 opening cash = %v, want -10000 paisa after repair", balances[cashID])
	}
}
