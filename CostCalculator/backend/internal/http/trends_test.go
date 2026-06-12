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

// Two consecutive periods with expenses; /trends returns the per-period series
// (oldest first) and a current-vs-previous category comparison.
func TestPeriodTrends(t *testing.T) {
	gin.SetMode(gin.TestMode)
	uri := mongoURI()
	dbName := fmt.Sprintf("costcalc_trends_test_%d", time.Now().UnixNano())
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
		"name": "T", "email": "trend@example.com", "password": "secret123",
	})
	token := resp["tokens"].(map[string]any)["accessToken"].(string)

	// resolve seeded Bazar category + Cash account
	reqC := httptest.NewRequest("GET", "/api/v1/categories", nil)
	reqC.Header.Set("Authorization", "Bearer "+token)
	wc := httptest.NewRecorder()
	router.ServeHTTP(wc, reqC)
	var cats []map[string]any
	json.Unmarshal(wc.Body.Bytes(), &cats)
	var bazarID string
	for _, c := range cats {
		if c["name"] == "Bazar" {
			bazarID = c["id"].(string)
		}
	}
	reqA := httptest.NewRequest("GET", "/api/v1/accounts", nil)
	reqA.Header.Set("Authorization", "Bearer "+token)
	wa := httptest.NewRecorder()
	router.ServeHTTP(wa, reqA)
	var accs []map[string]any
	json.Unmarshal(wa.Body.Bytes(), &accs)
	var cashID string
	for _, a := range accs {
		if a["name"] == "Cash" {
			cashID = a["id"].(string)
		}
	}

	// older period: 100 taka of Bazar
	_, p1 := do("POST", "/api/v1/periods", token, map[string]any{
		"name": "May 26", "startDate": "2026-05-01", "endDate": "2026-05-31",
	})
	period1 := p1["id"].(string)
	do("POST", "/api/v1/periods/"+period1+"/expenses", token, map[string]any{
		"date": "2026-05-10", "categoryId": bazarID, "subcategory": "DailyBazar",
		"accountId": cashID, "amountExpr": "100",
	})

	// newer/current period: 250 taka of Bazar
	_, p2 := do("POST", "/api/v1/periods", token, map[string]any{
		"name": "June 26", "startDate": "2026-06-01", "endDate": "2026-06-30",
	})
	period2 := p2["id"].(string)
	do("POST", "/api/v1/periods/"+period2+"/expenses", token, map[string]any{
		"date": "2026-06-10", "categoryId": bazarID, "subcategory": "DailyBazar",
		"accountId": cashID, "amountExpr": "250",
	})

	w, _ := do("GET", "/api/v1/periods/"+period2+"/trends", token, nil)
	if w.Code != 200 {
		t.Fatalf("trends: %d %s", w.Code, w.Body.String())
	}
	var out struct {
		Series []struct {
			PeriodName string `json:"periodName"`
			TotalSpend int64  `json:"totalSpend"`
		} `json:"series"`
		PreviousPeriodName string `json:"previousPeriodName"`
		Comparison         []struct {
			Name     string `json:"name"`
			Current  int64  `json:"current"`
			Previous int64  `json:"previous"`
		} `json:"comparison"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if len(out.Series) != 2 {
		t.Fatalf("series length = %d, want 2", len(out.Series))
	}
	if out.Series[0].PeriodName != "May 26" || out.Series[1].PeriodName != "June 26" {
		t.Errorf("series not oldest-first: %q then %q", out.Series[0].PeriodName, out.Series[1].PeriodName)
	}
	if out.Series[0].TotalSpend != 10000 {
		t.Errorf("May spend = %d paisa, want 10000", out.Series[0].TotalSpend)
	}
	if out.Series[1].TotalSpend != 25000 {
		t.Errorf("June spend = %d paisa, want 25000", out.Series[1].TotalSpend)
	}
	if out.PreviousPeriodName != "May 26" {
		t.Errorf("previousPeriodName = %q, want \"May 26\"", out.PreviousPeriodName)
	}
	var bazar *struct {
		Name     string `json:"name"`
		Current  int64  `json:"current"`
		Previous int64  `json:"previous"`
	}
	for i := range out.Comparison {
		if out.Comparison[i].Name == "Bazar" {
			bazar = &out.Comparison[i]
		}
	}
	if bazar == nil {
		t.Fatal("Bazar missing from comparison")
	}
	if bazar.Current != 25000 || bazar.Previous != 10000 {
		t.Errorf("Bazar comparison = current %d / previous %d, want 25000 / 10000", bazar.Current, bazar.Previous)
	}
}

func mongoURI() string {
	if uri := os.Getenv("MONGO_URI"); uri != "" {
		return uri
	}
	return "mongodb://localhost:27017"
}
