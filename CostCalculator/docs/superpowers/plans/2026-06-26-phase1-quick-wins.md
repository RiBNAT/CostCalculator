# Phase 1 Quick Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land six low-effort, high-value hardening fixes from the architectural review — error-leak removal, auth rate limiting, config hardening, graceful shutdown, self-healing period balances, and real frontend error states — without any schema or infra changes.

**Architecture:** Backend changes are additive Gin middleware (`RequestID`, `RateLimit`) plus small edits to `respond.go`, `config.go`, `main.go`, and a new idempotent `Periods.Repair` service method exposed as `POST /periods/:id/repair`. Frontend changes add a reusable `ErrorState` component and wire `useQuery` error branches + a session-expiry toast. Each task is independently mergeable.

**Tech Stack:** Go 1.26 + Gin v1.12 + MongoDB driver v1.17 (backend); Next.js 14 App Router + React 18 + TanStack Query v5 (frontend `web/`).

**Conventions in this codebase (follow them):**
- Error envelope helpers live in `backend/internal/http/respond.go`: `Err(c, status, code, message)`, `BadRequest`, `NotFound`, `Internal`.
- Handlers read the caller via `userID(c)` (set by `AuthRequired`).
- Mongo access goes through generics in `backend/internal/repo` (`FindOne[T]`, `FindAll[T]`, `ByID[T]`, `UpdateByID`).
- Go integration tests use real MongoDB and `t.Skipf` when it is unavailable (see `backend/internal/http/api_test.go`).
- Run backend tests from `CostCalculator/backend`; run frontend checks from `CostCalculator/web`.

**Decision note (deviation from spec):** The spec said "reject a non-TLS Mongo URI in release." Because the production `docker-compose.yml` connects the API to Mongo over an internal network without TLS, a hard failure would break the real deployment. This plan **warns** on a non-TLS Mongo URI in release and **warns** on a localhost CORS origin, while keeping the existing **hard failure** on an insecure `JWT_SECRET`.

---

### Task 1: Request ID middleware + non-leaking `Internal()`

Stops `Internal()` from returning raw error strings (e.g. Mongo connection details) to clients. Each request gets a short id echoed in `X-Request-Id`; the full error is logged server-side with that id, and the client gets a generic message referencing the id.

**Files:**
- Create: `CostCalculator/backend/internal/http/requestid.go`
- Modify: `CostCalculator/backend/internal/http/respond.go:1-25`
- Modify: `CostCalculator/backend/internal/http/router.go:29-30`
- Test: `CostCalculator/backend/internal/http/respond_test.go`

- [ ] **Step 1: Write the failing test**

Create `CostCalculator/backend/internal/http/respond_test.go`:

```go
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd CostCalculator/backend && go test ./internal/http/ -run TestInternalDoesNotLeakErrorString -v`
Expected: FAIL — `ctxRequestID` undefined (compile error) or leaked-string assertion fails.

- [ ] **Step 3: Create the request id middleware**

Create `CostCalculator/backend/internal/http/requestid.go`:

```go
package http

import (
	"crypto/rand"
	"encoding/hex"

	"github.com/gin-gonic/gin"
)

const ctxRequestID = "requestID"

// RequestID assigns a short random id to each request, stores it in the
// context, and echoes it back in the X-Request-Id header so a client error
// can be correlated with the server log line.
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := newRequestID()
		c.Set(ctxRequestID, id)
		c.Header("X-Request-Id", id)
		c.Next()
	}
}

func newRequestID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "unknown"
	}
	return hex.EncodeToString(b)
}

func requestID(c *gin.Context) string { return c.GetString(ctxRequestID) }
```

- [ ] **Step 4: Rewrite `Internal()` to log + return a generic message**

In `CostCalculator/backend/internal/http/respond.go`, add `"log"` to the import block and replace the one-line `Internal` (line 25):

```go
// Internal logs the full error server-side with the request id and returns a
// generic message to the client so internal details never leak.
func Internal(c *gin.Context, err error) {
	id := requestID(c)
	log.Printf("internal error [%s] %s %s: %v", id, c.Request.Method, c.Request.URL.Path, err)
	Err(c, 500, "internal", "internal server error (ref "+id+")")
}
```

The import block at the top of `respond.go` becomes:

```go
import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
)
```

- [ ] **Step 5: Register the middleware globally**

In `CostCalculator/backend/internal/http/router.go`, change line 30 from:

```go
	r.Use(gin.Logger(), gin.Recovery(), CORS(cfg.CORSOrigin))
```

to:

```go
	r.Use(RequestID(), gin.Logger(), gin.Recovery(), CORS(cfg.CORSOrigin))
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd CostCalculator/backend && go test ./internal/http/ -run TestInternalDoesNotLeakErrorString -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add CostCalculator/backend/internal/http/requestid.go CostCalculator/backend/internal/http/respond.go CostCalculator/backend/internal/http/router.go CostCalculator/backend/internal/http/respond_test.go
git commit -m "feat(api): request id + stop leaking internal errors to clients"
```

---

### Task 2: Auth rate limiting

Adds a dependency-free, per-IP fixed-window limiter and applies it to the `/auth/*` group so login/register/refresh can't be brute-forced.

**Files:**
- Create: `CostCalculator/backend/internal/http/ratelimit.go`
- Modify: `CostCalculator/backend/internal/http/router.go:35`
- Test: `CostCalculator/backend/internal/http/ratelimit_test.go`

- [ ] **Step 1: Write the failing test**

Create `CostCalculator/backend/internal/http/ratelimit_test.go`:

```go
package http

import (
	"testing"
	"time"
)

func TestRateLimiterAllow(t *testing.T) {
	rl := newRateLimiter(2, time.Minute)
	now := time.Unix(1000, 0)

	if !rl.allow("1.2.3.4", now) {
		t.Fatal("request 1 should be allowed")
	}
	if !rl.allow("1.2.3.4", now) {
		t.Fatal("request 2 should be allowed")
	}
	if rl.allow("1.2.3.4", now) {
		t.Fatal("request 3 should be blocked (over limit)")
	}
	if !rl.allow("5.6.7.8", now) {
		t.Fatal("a different ip should have its own budget")
	}
	if !rl.allow("1.2.3.4", now.Add(time.Minute+time.Second)) {
		t.Fatal("after the window resets the ip should be allowed again")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd CostCalculator/backend && go test ./internal/http/ -run TestRateLimiterAllow -v`
Expected: FAIL — `newRateLimiter` undefined.

- [ ] **Step 3: Implement the limiter and middleware**

Create `CostCalculator/backend/internal/http/ratelimit.go`:

```go
package http

import (
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// rateLimiter is a fixed-window, per-key counter safe for concurrent use.
type rateLimiter struct {
	mu     sync.Mutex
	hits   map[string]*rlWindow
	limit  int
	window time.Duration
}

type rlWindow struct {
	count int
	reset time.Time
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{hits: map[string]*rlWindow{}, limit: limit, window: window}
}

// allow reports whether key may proceed at time now, counting this attempt.
func (rl *rateLimiter) allow(key string, now time.Time) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	w, ok := rl.hits[key]
	if !ok || now.After(w.reset) {
		rl.hits[key] = &rlWindow{count: 1, reset: now.Add(rl.window)}
		return true
	}
	if w.count >= rl.limit {
		return false
	}
	w.count++
	return true
}

// RateLimit limits each client IP to `limit` requests per `window`, returning
// 429 when exceeded. Intended for the auth group.
func RateLimit(limit int, window time.Duration) gin.HandlerFunc {
	rl := newRateLimiter(limit, window)
	return func(c *gin.Context) {
		if !rl.allow(c.ClientIP(), time.Now()) {
			Err(c, 429, "rate_limited", "too many requests, please slow down")
			return
		}
		c.Next()
	}
}
```

- [ ] **Step 4: Apply the limiter to the auth group**

In `CostCalculator/backend/internal/http/router.go`, change line 35 from:

```go
	a := v1.Group("/auth")
```

to:

```go
	// 10 attempts/min/IP on auth endpoints (login, register, refresh, google).
	a := v1.Group("/auth", RateLimit(10, time.Minute))
```

Add `"time"` to the import block at the top of `router.go`:

```go
import (
	"time"

	"github.com/gin-gonic/gin"

	"costcalculator/backend/internal/config"
	"costcalculator/backend/internal/importer"
	"costcalculator/backend/internal/repo"
	"costcalculator/backend/internal/service"
)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd CostCalculator/backend && go test ./internal/http/ -run TestRateLimiterAllow -v`
Expected: PASS

- [ ] **Step 6: Build to confirm router still compiles**

Run: `cd CostCalculator/backend && go build ./...`
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add CostCalculator/backend/internal/http/ratelimit.go CostCalculator/backend/internal/http/ratelimit_test.go CostCalculator/backend/internal/http/router.go
git commit -m "feat(api): per-IP rate limiting on auth endpoints"
```

> **Deployment note (not a code step):** Gin's `ClientIP()` honors `X-Forwarded-For`, which a client can spoof unless trusted proxies are configured. When deploying behind the Next.js proxy / a load balancer, call `r.SetTrustedProxies([]string{<proxy CIDR>})` so the limiter keys on the real client IP. Out of scope for this task; track separately.

---

### Task 3: Config hardening

Keeps the existing hard failure on an insecure `JWT_SECRET` in release, and adds warnings for a localhost CORS origin and a non-TLS Mongo URI in release mode.

**Files:**
- Modify: `CostCalculator/backend/internal/config/config.go:1-39`
- Test: `CostCalculator/backend/internal/config/config_test.go`

- [ ] **Step 1: Write the failing test**

Create `CostCalculator/backend/internal/config/config_test.go`:

```go
package config

import "testing"

func TestLoadRejectsInsecureSecretInRelease(t *testing.T) {
	t.Setenv("GIN_MODE", "release")
	t.Setenv("JWT_SECRET", "change-me-in-production")
	t.Setenv("MONGO_URI", "mongodb+srv://example")
	if _, err := Load(); err == nil {
		t.Fatal("expected error for insecure JWT secret in release mode")
	}
}

func TestLoadAcceptsStrongSecretInRelease(t *testing.T) {
	t.Setenv("GIN_MODE", "release")
	t.Setenv("JWT_SECRET", "a-long-random-production-secret")
	t.Setenv("MONGO_URI", "mongodb+srv://example")
	t.Setenv("CORS_ORIGIN", "https://app.example.com")
	if _, err := Load(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestLoadDevModeUsesDefaults(t *testing.T) {
	t.Setenv("GIN_MODE", "")
	t.Setenv("JWT_SECRET", "")
	if _, err := Load(); err != nil {
		t.Fatalf("dev mode should not error: %v", err)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd CostCalculator/backend && go test ./internal/config/ -v`
Expected: FAIL — `TestLoadAcceptsStrongSecretInRelease` currently has no TLS/CORS handling so it passes, but `go test` compiles all three; the meaningful new coverage is the warning paths added next. If all three already pass, proceed (the change below adds the warnings without breaking them).

- [ ] **Step 3: Add the release-mode warnings**

In `CostCalculator/backend/internal/config/config.go`, add `"log"` and `"strings"` to the imports and replace the release-mode check block (lines 35-37):

```go
import (
	"fmt"
	"log"
	"os"
	"strings"
)
```

Replace:

```go
	if os.Getenv("GIN_MODE") == "release" && insecureSecrets[cfg.JWTSecret] {
		return cfg, fmt.Errorf("JWT_SECRET must be set to a strong value when GIN_MODE=release")
	}
	return cfg, nil
```

with:

```go
	if os.Getenv("GIN_MODE") == "release" {
		if insecureSecrets[cfg.JWTSecret] {
			return cfg, fmt.Errorf("JWT_SECRET must be set to a strong value when GIN_MODE=release")
		}
		if cfg.CORSOrigin == "" || strings.Contains(cfg.CORSOrigin, "localhost") {
			log.Printf("warning: CORS_ORIGIN is %q in release mode; set it to your real frontend origin", cfg.CORSOrigin)
		}
		if !strings.HasPrefix(cfg.MongoURI, "mongodb+srv://") && !strings.Contains(cfg.MongoURI, "tls=true") {
			log.Printf("warning: MONGO_URI is not using TLS in release mode; prefer mongodb+srv:// or tls=true unless Mongo is on a private network")
		}
	}
	return cfg, nil
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd CostCalculator/backend && go test ./internal/config/ -v`
Expected: PASS (all three tests).

- [ ] **Step 5: Commit**

```bash
git add CostCalculator/backend/internal/config/config.go CostCalculator/backend/internal/config/config_test.go
git commit -m "feat(config): warn on localhost CORS and non-TLS Mongo in release mode"
```

---

### Task 4: Graceful shutdown

Replaces the blocking `r.Run()` with an `http.Server` that drains in-flight requests on SIGINT/SIGTERM, removing the "killed mid-write" corruption window.

**Files:**
- Modify: `CostCalculator/backend/cmd/server/main.go:1-26`

(No unit test — graceful shutdown is verified by compile + a manual smoke run. Go's `signal.NotifyContext` + `srv.Shutdown` is the standard, well-tested pattern.)

- [ ] **Step 1: Rewrite `main.go`**

Replace the entire contents of `CostCalculator/backend/cmd/server/main.go` with:

```go
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"costcalculator/backend/internal/config"
	httpapi "costcalculator/backend/internal/http"
	"costcalculator/backend/internal/repo"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	db, err := repo.Connect(context.Background(), cfg.MongoURI, cfg.MongoDB)
	if err != nil {
		log.Fatalf("mongo connect: %v", err)
	}

	srv := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: httpapi.NewRouter(cfg, db),
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("cost-calculator api listening on :%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("listen: %v", err)
		}
	}()

	<-ctx.Done()
	stop()
	log.Println("shutdown signal received, draining connections...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Fatalf("forced shutdown: %v", err)
	}
	log.Println("server stopped cleanly")
}
```

- [ ] **Step 2: Verify it compiles and vets**

Run: `cd CostCalculator/backend && go build ./... && go vet ./cmd/server/`
Expected: no output, exit 0.

- [ ] **Step 3: Manual smoke test (optional but recommended)**

Run: `cd CostCalculator/backend && go run ./cmd/server/` (requires Mongo reachable), confirm the "listening" log, then press Ctrl+C.
Expected: logs "shutdown signal received, draining connections..." then "server stopped cleanly" and exits 0 (not a hard kill).

- [ ] **Step 4: Commit**

```bash
git add CostCalculator/backend/cmd/server/main.go
git commit -m "feat(api): graceful shutdown on SIGINT/SIGTERM with connection draining"
```

---

### Task 5: Self-healing period recompute (`POST /periods/:id/repair`)

`recomputeDownstream` is already idempotent — it rebuilds each downstream period's opening balances from its predecessor's closing balances. This task exposes that as a `Repair` method + endpoint so a chain left inconsistent by a partial close (or a back-dated edit to a past period) can be healed by re-running it. No schema change.

**Files:**
- Modify: `CostCalculator/backend/internal/service/periods.go` (add `Repair` after `Reopen`, ~line 159)
- Modify: `CostCalculator/backend/internal/http/handlers_periods.go` (add `repair` handler after `reopen`, ~line 178)
- Modify: `CostCalculator/backend/internal/http/router.go:66` (add route)
- Modify: `CostCalculator/web/lib/api.ts:109` (add client method)
- Test: `CostCalculator/backend/internal/http/periods_repair_test.go`

- [ ] **Step 1: Write the failing integration test**

Create `CostCalculator/backend/internal/http/periods_repair_test.go`:

```go
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd CostCalculator/backend && go test ./internal/http/ -run TestPeriodRepairRecomputesDownstream -v`
Expected: FAIL — route `/periods/:id/repair` returns 404 (handler not wired), so `wR.Code != 204`. (If Mongo is unavailable the test SKIPs — start Mongo with `docker compose up -d mongo` from `CostCalculator/` first.)

- [ ] **Step 3: Add the `Repair` service method**

In `CostCalculator/backend/internal/service/periods.go`, add after the `Reopen` method (after line 159):

```go
// Repair re-derives the opening balances of every period downstream of the
// given period from its (recomputed) closing balances. It is idempotent and
// heals chains left inconsistent by a partial close or a back-dated edit.
func (p *Periods) Repair(ctx context.Context, userID, periodID string) error {
	period, err := repo.ByID[domain.Period](ctx, p.DB.Periods, userID, periodID)
	if err != nil {
		return err
	}
	if period == nil {
		return ErrPeriodNotFound
	}
	return p.recomputeDownstream(ctx, period)
}
```

- [ ] **Step 4: Add the `repair` HTTP handler**

In `CostCalculator/backend/internal/http/handlers_periods.go`, add after the `reopen` handler (after line 178):

```go
func (h *periodHandlers) repair(c *gin.Context) {
	err := h.periods.Repair(c, userID(c), c.Param("id"))
	switch err {
	case nil:
		c.Status(204)
	case service.ErrPeriodNotFound:
		NotFound(c)
	default:
		Internal(c, err)
	}
}
```

- [ ] **Step 5: Wire the route**

In `CostCalculator/backend/internal/http/router.go`, add immediately after line 66 (`p.POST("/periods/:id/reopen", ph.reopen)`):

```go
			p.POST("/periods/:id/repair", ph.repair)
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd CostCalculator/backend && go test ./internal/http/ -run TestPeriodRepairRecomputesDownstream -v`
Expected: PASS

- [ ] **Step 7: Add the frontend client method**

In `CostCalculator/web/lib/api.ts`, add after line 109 (`reopenPeriod: ...`):

```ts
  repairPeriod: (id: string) => request<void>("POST", `/periods/${id}/repair`),
```

- [ ] **Step 8: Verify frontend types still compile**

Run: `cd CostCalculator/web && npx tsc --noEmit`
Expected: no output, exit 0.

- [ ] **Step 9: Commit**

```bash
git add CostCalculator/backend/internal/service/periods.go CostCalculator/backend/internal/http/handlers_periods.go CostCalculator/backend/internal/http/router.go CostCalculator/backend/internal/http/periods_repair_test.go CostCalculator/web/lib/api.ts
git commit -m "feat(periods): idempotent repair endpoint to heal downstream balances"
```

---

### Task 6: Frontend `ErrorState` component + dashboard error branches

Adds a reusable error component and makes the dashboard render it (with a retry) when its critical query fails, instead of an indefinite spinner / blank screen.

**Files:**
- Modify: `CostCalculator/web/components/ui.tsx` (add `ErrorState` after `Spinner`, ~line 54)
- Modify: `CostCalculator/web/app/(app)/dashboard/page.tsx:8,19,34-37`

(UI presentation; verified by typecheck + the preview workflow.)

- [ ] **Step 1: Add the `ErrorState` component**

In `CostCalculator/web/components/ui.tsx`, add after the `Spinner` function (after line 54):

```tsx
export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="empty">
      <Icon name="triangle-exclamation" />
      <h3>Something went wrong</h3>
      <p style={{ margin: "0 0 14px" }}>{message || "Could not load this data. Please try again."}</p>
      {onRetry && (
        <button className="ob-btn ob-btn--primary" onClick={onRetry}>Try again</button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Import `ErrorState` in the dashboard**

In `CostCalculator/web/app/(app)/dashboard/page.tsx`, change line 8 from:

```tsx
import { Icon, Spinner, EmptyState } from "@/components/ui";
```

to:

```tsx
import { Icon, Spinner, EmptyState, ErrorState } from "@/components/ui";
```

- [ ] **Step 3: Capture error state from the summary query**

In `CostCalculator/web/app/(app)/dashboard/page.tsx`, change line 19 from:

```tsx
  const { data: summary } = useQuery({ queryKey: ["summary", pid], queryFn: () => api.periodSummary(pid!), enabled: !!pid });
```

to:

```tsx
  const { data: summary, isError: summaryError, error: summaryErr, refetch: refetchSummary } = useQuery({ queryKey: ["summary", pid], queryFn: () => api.periodSummary(pid!), enabled: !!pid });
```

- [ ] **Step 4: Render the error branch**

In `CostCalculator/web/app/(app)/dashboard/page.tsx`, replace the guard block at lines 34-36:

```tsx
  if (loading) return <>{header}<div className="page"><Spinner /></div></>;
  if (!selected) return <>{header}<div className="page"><EmptyState icon="calendar-plus" title="No period yet" hint="Create your first salary cycle to start tracking." action={<Link href="/settings" className="ob-btn ob-btn--primary">Create a period</Link>} /></div></>;
  if (!summary) return <>{header}<div className="page"><Spinner /></div></>;
```

with:

```tsx
  if (loading) return <>{header}<div className="page"><Spinner /></div></>;
  if (!selected) return <>{header}<div className="page"><EmptyState icon="calendar-plus" title="No period yet" hint="Create your first salary cycle to start tracking." action={<Link href="/settings" className="ob-btn ob-btn--primary">Create a period</Link>} /></div></>;
  if (summaryError) return <>{header}<div className="page"><ErrorState message={(summaryErr as Error)?.message} onRetry={() => refetchSummary()} /></div></>;
  if (!summary) return <>{header}<div className="page"><Spinner /></div></>;
```

- [ ] **Step 5: Verify it typechecks**

Run: `cd CostCalculator/web && npx tsc --noEmit`
Expected: no output, exit 0.

- [ ] **Step 6: Verify in the browser (preview workflow)**

Start the dev server (`preview_start`), open the dashboard, and confirm normal load still renders KPIs. Then confirm the error branch: temporarily stop the backend (or use the network panel to observe the failed `/summary` call) and verify the "Something went wrong / Try again" state appears instead of a perpetual spinner. Screenshot the error state as proof.

- [ ] **Step 7: Commit**

```bash
git add CostCalculator/web/components/ui.tsx "CostCalculator/web/app/(app)/dashboard/page.tsx"
git commit -m "feat(web): reusable ErrorState and dashboard error/retry branch"
```

---

### Task 7: Session-expiry toast

When a refresh fails and auth is lost, show a toast ("Your session expired — please sign in again") before redirecting to `/login`, instead of a silent bounce.

**Files:**
- Modify: `CostCalculator/web/lib/auth.tsx:1-28`

(Wiring change; verified by typecheck + preview. `setOnAuthLost` is already called from `api.ts` on a failed refresh — see `api.ts:59`.)

- [ ] **Step 1: Use the toast inside `AuthProvider`**

In `CostCalculator/web/lib/auth.tsx`, change the import on line 5 area to add the toast hook. Replace line 4-5:

```tsx
import { api, tokens, storedUser, setOnAuthLost } from "./api";
import type { User } from "./types";
```

with:

```tsx
import { api, tokens, storedUser, setOnAuthLost } from "./api";
import { useToast } from "./toast";
import type { User } from "./types";
```

- [ ] **Step 2: Show the toast in the auth-lost handler**

In `CostCalculator/web/lib/auth.tsx`, inside `AuthProvider`, add the hook near the other hooks (after line 22, `const router = useRouter();`):

```tsx
  const toast = useToast();
```

Then change the `useEffect` (lines 24-28) from:

```tsx
  useEffect(() => {
    setUser(storedUser.get());
    setReady(true);
    setOnAuthLost(() => { storedUser.set(null); setUser(null); router.replace("/login"); });
  }, [router]);
```

to:

```tsx
  useEffect(() => {
    setUser(storedUser.get());
    setReady(true);
    setOnAuthLost(() => {
      storedUser.set(null);
      setUser(null);
      toast("Your session expired — please sign in again.");
      router.replace("/login");
    });
  }, [router, toast]);
```

> Provider order is already correct: in `app/providers.tsx`, `ToastProvider` wraps `AuthProvider`, so `useToast()` is available inside `AuthProvider`.

- [ ] **Step 3: Verify it typechecks**

Run: `cd CostCalculator/web && npx tsc --noEmit`
Expected: no output, exit 0.

- [ ] **Step 4: Verify in the browser (preview workflow)**

With the app running and logged in, simulate auth loss (clear the access+refresh tokens in localStorage, then trigger any API call by navigating). Confirm a toast appears and the app redirects to `/login`. Screenshot as proof.

- [ ] **Step 5: Commit**

```bash
git add CostCalculator/web/lib/auth.tsx
git commit -m "feat(web): toast on session expiry before redirect to login"
```

---

## Final verification

- [ ] **Backend: full test suite**

Run: `cd CostCalculator/backend && go test ./...`
Expected: PASS (Mongo-backed tests SKIP if Mongo is unavailable; start it with `docker compose up -d mongo` from `CostCalculator/` to exercise them).

- [ ] **Backend: build + vet**

Run: `cd CostCalculator/backend && go build ./... && go vet ./...`
Expected: clean, exit 0.

- [ ] **Frontend: typecheck + build**

Run: `cd CostCalculator/web && npx tsc --noEmit && npm run build`
Expected: build succeeds.

---

## Self-review (spec coverage)

| Spec Phase 1 item | Task |
|---|---|
| Graceful shutdown | Task 4 |
| Stop leaking internal errors | Task 1 |
| Auth rate limiting | Task 2 |
| Self-healing period recompute | Task 5 |
| Frontend error states + session-expiry toast | Tasks 6 & 7 |
| Config hardening | Task 3 |

All six Phase 1 items are covered. Phases 2 (cookie auth, cross-user isolation test, real transactions) and 3 (OpenAPI codegen, delete Angular, summary batching) are intentionally deferred to follow-on plans.
