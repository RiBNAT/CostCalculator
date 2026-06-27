# Improvement Plan — Design / Spec

**Date:** 2026-06-26
**Status:** Approved (roadmap); Phase 1 scoped for first implementation plan
**Source:** Architectural review of the Cost Calculator app (Go + Gin + MongoDB backend, Angular legacy frontend, Next.js rebuild)

## Decisions driving this plan

- **Frontend direction:** Finish the Next.js rebuild, then delete the Angular `frontend/`. Plan targets the Next.js app only.
- **Threat model:** Treat the app as public-facing / could grow. Auth hardening, rate limiting, and cross-user isolation are in scope.
- **Appetite:** Quick wins first. The first implementation plan covers **Phase 1 only**. Phases 2–3 are follow-on plans.

## Key technical constraint discovered

MongoDB runs as a **standalone** (`docker-compose.yml`: `mongo:7`, no `--replSet`). Multi-document
transactions require a replica set, so wrapping the period-close cascade in a transaction is an infra
change, not a code-only fix.

`recomputeDownstream` (`backend/internal/service/periods.go:113`) is **idempotent** — it deterministically
rebuilds each period's opening balances from its predecessor's closing balances. Therefore a partial failure
can be healed by re-running it. Phase 1 leans on this idempotency (self-healing recompute) to close the
integrity gap without converting Mongo to a replica set. Real transactions are deferred to Phase 2 (#9).

## Phase 1 — Quick wins (first implementation plan)

1. **Graceful shutdown** — replace `r.Run()` in `backend/cmd/server/main.go` with an `http.Server` started
   in a goroutine, plus `signal.NotifyContext` (SIGINT/SIGTERM) and `server.Shutdown(ctx)` with a timeout.
   Removes the "killed mid-write" corruption edge.
2. **Stop leaking internal errors** — `Internal()` in `backend/internal/http/respond.go` currently returns raw
   error strings to the client. Generate/propagate a request ID (middleware), log the full error with that ID
   server-side, return a generic message + ID to the client.
3. **Auth rate limiting** — add an IP-based limiter middleware on the `/auth/*` route group
   (`backend/internal/http/router.go`). Sensible default (e.g. ~10 attempts/min/IP) returning 429.
4. **Self-healing period recompute** — make close + cascade safely re-runnable and add a defensive recompute
   trigger (a `POST /periods/:id/repair` endpoint and/or recompute-on-load guard). Relies on existing
   idempotency; no schema change.
5. **Frontend error states** — add `isError`/`error` handling to `useQuery` calls in the Next.js app
   (`web/app/(app)/dashboard/page.tsx` and siblings) and a session-expiry toast instead of a silent redirect.
6. **Config hardening** — in `backend/internal/config/config.go`, fail fast in release mode on the default
   `JWT_SECRET` (`change-me-in-production`), warn on the default CORS origin, and reject a non-TLS Mongo URI in
   release mode.

## Phase 2 — Mandatory for public (follow-on)

7. **httpOnly cookie auth** — backend issues `Secure; HttpOnly; SameSite=Strict` cookies; Next.js drops
   `localStorage` tokens and client-side refresh logic. Feasible cheaply because the API is already
   same-origin via the Next rewrite proxy. Eliminates XSS token theft.
8. **Cross-user isolation test** — integration test proving user A cannot read/write user B's data through
   every handler. Pins the authz boundary.
9. **Real transactions (optional/proper)** — convert Mongo to a single-node replica set and wrap close + seed
   in `session.WithTransaction`. The "done right" version of #4.

## Phase 3 — Strategic debt (follow-on)

10. **OpenAPI → generated TS types** — eliminate the multi-copy type drift (Go structs + Angular + Next +
    manual) by generating `web/lib/types.ts` from an OpenAPI spec. Turns drift into compile errors.
11. **Finish Next.js parity → delete `frontend/`** — remove the Angular app once the Next.js app reaches
    feature parity. Removes roughly half the maintenance surface.
12. **Summary query batching** — fix the N+1 fan-out in `backend/internal/service/summary.go`
    (`SavingsHistory`, `Trends`, `Build`): prefetch accounts once, batch expenses/transfers across periods.

## Out of scope (YAGNI for now)

- Password reset flow (note it; defer).
- Feature flags / A/B testing.
- Google sign-in `g_csrf_token` double-submit (low risk; the `idToken` is already audience-bound and
  server-validated).
- Cross-tab period-selection sync.

## Success criteria

- Phase 1 ships without schema or infra changes; each item independently mergeable.
- After Phase 1: clean shutdown drains in-flight requests; no internal error strings reach clients; auth
  endpoints rate-limited; a corrupted period chain can be repaired by re-running recompute; the Next.js UI
  shows errors instead of blank states; release mode refuses insecure config.
