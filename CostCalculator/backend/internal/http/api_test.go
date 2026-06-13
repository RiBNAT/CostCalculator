package http

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"costcalculator/backend/internal/config"
	"costcalculator/backend/internal/repo"
)

// End-to-end flow over real HTTP handlers + MongoDB:
// register -> seeded refdata -> create period -> expense -> budget -> summary.
func TestAPIFlow(t *testing.T) {
	gin.SetMode(gin.TestMode)
	uri := os.Getenv("MONGO_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017"
	}
	dbName := fmt.Sprintf("costcalc_api_test_%d", time.Now().UnixNano())
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

	// register seeds defaults and returns tokens
	w, resp := do("POST", "/api/v1/auth/register", "", map[string]any{
		"name": "Tanbir", "email": "t@example.com", "password": "secret123",
	})
	if w.Code != 201 {
		t.Fatalf("register: %d %s", w.Code, w.Body.String())
	}
	token := resp["tokens"].(map[string]any)["accessToken"].(string)

	// seeded categories
	req := httptest.NewRequest("GET", "/api/v1/categories", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	wc := httptest.NewRecorder()
	router.ServeHTTP(wc, req)
	var cats []map[string]any
	json.Unmarshal(wc.Body.Bytes(), &cats)
	if len(cats) != 8 {
		t.Fatalf("seeded categories = %d, want 8", len(cats))
	}
	var bazarID string
	for _, c := range cats {
		if c["name"] == "Bazar" {
			bazarID = c["id"].(string)
		}
	}

	// accounts
	req2 := httptest.NewRequest("GET", "/api/v1/accounts", nil)
	req2.Header.Set("Authorization", "Bearer "+token)
	wa := httptest.NewRecorder()
	router.ServeHTTP(wa, req2)
	var accs []map[string]any
	json.Unmarshal(wa.Body.Bytes(), &accs)
	var cashID string
	for _, a := range accs {
		if a["name"] == "Cash" {
			cashID = a["id"].(string)
		}
	}
	if cashID == "" || bazarID == "" {
		t.Fatal("seed data incomplete")
	}

	// create period
	w, resp = do("POST", "/api/v1/periods", token, map[string]any{
		"name": "July 26", "startDate": "2026-06-27", "endDate": "2026-07-26",
	})
	if w.Code != 201 {
		t.Fatalf("create period: %d %s", w.Code, w.Body.String())
	}
	periodID := resp["id"].(string)

	// overlapping period rejected
	w, _ = do("POST", "/api/v1/periods", token, map[string]any{
		"name": "Bad", "startDate": "2026-07-20", "endDate": "2026-08-10",
	})
	if w.Code != 409 {
		t.Errorf("overlap not rejected: %d", w.Code)
	}

	// expense with expression amount
	w, resp = do("POST", "/api/v1/periods/"+periodID+"/expenses", token, map[string]any{
		"date": "2026-06-28", "categoryId": bazarID, "subcategory": "DailyBazar",
		"accountId": cashID, "amountExpr": "360+20+330+30", "remarks": "bazar",
	})
	if w.Code != 201 {
		t.Fatalf("create expense: %d %s", w.Code, w.Body.String())
	}
	if amt := resp["amount"].(float64); amt != 74000 {
		t.Errorf("amount = %v paisa, want 74000", amt)
	}

	// wrong subcategory rejected
	w, _ = do("POST", "/api/v1/periods/"+periodID+"/expenses", token, map[string]any{
		"date": "2026-06-28", "categoryId": bazarID, "subcategory": "Tea",
		"accountId": cashID, "amountExpr": "10",
	})
	if w.Code != 400 {
		t.Errorf("invalid subcategory accepted: %d", w.Code)
	}

	// date outside the period range rejected
	w, resp = do("POST", "/api/v1/periods/"+periodID+"/expenses", token, map[string]any{
		"date": "2027-01-01", "categoryId": bazarID, "subcategory": "DailyBazar",
		"accountId": cashID, "amountExpr": "10",
	})
	if w.Code != 400 {
		t.Errorf("out-of-period date accepted: %d", w.Code)
	}

	// binding errors are humanized, not raw validator output
	w, resp = do("POST", "/api/v1/periods/"+periodID+"/expenses", token, map[string]any{
		"date": "2026-06-28", "categoryId": bazarID, "subcategory": "DailyBazar",
		"accountId": cashID,
	})
	if w.Code != 400 {
		t.Errorf("missing amountExpr accepted: %d", w.Code)
	}
	if msg := resp["error"].(map[string]any)["message"].(string); msg != "amount expr is required" {
		t.Errorf("bind message = %q, want humanized", msg)
	}

	// savings history is a single endpoint
	reqSH := httptest.NewRequest("GET", "/api/v1/savings/history", nil)
	reqSH.Header.Set("Authorization", "Bearer "+token)
	wsh := httptest.NewRecorder()
	router.ServeHTTP(wsh, reqSH)
	if wsh.Code != 200 {
		t.Errorf("savings history: %d %s", wsh.Code, wsh.Body.String())
	}
	var hist []map[string]any
	json.Unmarshal(wsh.Body.Bytes(), &hist)
	if len(hist) != 1 {
		t.Errorf("savings history points = %d, want 1", len(hist))
	}

	// budget put + report in summary
	w, _ = do("PUT", "/api/v1/periods/"+periodID+"/budget", token, map[string]any{
		"items": []map[string]any{{"categoryId": bazarID, "subcategory": "DailyBazar", "amount": 450000}},
	})
	if w.Code != 200 {
		t.Fatalf("put budget: %d %s", w.Code, w.Body.String())
	}

	var sum map[string]any
	req3 := httptest.NewRequest("GET", "/api/v1/periods/"+periodID+"/summary", nil)
	req3.Header.Set("Authorization", "Bearer "+token)
	ws := httptest.NewRecorder()
	router.ServeHTTP(ws, req3)
	if ws.Code != 200 {
		t.Fatalf("summary: %d %s", ws.Code, ws.Body.String())
	}
	json.Unmarshal(ws.Body.Bytes(), &sum)
	daily := sum["dailySeries"].([]any)
	if len(daily) != 30 {
		t.Errorf("daily series = %d days, want 30", len(daily))
	}
	budget := sum["budget"].(map[string]any)["totals"].(map[string]any)
	if budget["actual"].(float64) != 74000 {
		t.Errorf("budget actual = %v, want 74000", budget["actual"])
	}
	if budget["cashActual"].(float64) != 74000 {
		t.Errorf("cashActual = %v, want 74000", budget["cashActual"])
	}

	// close period then editing is blocked
	w, _ = do("POST", "/api/v1/periods/"+periodID+"/close", token, nil)
	if w.Code != 204 {
		t.Fatalf("close: %d", w.Code)
	}
	w, _ = do("POST", "/api/v1/periods/"+periodID+"/expenses", token, map[string]any{
		"date": "2026-06-29", "categoryId": bazarID, "subcategory": "DailyBazar",
		"accountId": cashID, "amountExpr": "10",
	})
	if w.Code != 409 {
		t.Errorf("closed period accepted expense: %d", w.Code)
	}
	// reopen works (latest period)
	w, _ = do("POST", "/api/v1/periods/"+periodID+"/reopen", token, nil)
	if w.Code != 204 {
		t.Errorf("reopen: %d", w.Code)
	}

	// auth required
	wn := httptest.NewRecorder()
	router.ServeHTTP(wn, httptest.NewRequest("GET", "/api/v1/periods", nil))
	if wn.Code != 401 {
		t.Errorf("unauthenticated request allowed: %d", wn.Code)
	}
	_ = http.StatusOK
}
