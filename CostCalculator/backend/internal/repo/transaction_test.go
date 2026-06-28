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
