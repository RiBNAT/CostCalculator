package http

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"costcalculator/backend/internal/config"
	"costcalculator/backend/internal/repo"
)

// Create a recurring template, list it back, then delete it.
func TestRecurringCRUD(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dbName := fmt.Sprintf("costcalc_recurring_test_%d", time.Now().UnixNano())
	db, err := repo.Connect(context.Background(), mongoURI(), dbName)
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
		"name": "T", "email": "rec@example.com", "password": "secret123",
	})
	token := resp["tokens"].(map[string]any)["accessToken"].(string)

	// amount must be > 0
	w, _ := do("POST", "/api/v1/recurring", token, map[string]any{
		"label": "Rent", "categoryId": "rent", "subcategory": "HouseRent", "accountId": "cash", "amount": 0,
	})
	if w.Code != 400 {
		t.Errorf("zero amount accepted: %d", w.Code)
	}

	w, created := do("POST", "/api/v1/recurring", token, map[string]any{
		"label": "Rent", "categoryId": "rent", "subcategory": "HouseRent", "accountId": "cash", "amount": 1300000,
	})
	if w.Code != 201 {
		t.Fatalf("create recurring: %d %s", w.Code, w.Body.String())
	}
	id := created["id"].(string)

	reqL := httptest.NewRequest("GET", "/api/v1/recurring", nil)
	reqL.Header.Set("Authorization", "Bearer "+token)
	wl := httptest.NewRecorder()
	router.ServeHTTP(wl, reqL)
	var list []map[string]any
	json.Unmarshal(wl.Body.Bytes(), &list)
	if len(list) != 1 || list[0]["label"] != "Rent" || list[0]["amount"].(float64) != 1300000 {
		t.Fatalf("list wrong: %s", wl.Body.String())
	}

	w, _ = do("DELETE", "/api/v1/recurring/"+id, token, nil)
	if w.Code != 204 {
		t.Errorf("delete: %d", w.Code)
	}
}
