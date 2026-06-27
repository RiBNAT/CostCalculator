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

func newCookieTestRouter(t *testing.T) (*gin.Engine, func()) {
	gin.SetMode(gin.TestMode)
	uri := os.Getenv("MONGO_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017"
	}
	dbName := fmt.Sprintf("costcalc_cookie_test_%d", time.Now().UnixNano())
	db, err := repo.Connect(context.Background(), uri, dbName)
	if err != nil {
		t.Skipf("mongo not available: %v", err)
	}
	router := NewRouter(config.Config{JWTSecret: "test", CORSOrigin: "*"}, db)
	return router, func() { db.Client.Database(dbName).Drop(context.Background()) }
}

func TestRegisterSetsHttpOnlyAuthCookies(t *testing.T) {
	router, cleanup := newCookieTestRouter(t)
	defer cleanup()

	var buf bytes.Buffer
	json.NewEncoder(&buf).Encode(map[string]any{
		"name": "C", "email": "c@example.com", "password": "secret123",
	})
	req := httptest.NewRequest("POST", "/api/v1/auth/register", &buf)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 201 {
		t.Fatalf("register: %d %s", w.Code, w.Body.String())
	}
	var gotAccess, gotRefresh bool
	for _, ck := range w.Result().Cookies() {
		if ck.Name == cookieAccess {
			gotAccess = true
			if !ck.HttpOnly {
				t.Error("access cookie is not HttpOnly")
			}
		}
		if ck.Name == cookieRefresh {
			gotRefresh = true
			if !ck.HttpOnly {
				t.Error("refresh cookie is not HttpOnly")
			}
		}
	}
	if !gotAccess || !gotRefresh {
		t.Fatalf("missing auth cookies: access=%v refresh=%v", gotAccess, gotRefresh)
	}
}

func TestAccessCookieAuthorizesProtectedRoute(t *testing.T) {
	router, cleanup := newCookieTestRouter(t)
	defer cleanup()

	var buf bytes.Buffer
	json.NewEncoder(&buf).Encode(map[string]any{
		"name": "C", "email": "c2@example.com", "password": "secret123",
	})
	reqR := httptest.NewRequest("POST", "/api/v1/auth/register", &buf)
	reqR.Header.Set("Content-Type", "application/json")
	wR := httptest.NewRecorder()
	router.ServeHTTP(wR, reqR)
	if wR.Code != 201 {
		t.Fatalf("register: %d", wR.Code)
	}

	// Call a protected route with ONLY the cookies (no Authorization header).
	reqP := httptest.NewRequest("GET", "/api/v1/periods", nil)
	for _, ck := range wR.Result().Cookies() {
		reqP.AddCookie(ck)
	}
	wP := httptest.NewRecorder()
	router.ServeHTTP(wP, reqP)
	if wP.Code != 200 {
		t.Fatalf("cookie-authorized request failed: %d %s", wP.Code, wP.Body.String())
	}
}

func TestRefreshFromCookieRotatesCookies(t *testing.T) {
	router, cleanup := newCookieTestRouter(t)
	defer cleanup()

	var buf bytes.Buffer
	json.NewEncoder(&buf).Encode(map[string]any{
		"name": "C", "email": "c3@example.com", "password": "secret123",
	})
	reqR := httptest.NewRequest("POST", "/api/v1/auth/register", &buf)
	reqR.Header.Set("Content-Type", "application/json")
	wR := httptest.NewRecorder()
	router.ServeHTTP(wR, reqR)
	if wR.Code != 201 {
		t.Fatalf("register: %d", wR.Code)
	}

	// Refresh with no body — the refresh cookie must drive it.
	reqF := httptest.NewRequest("POST", "/api/v1/auth/refresh", nil)
	for _, ck := range wR.Result().Cookies() {
		reqF.AddCookie(ck)
	}
	wF := httptest.NewRecorder()
	router.ServeHTTP(wF, reqF)
	if wF.Code != 200 {
		t.Fatalf("cookie refresh failed: %d %s", wF.Code, wF.Body.String())
	}
	var gotAccess bool
	for _, ck := range wF.Result().Cookies() {
		if ck.Name == cookieAccess && ck.Value != "" {
			gotAccess = true
		}
	}
	if !gotAccess {
		t.Fatal("refresh did not re-issue the access cookie")
	}
}
