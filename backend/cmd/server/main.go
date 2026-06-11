package main

import (
	"context"
	"log"

	"ribnat/backend/internal/config"
	httpapi "ribnat/backend/internal/http"
	"ribnat/backend/internal/repo"
)

func main() {
	cfg := config.Load()
	db, err := repo.Connect(context.Background(), cfg.MongoURI, cfg.MongoDB)
	if err != nil {
		log.Fatalf("mongo connect: %v", err)
	}
	r := httpapi.NewRouter(cfg, db)
	log.Printf("ribnat api listening on :%s", cfg.Port)
	if err := r.Run(":" + cfg.Port); err != nil {
		log.Fatal(err)
	}
}
