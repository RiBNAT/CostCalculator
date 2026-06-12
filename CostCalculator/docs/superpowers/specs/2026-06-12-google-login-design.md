# Google Login — Design

**Date:** 2026-06-12
**Status:** Approved

## Goal

Let users sign in with Google ("Sign in with Google" button) in addition to the
existing email/password auth, issuing the same JWT access/refresh pair so the
rest of the app is unchanged.

## Decisions

- **Approach:** Google Identity Services (GIS). The SPA obtains a signed Google
  **ID token** in the browser and POSTs it to the backend, which verifies it and
  issues our own JWT pair. No server-side redirect/authorization-code flow, no
  client secret, no session state — fits the SPA + stateless-JWT design.
- **Account linking:** by verified email. Same email = same account. A Google
  sign-in for an existing email logs into that account and attaches the Google
  ID. Safe because Google asserts `email_verified`.
- **Client ID delivery:** config-gated via `GOOGLE_CLIENT_ID` env. Empty =
  feature disabled (button hidden, endpoint returns 503). The SPA learns the ID
  from a public `/auth/config` endpoint so the Docker frontend never needs a
  rebuild to change it.
- **New users:** first Google sign-in seeds default categories/accounts via the
  existing `SeedDefaults`, matching password registration.

## Backend

### Data model (`domain.User`)
Add `GoogleID string` with `bson:"googleId,omitempty"`. Google-only users have an
empty `PasswordHash`; `bcrypt.CompareHashAndPassword` against an empty hash fails
naturally, so a password-login attempt on such an account returns
`ErrInvalidCredentials` with no special-casing.

### Token verification (interface for testability)
```go
type GoogleClaims struct { Sub, Email, Name string; EmailVerified bool }
type GoogleVerifier interface { Verify(ctx context.Context, idToken string) (*GoogleClaims, error) }
```
Real implementation wraps `google.golang.org/api/idtoken` (`idtoken.Validate`),
which checks signature, expiry, issuer, and audience (our client ID). Tests inject
a fake. Verification **requires `EmailVerified == true`**.

### Auth service — `LoginWithGoogle(ctx, idToken)`
1. Verify token → claims; reject if email not verified.
2. Find user by email. If found, attach `GoogleID` if unset, log in.
3. If not found, create user (`Name`, `Email`, `GoogleID`, empty password); flag
   newly-created.
4. Issue the existing JWT pair.

The `UserStore` interface gains what's needed to look up by Google ID / persist a
linked Google ID (e.g. `ByGoogleID`, `Update`).

### Config & endpoints
- `config.Config.GoogleClientID` from `GOOGLE_CLIENT_ID` (empty = disabled).
- `GET /api/v1/auth/config` (public) → `{ "googleEnabled": bool, "googleClientId": string }`.
- `POST /api/v1/auth/google` (public) → body `{ "idToken": "..." }`, returns the
  same `{ user, tokens }` shape as `/auth/login`. Returns `503` when disabled.
- The handler calls `SeedDefaults` only when a new user was created.

## Frontend

- `AuthService.loginWithGoogle(idToken)` mirrors `login()`, stores tokens identically.
- On login/register init, call `/auth/config`. If enabled, load the
  `https://accounts.google.com/gsi/client` script and render the official Google
  button on **both** the login and register pages. If disabled, render nothing.
- Credential callback → POST token → store pair → navigate to dashboard (same
  post-login path as today).

## Testing

- Service tests (fake verifier): new email → account created; existing email →
  `GoogleID` linked, no duplicate; `email_verified=false` → rejected.
- Handler test: feature disabled (no client ID) → `503`.
- Live Google consent-screen click-through deferred until a real Client ID is
  wired; everything up to the token exchange is unit-tested.

## Dependencies

Adds `google.golang.org/api/idtoken` to the Go module.
