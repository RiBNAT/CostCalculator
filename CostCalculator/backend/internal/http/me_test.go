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

// Profile management flow: get me -> update name/phone -> change password
// (wrong + right) -> login with new password -> change email (taken + ok).
func TestProfileFlow(t *testing.T) {
	gin.SetMode(gin.TestMode)
	uri := os.Getenv("MONGO_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017"
	}
	dbName := fmt.Sprintf("costcalc_me_test_%d", time.Now().UnixNano())
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
		"name": "Tanbir", "email": "t@example.com", "password": "secret123",
	})
	token := resp["tokens"].(map[string]any)["accessToken"].(string)

	// second user to occupy an email
	do("POST", "/api/v1/auth/register", "", map[string]any{
		"name": "Other", "email": "other@example.com", "password": "secret123",
	})

	// GET /me
	w, me := do("GET", "/api/v1/me", token, nil)
	if w.Code != 200 || me["email"] != "t@example.com" {
		t.Fatalf("GET /me: %d %v", w.Code, me)
	}
	if _, hasHash := me["passwordHash"]; hasHash {
		t.Fatal("password hash leaked in /me response")
	}

	// update name + phone
	w, me = do("PUT", "/api/v1/me", token, map[string]any{"name": "Tanbir H", "phone": "01700000000"})
	if w.Code != 200 || me["name"] != "Tanbir H" || me["phone"] != "01700000000" {
		t.Fatalf("PUT /me: %d %v", w.Code, me)
	}

	// change password with wrong current -> 403
	w, _ = do("PUT", "/api/v1/me/password", token, map[string]any{
		"currentPassword": "wrong", "newPassword": "newsecret123",
	})
	if w.Code != 403 {
		t.Errorf("wrong current password accepted: %d", w.Code)
	}
	// short new password -> 400
	w, _ = do("PUT", "/api/v1/me/password", token, map[string]any{
		"currentPassword": "secret123", "newPassword": "short",
	})
	if w.Code != 400 {
		t.Errorf("short password accepted: %d", w.Code)
	}
	// correct change -> 204, old password stops working, new one works
	w, _ = do("PUT", "/api/v1/me/password", token, map[string]any{
		"currentPassword": "secret123", "newPassword": "newsecret123",
	})
	if w.Code != 204 {
		t.Fatalf("password change failed: %d", w.Code)
	}
	w, _ = do("POST", "/api/v1/auth/login", "", map[string]any{"email": "t@example.com", "password": "secret123"})
	if w.Code != 401 {
		t.Errorf("old password still works: %d", w.Code)
	}
	w, _ = do("POST", "/api/v1/auth/login", "", map[string]any{"email": "t@example.com", "password": "newsecret123"})
	if w.Code != 200 {
		t.Errorf("new password rejected: %d", w.Code)
	}

	// change email to a taken one -> 409
	w, _ = do("PUT", "/api/v1/me/email", token, map[string]any{"email": "other@example.com", "password": "newsecret123"})
	if w.Code != 409 {
		t.Errorf("taken email accepted: %d", w.Code)
	}
	// change email with wrong password -> 403
	w, _ = do("PUT", "/api/v1/me/email", token, map[string]any{"email": "new@example.com", "password": "bad"})
	if w.Code != 403 {
		t.Errorf("email change with wrong password accepted: %d", w.Code)
	}
	// valid email change -> 200, login with new email works
	w, me = do("PUT", "/api/v1/me/email", token, map[string]any{"email": "New@Example.com", "password": "newsecret123"})
	if w.Code != 200 || me["email"] != "new@example.com" {
		t.Fatalf("email change failed: %d %v", w.Code, me)
	}
	w, _ = do("POST", "/api/v1/auth/login", "", map[string]any{"email": "new@example.com", "password": "newsecret123"})
	if w.Code != 200 {
		t.Errorf("login with new email failed: %d", w.Code)
	}
}
