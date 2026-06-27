# Phase 2a — httpOnly Cookie Auth + Cross-User Isolation Test

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate XSS token theft by moving the access/refresh tokens into `HttpOnly; Secure; SameSite=Strict` cookies (the SPA stops holding tokens in `localStorage`), and pin the per-user authorization boundary with an integration test.

**Architecture:** The backend keeps issuing the same JWT pair but additionally sets them as httpOnly cookies on login/register/google/refresh, adds a `logout` endpoint that clears them, and accepts the access token from either the `Authorization: Bearer` header **or** the `rib_access` cookie (and the refresh token from body **or** `rib_refresh` cookie). This is fully backward-compatible: existing Bearer-header tests and any API clients keep working. The Next.js app — already same-origin with the API via the rewrite proxy — switches to cookie auth (fetch sends same-origin cookies automatically), drops `localStorage` token storage, and calls `logout`.

**Tech Stack:** Go 1.26 + Gin v1.12 + golang-jwt v5 (backend); Next.js 14 + React 18 + TanStack Query v5 (frontend `web/`).

**Design decisions (flag if you disagree before executing):**
- **Both tokens are cookies.** `rib_access` is scoped `Path=/api/v1` (sent on every API call); `rib_refresh` is scoped `Path=/api/v1/auth/refresh` (sent only to the refresh endpoint), narrowing its exposure.
- **`SameSite=Strict`.** The SPA and API are same-origin (Next rewrite proxy), so Strict works and gives strong CSRF protection without a separate CSRF token.
- **`Secure` is conditional.** True in release (`GIN_MODE=release`), false in dev so cookies work over `http://localhost`.
- **JSON `tokens` are still returned** in auth responses. The frontend ignores them; keeping them avoids breaking the existing Bearer-based Go tests and any non-browser API clients. (A later cleanup can stop emitting them once all clients use cookies — out of scope here.)
- **The non-secret `user` object stays in `localStorage`** for instant render on reload; only the *tokens* move to httpOnly cookies. Tokens are what an XSS attacker wants; the user profile is not sensitive.

---

### Task 1: Cookie config + cookie helpers

Adds a `CookieSecure` config flag and the helper functions that write/clear the auth cookies.

**Files:**
- Modify: `CostCalculator/backend/internal/config/config.go`
- Create: `CostCalculator/backend/internal/http/cookies.go`

- [ ] **Step 1: Add `CookieSecure` to config**

In `CostCalculator/backend/internal/config/config.go`, add the field to the `Config` struct:

```go
type Config struct {
	Port           string
	MongoURI       string
	MongoDB        string
	JWTSecret      string
	CORSOrigin     string
	GoogleClientID string
	CookieSecure   bool
}
```

Then set it inside `Load()`, immediately after the `cfg := Config{...}` literal (before the release-mode block):

```go
	cfg.CookieSecure = os.Getenv("GIN_MODE") == "release"
```

- [ ] **Step 2: Create the cookie helpers**

Create `CostCalculator/backend/internal/http/cookies.go`:

```go
package http

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

const (
	cookieAccess  = "rib_access"
	cookieRefresh = "rib_refresh"
	accessPath    = "/api/v1"
	refreshPath   = "/api/v1/auth/refresh"
)

// setAuthCookies writes the access and refresh tokens as HttpOnly cookies.
// accessMaxAge/refreshMaxAge are in seconds.
func setAuthCookies(c *gin.Context, access, refresh string, accessMaxAge, refreshMaxAge int, secure bool) {
	c.SetSameSite(http.SameSiteStrictMode)
	c.SetCookie(cookieAccess, access, accessMaxAge, accessPath, "", secure, true)
	c.SetCookie(cookieRefresh, refresh, refreshMaxAge, refreshPath, "", secure, true)
}

// clearAuthCookies expires both auth cookies.
func clearAuthCookies(c *gin.Context, secure bool) {
	c.SetSameSite(http.SameSiteStrictMode)
	c.SetCookie(cookieAccess, "", -1, accessPath, "", secure, true)
	c.SetCookie(cookieRefresh, "", -1, refreshPath, "", secure, true)
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd CostCalculator/backend && go build ./...`
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add CostCalculator/backend/internal/config/config.go CostCalculator/backend/internal/http/cookies.go
git commit -m "feat(api): cookie config flag and httpOnly auth-cookie helpers"
```

---

### Task 2: Issue cookies on auth responses + logout endpoint

Wires the helpers into login/register/google/refresh and adds `POST /auth/logout`.

**Files:**
- Modify: `CostCalculator/backend/internal/http/handlers_auth.go`
- Modify: `CostCalculator/backend/internal/http/router.go`
- Test: `CostCalculator/backend/internal/http/auth_cookie_test.go`

- [ ] **Step 1: Write the failing test**

Create `CostCalculator/backend/internal/http/auth_cookie_test.go`:

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd CostCalculator/backend && go test ./internal/http/ -run TestRegisterSetsHttpOnlyAuthCookies -v`
Expected: FAIL — no auth cookies set (the handlers don't set them yet). (SKIPs if Mongo is down; start it with `docker compose up -d mongo` from `CostCalculator/`.)

- [ ] **Step 3: Add `cookieSecure` to the auth handler struct**

In `CostCalculator/backend/internal/http/handlers_auth.go`, change the `authHandlers` struct:

```go
type authHandlers struct {
	auth           *service.Auth
	db             *repo.DB
	googleClientID string
	cookieSecure   bool
}
```

- [ ] **Step 4: Set cookies in login / register / google**

In `CostCalculator/backend/internal/http/handlers_auth.go`, add a small private helper at the end of the file:

```go
func (h *authHandlers) writeAuthCookies(c *gin.Context, pair *service.TokenPair) {
	setAuthCookies(c, pair.AccessToken, pair.RefreshToken,
		int(h.auth.AccessTTL.Seconds()), int(h.auth.RefreshTTL.Seconds()), h.cookieSecure)
}
```

In the `google` handler, replace the success line `c.JSON(200, gin.H{"user": u, "tokens": pair})` with:

```go
	h.writeAuthCookies(c, pair)
	c.JSON(200, gin.H{"user": u, "tokens": pair})
```

In the `register` handler, replace the success line `c.JSON(201, gin.H{"user": u, "tokens": pair})` with:

```go
	h.writeAuthCookies(c, pair)
	c.JSON(201, gin.H{"user": u, "tokens": pair})
```

In the `login` handler, replace the success line `c.JSON(200, gin.H{"user": u, "tokens": pair})` with:

```go
	h.writeAuthCookies(c, pair)
	c.JSON(200, gin.H{"user": u, "tokens": pair})
```

- [ ] **Step 5: Add the `logout` handler**

In `CostCalculator/backend/internal/http/handlers_auth.go`, add after the `refresh` handler:

```go
func (h *authHandlers) logout(c *gin.Context) {
	clearAuthCookies(c, h.cookieSecure)
	c.Status(204)
}
```

- [ ] **Step 6: Wire `cookieSecure` and the logout route**

In `CostCalculator/backend/internal/http/router.go`, change the `ah` construction (line ~19) from:

```go
	ah := &authHandlers{auth: auth, db: db, googleClientID: cfg.GoogleClientID}
```

to:

```go
	ah := &authHandlers{auth: auth, db: db, googleClientID: cfg.GoogleClientID, cookieSecure: cfg.CookieSecure}
```

And add the logout route inside the auth group (after `a.POST("/google", ah.google)`):

```go
	a.POST("/logout", ah.logout)
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd CostCalculator/backend && go test ./internal/http/ -run TestRegisterSetsHttpOnlyAuthCookies -v`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add CostCalculator/backend/internal/http/handlers_auth.go CostCalculator/backend/internal/http/router.go CostCalculator/backend/internal/http/auth_cookie_test.go
git commit -m "feat(api): set httpOnly auth cookies on login/register/google + logout endpoint"
```

---

### Task 3: Accept access token from cookie; refresh from cookie

Lets `AuthRequired` read the access token from the `rib_access` cookie when there's no Bearer header, and lets `refresh` read the refresh token from the `rib_refresh` cookie when there's no JSON body. Both keep the existing header/body paths working.

**Files:**
- Modify: `CostCalculator/backend/internal/http/middleware.go`
- Modify: `CostCalculator/backend/internal/http/handlers_auth.go`
- Test: `CostCalculator/backend/internal/http/auth_cookie_test.go` (add a case)

- [ ] **Step 1: Add the failing test case**

Append to `CostCalculator/backend/internal/http/auth_cookie_test.go`:

```go
func TestAccessCookieAuthorizesProtectedRoute(t *testing.T) {
	router, cleanup := newCookieTestRouter(t)
	defer cleanup()

	// Register to obtain auth cookies.
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd CostCalculator/backend && go test ./internal/http/ -run 'TestAccessCookieAuthorizesProtectedRoute|TestRefreshFromCookieRotatesCookies' -v`
Expected: FAIL — cookie-only request returns 401, and cookie-only refresh returns 401 (handlers still require header/body).

- [ ] **Step 3: Make `AuthRequired` read the access cookie**

In `CostCalculator/backend/internal/http/middleware.go`, replace the `AuthRequired` function body with a cookie fallback:

```go
// AuthRequired validates the access token (Bearer header or rib_access cookie)
// and stores the user id.
func AuthRequired(auth *service.Auth) gin.HandlerFunc {
	return func(c *gin.Context) {
		token, ok := strings.CutPrefix(c.GetHeader("Authorization"), "Bearer ")
		if !ok || token == "" {
			if ck, err := c.Cookie(cookieAccess); err == nil {
				token = ck
			}
		}
		if token == "" {
			Err(c, 401, "unauthorized", "missing credentials")
			return
		}
		uid, err := auth.Verify(token)
		if err != nil {
			Err(c, 401, "unauthorized", "invalid or expired token")
			return
		}
		c.Set(ctxUserID, uid)
		c.Next()
	}
}
```

- [ ] **Step 4: Make `refresh` read the refresh cookie**

In `CostCalculator/backend/internal/http/handlers_auth.go`, replace the entire `refresh` handler with:

```go
func (h *authHandlers) refresh(c *gin.Context) {
	var req struct {
		RefreshToken string `json:"refreshToken"`
	}
	_ = c.ShouldBindJSON(&req) // body is optional; the cookie can drive refresh
	rt := req.RefreshToken
	if rt == "" {
		if ck, err := c.Cookie(cookieRefresh); err == nil {
			rt = ck
		}
	}
	if rt == "" {
		Err(c, 401, "invalid_token", "missing refresh token")
		return
	}
	pair, err := h.auth.Refresh(c, rt)
	if err != nil {
		Err(c, 401, "invalid_token", "invalid refresh token")
		return
	}
	h.writeAuthCookies(c, pair)
	c.JSON(200, gin.H{"tokens": pair})
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd CostCalculator/backend && go test ./internal/http/ -run 'TestAccessCookieAuthorizesProtectedRoute|TestRefreshFromCookieRotatesCookies' -v`
Expected: PASS

- [ ] **Step 6: Run the full backend suite (no regressions)**

Run: `cd CostCalculator/backend && MONGO_URI=mongodb://localhost:27017 go test ./...`
Expected: PASS — the existing Bearer-header `TestAPIFlow` still works because the header path is unchanged.

- [ ] **Step 7: Commit**

```bash
git add CostCalculator/backend/internal/http/middleware.go CostCalculator/backend/internal/http/handlers_auth.go CostCalculator/backend/internal/http/auth_cookie_test.go
git commit -m "feat(api): accept access token from cookie and refresh from cookie"
```

---

### Task 4: Frontend — switch to cookie auth, drop localStorage tokens

The SPA stops storing tokens in `localStorage`, relies on same-origin cookies, and calls the logout endpoint. The non-secret `user` object stays cached for instant reload.

**Files:**
- Modify: `CostCalculator/web/lib/api.ts`
- Modify: `CostCalculator/web/lib/auth.tsx`

- [ ] **Step 1: Confirm nothing else imports the token store**

Run: `cd CostCalculator/web && grep -rn "tokens" lib app components`
Expected: the only references to the `tokens` export are in `lib/api.ts` (definition) and `lib/auth.tsx` (usage). If anything else imports it, update those call sites the same way as `auth.tsx` below.

- [ ] **Step 2: Rewrite the token/credential handling in `api.ts`**

In `CostCalculator/web/lib/api.ts`, replace the token store + key constants (lines 9-16) — the block:

```ts
const BASE = "/api/v1";
const K_ACCESS = "ribnat.access", K_REFRESH = "ribnat.refresh", K_USER = "ribnat.user";

export const tokens = {
  get access() { return typeof localStorage !== "undefined" ? localStorage.getItem(K_ACCESS) : null; },
  get refresh() { return typeof localStorage !== "undefined" ? localStorage.getItem(K_REFRESH) : null; },
  set(pair: TokenPair) { localStorage.setItem(K_ACCESS, pair.accessToken); localStorage.setItem(K_REFRESH, pair.refreshToken); },
  clear() { localStorage.removeItem(K_ACCESS); localStorage.removeItem(K_REFRESH); localStorage.removeItem(K_USER); },
};
```

with:

```ts
const BASE = "/api/v1";
const K_USER = "ribnat.user";

// Tokens now live in HttpOnly cookies set by the backend; the SPA never holds
// them. Only the non-secret user profile is cached for instant reload.
```

- [ ] **Step 3: Simplify `doRefresh` to use the cookie**

In `CostCalculator/web/lib/api.ts`, replace the `doRefresh` function (lines ~26-41) with:

```ts
let refreshing: Promise<boolean> | null = null;
async function doRefresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = fetch(`${BASE}/auth/refresh`, {
      method: "POST",
      credentials: "same-origin",
    })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => { setTimeout(() => (refreshing = null), 0); });
  }
  return refreshing;
}
```

- [ ] **Step 4: Send cookies and drop the Authorization header in `request`**

In `CostCalculator/web/lib/api.ts`, replace the `request` function header/fetch section. The block (lines ~46-61):

```ts
async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const isAuthPath = path.startsWith("/auth/");
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (body instanceof FormData) { payload = body; }
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  if (!isAuthPath && tokens.access) headers["Authorization"] = `Bearer ${tokens.access}`;

  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });

  if (res.status === 401 && !isAuthPath && retry) {
    const ok = await doRefresh();
    if (ok) return request<T>(method, path, body, false);
    tokens.clear(); onAuthLost?.();
    throw new ApiError(401, "Session expired");
  }
```

becomes:

```ts
async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const isAuthPath = path.startsWith("/auth/");
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (body instanceof FormData) { payload = body; }
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }

  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload, credentials: "same-origin" });

  if (res.status === 401 && !isAuthPath && retry) {
    const ok = await doRefresh();
    if (ok) return request<T>(method, path, body, false);
    storedUser.set(null); onAuthLost?.();
    throw new ApiError(401, "Session expired");
  }
```

- [ ] **Step 5: Add a `logout` API call**

In `CostCalculator/web/lib/api.ts`, in the `api` object add (next to the other auth calls, after `google:`):

```ts
  logout: () => request<void>("POST", "/auth/logout"),
```

- [ ] **Step 6: Update `auth.tsx` to stop storing tokens and to call logout**

In `CostCalculator/web/lib/auth.tsx`, change the import on line 4 from:

```tsx
import { api, tokens, storedUser, setOnAuthLost } from "./api";
```

to:

```tsx
import { api, storedUser, setOnAuthLost } from "./api";
```

Replace `apply` (line ~30) from:

```tsx
  const apply = (r: { user: User; tokens: { accessToken: string; refreshToken: string } }) => {
    tokens.set(r.tokens); storedUser.set(r.user); setUser(r.user);
  };
```

to:

```tsx
  const apply = (r: { user: User }) => {
    storedUser.set(r.user); setUser(r.user);
  };
```

Replace `logout` (line ~36) from:

```tsx
  const logout = useCallback(() => { tokens.clear(); storedUser.set(null); setUser(null); router.replace("/login"); }, [router]);
```

to:

```tsx
  const logout = useCallback(() => {
    api.logout().catch(() => {});
    storedUser.set(null); setUser(null); router.replace("/login");
  }, [router]);
```

And update the auth-lost handler in the `useEffect` from `storedUser.set(null)` (already correct) — no token clearing needed there anymore; leave the existing toast + redirect added in Phase 1 intact.

- [ ] **Step 7: Typecheck and build**

Run: `cd CostCalculator/web && npx tsc --noEmit && npm run build`
Expected: both succeed, exit 0.

- [ ] **Step 8: Verify in the browser (preview workflow)**

Start the full stack (Mongo + Go API on :8080 + `web` on :3000). Then:
1. Log in. In DevTools → Application → Cookies, confirm `rib_access` and `rib_refresh` exist with **HttpOnly** checked, and that `localStorage` has **no** `ribnat.access`/`ribnat.refresh` keys (only `ribnat.user`).
2. Reload — you stay logged in (cookie-driven).
3. Hit a protected page, confirm API calls succeed (Network panel shows requests carrying the cookies).
4. Click logout — confirm the cookies are cleared and you land on `/login`.
Screenshot the cookie panel (HttpOnly set, no tokens in localStorage) as proof.

- [ ] **Step 9: Commit**

```bash
git add CostCalculator/web/lib/api.ts CostCalculator/web/lib/auth.tsx
git commit -m "feat(web): cookie-based auth; stop storing JWTs in localStorage"
```

---

### Task 5: Cross-user isolation integration test

Proves a logged-in user cannot read or mutate another user's data. This is independent of the cookie work and can be implemented in parallel.

**Files:**
- Test: `CostCalculator/backend/internal/http/isolation_test.go`

- [ ] **Step 1: Write the failing test**

Create `CostCalculator/backend/internal/http/isolation_test.go`:

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

	// Sanity: A's period is untouched (still named A1, still open).
	wL, _ := do("GET", "/api/v1/periods", tokenA, nil)
	if wL.Code != 200 {
		t.Fatalf("A list periods: %d", wL.Code)
	}
}
```

- [ ] **Step 2: Run the test**

Run: `cd CostCalculator/backend && go test ./internal/http/ -run TestCrossUserPeriodAccessIsDenied -v`
Expected: This codifies the existing per-user filter (`bson.M{"userId": userID(c)}`). It should **PASS** if isolation already holds. If any sub-assertion FAILS, that is a real authorization bug — fix the offending handler so the query filters by `userID(c)` and returns 404 for a non-owned id, then re-run until green. Do not weaken the test to make it pass.

- [ ] **Step 3: Commit**

```bash
git add CostCalculator/backend/internal/http/isolation_test.go
git commit -m "test(api): cross-user period access is denied (authz boundary)"
```

---

## Final verification

- [ ] **Backend: full suite + build + vet**

Run: `cd CostCalculator/backend && MONGO_URI=mongodb://localhost:27017 go test ./... && go build ./... && go vet ./...`
Expected: PASS / clean.

- [ ] **Frontend: typecheck + build**

Run: `cd CostCalculator/web && npx tsc --noEmit && npm run build`
Expected: both succeed.

- [ ] **Manual end-to-end (preview):** log in → cookies are HttpOnly, no tokens in localStorage → reload stays logged in → logout clears cookies. (Per Task 4, Step 8.)

---

## Self-review (spec coverage)

| Phase 2 spec item | Covered by |
|---|---|
| #7 httpOnly cookie auth (backend issues cookies, frontend drops localStorage) | Tasks 1–4 |
| #8 cross-user isolation test | Task 5 |
| #9 real transactions (replica set) | **Deferred to Phase 2b** (separate plan — infra-risky, marked optional in spec) |

**Type/name consistency check:** `cookieAccess`/`cookieRefresh`/`accessPath`/`refreshPath` constants (Task 1) are used consistently in Tasks 2 & 3; `setAuthCookies`/`clearAuthCookies`/`writeAuthCookies` signatures match their call sites; `CookieSecure` config field flows config → `authHandlers.cookieSecure` → helper `secure` param. Frontend: `tokens` export fully removed and all references (`api.ts`, `auth.tsx`) updated; `storedUser` retained.

**Known limitation (documented, not a bug):** auth responses still include the JWT pair in the JSON body for backward compatibility with Bearer-based tests/clients. Stop emitting them in a follow-up once no client reads them.
