# Phase 2b — Mongo Replica Set + Transactions

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the period-close cascade and the new-user seed atomic by converting MongoDB to a single-node replica set and wrapping those multi-document writes in transactions, so a partial failure can never leave a corrupted balance chain or a half-seeded account set.

**Architecture:** Convert the Docker `mongo` service to a single-node replica set (`rs0`) — a config + one-time `rs.initiate()`, no data loss. Add a `repo.DB.WithTransaction` helper over the driver's `session.WithTransaction`, then thread a session context through `Periods.Close` (status update + downstream recompute) and `service.SeedDefaults` (category + account inserts). Transactions require a replica set; this plan establishes that prerequisite first.

**Tech Stack:** MongoDB 7 (replica set) + mongo-driver v1.17 + Go 1.26.

**Dependency:** Task 1 (replica set) MUST land and be initiated before Tasks 2–3 will pass — transactions error on a standalone mongod.

---

### Task 1: Convert MongoDB to a single-node replica set

**Files:**
- Modify: `CostCalculator/docker-compose.yml`

- [ ] **Step 1: Add the replica-set command and update the healthcheck**

In `CostCalculator/docker-compose.yml`, replace the `mongo` service block:

```yaml
  mongo:
    image: mongo:7
    volumes:
      - mongo-data:/data/db
    healthcheck:
      test: ["CMD", "mongosh", "--quiet", "--eval", "db.runCommand({ping: 1}).ok"]
      interval: 10s
      timeout: 5s
      retries: 5
```

with:

```yaml
  mongo:
    image: mongo:7
    command: ["--replSet", "rs0", "--bind_ip_all"]
    volumes:
      - mongo-data:/data/db
    ports:
      - "27017:27017"
    healthcheck:
      # Healthy only once the replica set is initiated and a primary is elected.
      test: ["CMD", "mongosh", "--quiet", "--eval", "try { rs.status().ok } catch (e) { rs.initiate({_id:'rs0',members:[{_id:0,host:'mongo:27017'}]}).ok }"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 20s
```

The healthcheck is self-initiating: the first probe runs `rs.initiate()` (members host = `mongo:27017`, the in-network name the `api` service uses); subsequent probes just confirm `rs.status()`.

- [ ] **Step 2: Point the API at the replica set**

In `CostCalculator/docker-compose.yml`, change the `api` service `MONGO_URI` from:

```yaml
      MONGO_URI: mongodb://mongo:27017
```

to:

```yaml
      MONGO_URI: mongodb://mongo:27017/?replicaSet=rs0
```

- [ ] **Step 3: Recreate the mongo container and confirm the replica set**

Run:
```bash
cd CostCalculator && docker compose up -d mongo
# wait for the self-initiating healthcheck, then:
docker compose exec mongo mongosh --quiet --eval "rs.status().myState"
```
Expected: prints `1` (this node is PRIMARY). If it prints an error, wait ~20s for `start_period` and retry; the first healthcheck initiates the set.

- [ ] **Step 4: Confirm host-machine connections can use transactions**

The Go tests connect from the host via `mongodb://localhost:27017`. With a replica set whose only member advertises `mongo:27017`, host connections must use `directConnection=true` so the driver talks to localhost directly while still seeing a replica-set member (which is what enables transactions).

Run a quick check:
```bash
cd CostCalculator && docker compose exec mongo mongosh --quiet "mongodb://localhost:27017/?directConnection=true" --eval "db.getMongo().startSession(); print('sessions ok')"
```
Expected: prints `sessions ok` with no error.

- [ ] **Step 5: Commit**

```bash
git add CostCalculator/docker-compose.yml
git commit -m "feat(infra): run MongoDB as single-node replica set rs0 for transactions"
```

> **Note for running the Go tests after this task:** use `MONGO_URI='mongodb://localhost:27017/?directConnection=true'`. The repo `Connect` already passes the URI straight to the driver, so no code change is needed for the test connection — only the env var.

---

### Task 2: `WithTransaction` helper + atomic period close

**Files:**
- Modify: `CostCalculator/backend/internal/repo/mongo.go`
- Modify: `CostCalculator/backend/internal/service/periods.go`
- Test: `CostCalculator/backend/internal/repo/transaction_test.go`

- [ ] **Step 1: Write the failing rollback test**

Create `CostCalculator/backend/internal/repo/transaction_test.go`:

```go
package repo

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/bson"
)

func transactionsURI() string {
	if v := os.Getenv("MONGO_URI"); v != "" {
		return v
	}
	return "mongodb://localhost:27017/?directConnection=true"
}

// A transaction that returns an error must persist none of its writes.
func TestWithTransactionRollsBackOnError(t *testing.T) {
	dbName := fmt.Sprintf("costcalc_tx_test_%d", time.Now().UnixNano())
	db, err := Connect(context.Background(), transactionsURI(), dbName)
	if err != nil {
		t.Skipf("mongo not available: %v", err)
	}
	defer db.Client.Database(dbName).Drop(context.Background())

	boom := errors.New("boom")
	err = db.WithTransaction(context.Background(), func(txCtx context.Context) error {
		if _, e := db.Accounts.InsertOne(txCtx, bson.M{"_id": "a1", "userId": "u1", "name": "X"}); e != nil {
			return e
		}
		return boom // force rollback
	})
	if !errors.Is(err, boom) {
		t.Skipf("transactions unsupported on this deployment (need a replica set): %v", err)
	}

	n, err := db.Accounts.CountDocuments(context.Background(), bson.M{"_id": "a1"})
	if err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("rollback failed: found %d docs, want 0", n)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd CostCalculator/backend && MONGO_URI='mongodb://localhost:27017/?directConnection=true' go test ./internal/repo/ -run TestWithTransactionRollsBackOnError -v`
Expected: FAIL — `db.WithTransaction` undefined.

- [ ] **Step 3: Add the `WithTransaction` helper**

In `CostCalculator/backend/internal/repo/mongo.go`, add at the end of the file:

```go
// WithTransaction runs fn inside a MongoDB transaction, passing a session-bound
// context that fn must use for all DB operations so they join the transaction.
// Requires the deployment to be a replica set.
func (db *DB) WithTransaction(ctx context.Context, fn func(ctx context.Context) error) error {
	session, err := db.Client.StartSession()
	if err != nil {
		return err
	}
	defer session.EndSession(ctx)
	_, err = session.WithTransaction(ctx, func(sc mongo.SessionContext) (interface{}, error) {
		return nil, fn(sc)
	})
	return err
}
```

(`mongo` is already imported in `mongo.go`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd CostCalculator/backend && MONGO_URI='mongodb://localhost:27017/?directConnection=true' go test ./internal/repo/ -run TestWithTransactionRollsBackOnError -v`
Expected: PASS

- [ ] **Step 5: Make `Periods.Close` atomic**

In `CostCalculator/backend/internal/service/periods.go`, replace the `Close` method:

```go
// Close marks a period closed and pushes its closing balances into the
// opening balances of every downstream period (chain recompute).
func (p *Periods) Close(ctx context.Context, userID, periodID string) error {
	period, err := repo.ByID[domain.Period](ctx, p.DB.Periods, userID, periodID)
	if err != nil {
		return err
	}
	if period == nil {
		return ErrPeriodNotFound
	}
	return p.DB.WithTransaction(ctx, func(txCtx context.Context) error {
		if _, err := repo.UpdateByID(txCtx, p.DB.Periods, userID, periodID, bson.M{"status": domain.PeriodClosed}); err != nil {
			return err
		}
		period.Status = domain.PeriodClosed
		return p.recomputeDownstream(txCtx, period)
	})
}
```

(`recomputeDownstream` already takes a `ctx` and uses it for every read/write, so passing `txCtx` enrolls the whole cascade in the transaction. No other change needed there.)

- [ ] **Step 6: Run the full http + service suites (close path is exercised by TestAPIFlow)**

Run: `cd CostCalculator/backend && MONGO_URI='mongodb://localhost:27017/?directConnection=true' go test ./internal/http/ ./internal/service/ -v`
Expected: PASS — `TestAPIFlow` closes a period and continues to succeed, now via a transaction.

- [ ] **Step 7: Commit**

```bash
git add CostCalculator/backend/internal/repo/mongo.go CostCalculator/backend/internal/repo/transaction_test.go CostCalculator/backend/internal/service/periods.go
git commit -m "feat(periods): atomic period close via MongoDB transaction"
```

---

### Task 3: Atomic new-user seed

**Files:**
- Modify: `CostCalculator/backend/internal/service/refdata.go`

- [ ] **Step 1: Wrap `SeedDefaults` in a transaction**

In `CostCalculator/backend/internal/service/refdata.go`, change the function so all inserts run in one transaction. Replace the signature line and the two insert loops' surrounding structure by wrapping the existing body:

Change the opening of the function from:

```go
func SeedDefaults(ctx context.Context, db *repo.DB, userID string) error {
	subs := func(names ...string) []domain.Subcategory {
```

to:

```go
func SeedDefaults(ctx context.Context, db *repo.DB, userID string) error {
	return db.WithTransaction(ctx, func(txCtx context.Context) error {
		return seedDefaults(txCtx, db, userID)
	})
}

func seedDefaults(ctx context.Context, db *repo.DB, userID string) error {
	subs := func(names ...string) []domain.Subcategory {
```

The rest of the original function body (the `categories`/`accounts` slices and the two insert loops using `ctx`) now lives in `seedDefaults` unchanged — its `ctx` is the transaction context, so both insert loops commit atomically. Confirm the function still ends with `return nil`.

- [ ] **Step 2: Verify register-with-seed still works**

Run: `cd CostCalculator/backend && MONGO_URI='mongodb://localhost:27017/?directConnection=true' go test ./internal/http/ -run TestAPIFlow -v`
Expected: PASS — register seeds 8 categories + accounts (asserted in the test) atomically.

- [ ] **Step 3: Build + vet**

Run: `cd CostCalculator/backend && go build ./... && go vet ./...`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add CostCalculator/backend/internal/service/refdata.go
git commit -m "feat(seed): atomic default category/account seeding via transaction"
```

---

## Final verification

- [ ] **Full suite against the replica set**

Run: `cd CostCalculator/backend && MONGO_URI='mongodb://localhost:27017/?directConnection=true' go test ./... && go build ./... && go vet ./...`
Expected: PASS / clean (transaction tests run; they skip only if the deployment isn't a replica set).

- [ ] **CI / dev docs note:** update any test-run instructions to use `MONGO_URI='mongodb://localhost:27017/?directConnection=true'` so transactions are available locally.

---

## Self-review (spec coverage)

| Phase 2 spec item | Covered by |
|---|---|
| #9 real transactions (replica set) | Tasks 1–3 |

**Decision recorded:** single-node replica set (not a full 3-node set) — gives transaction support with minimal infra for this app's scale. `directConnection=true` is required for host-machine/test connections; the in-cluster `api` uses `?replicaSet=rs0`. The idempotent `Repair` endpoint (Phase 1) is intentionally left non-transactional — it self-heals on re-run, so atomicity adds little there.
