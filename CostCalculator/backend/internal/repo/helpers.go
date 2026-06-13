package repo

import (
	"context"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// NewID returns a fresh hex document id.
func NewID() string { return primitive.NewObjectID().Hex() }

// FindAll decodes every document matching filter.
func FindAll[T any](ctx context.Context, c *mongo.Collection, filter bson.M, opts ...*options.FindOptions) ([]T, error) {
	cur, err := c.Find(ctx, filter, opts...)
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)
	out := []T{}
	if err := cur.All(ctx, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// FindOne decodes a single document or returns (nil, nil) when absent.
func FindOne[T any](ctx context.Context, c *mongo.Collection, filter bson.M) (*T, error) {
	var v T
	err := c.FindOne(ctx, filter).Decode(&v)
	if err == mongo.ErrNoDocuments {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &v, nil
}

// ByID fetches a user-scoped document by id.
func ByID[T any](ctx context.Context, c *mongo.Collection, userID, id string) (*T, error) {
	return FindOne[T](ctx, c, bson.M{"_id": id, "userId": userID})
}

// UpdateByID applies $set fields to a user-scoped document.
func UpdateByID(ctx context.Context, c *mongo.Collection, userID, id string, set bson.M) (bool, error) {
	res, err := c.UpdateOne(ctx, bson.M{"_id": id, "userId": userID}, bson.M{"$set": set})
	if err != nil {
		return false, err
	}
	return res.MatchedCount > 0, nil
}

// ReplaceByID replaces a user-scoped document.
func ReplaceByID(ctx context.Context, c *mongo.Collection, userID, id string, doc any) (bool, error) {
	res, err := c.ReplaceOne(ctx, bson.M{"_id": id, "userId": userID}, doc)
	if err != nil {
		return false, err
	}
	return res.MatchedCount > 0, nil
}

// DeleteByID removes a user-scoped document.
func DeleteByID(ctx context.Context, c *mongo.Collection, userID, id string) (bool, error) {
	res, err := c.DeleteOne(ctx, bson.M{"_id": id, "userId": userID})
	if err != nil {
		return false, err
	}
	return res.DeletedCount > 0, nil
}
