package repo

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// DB bundles the typed collections of the application.
type DB struct {
	Client     *mongo.Client
	Users      *mongo.Collection
	Categories *mongo.Collection
	Accounts   *mongo.Collection
	Periods    *mongo.Collection
	Expenses   *mongo.Collection
	Transfers  *mongo.Collection
	Budgets    *mongo.Collection
	Lends      *mongo.Collection
	Windows    *mongo.Collection
	Reminders  *mongo.Collection
	Imports    *mongo.Collection
	Recurrings *mongo.Collection
}

func Connect(ctx context.Context, uri, dbName string) (*DB, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
	if err != nil {
		return nil, err
	}
	if err := client.Ping(ctx, nil); err != nil {
		return nil, err
	}
	d := client.Database(dbName)
	db := &DB{
		Client:     client,
		Users:      d.Collection("users"),
		Categories: d.Collection("categories"),
		Accounts:   d.Collection("accounts"),
		Periods:    d.Collection("periods"),
		Expenses:   d.Collection("expenses"),
		Transfers:  d.Collection("transfers"),
		Budgets:    d.Collection("budgets"),
		Lends:      d.Collection("lends"),
		Windows:    d.Collection("payment_windows"),
		Reminders:  d.Collection("reminders"),
		Imports:    d.Collection("imports"),
		Recurrings: d.Collection("recurrings"),
	}
	return db, db.ensureIndexes(ctx)
}

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

func (db *DB) ensureIndexes(ctx context.Context) error {
	unique := options.Index().SetUnique(true)
	_, err := db.Users.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{{Key: "email", Value: 1}}, Options: unique,
	})
	if err != nil {
		return err
	}
	for _, c := range []*mongo.Collection{db.Expenses, db.Transfers} {
		if _, err := c.Indexes().CreateOne(ctx, mongo.IndexModel{
			Keys: bson.D{{Key: "userId", Value: 1}, {Key: "periodId", Value: 1}, {Key: "date", Value: 1}},
		}); err != nil {
			return err
		}
	}
	for _, c := range []*mongo.Collection{db.Expenses, db.Transfers} {
		if _, err := c.Indexes().CreateOne(ctx, mongo.IndexModel{
			Keys: bson.D{{Key: "userId", Value: 1}, {Key: "date", Value: 1}},
		}); err != nil {
			return err
		}
	}
	for _, c := range []*mongo.Collection{db.Categories, db.Accounts, db.Periods} {
		if _, err := c.Indexes().CreateOne(ctx, mongo.IndexModel{
			Keys: bson.D{{Key: "userId", Value: 1}, {Key: "name", Value: 1}}, Options: unique,
		}); err != nil {
			return err
		}
	}
	_, err = db.Budgets.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{{Key: "userId", Value: 1}, {Key: "periodId", Value: 1}}, Options: unique,
	})
	return err
}
