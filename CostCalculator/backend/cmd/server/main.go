package main

import (
	"context"
	"log"

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
	r := httpapi.NewRouter(cfg, db)
	log.Printf("cost-calculator api listening on :%s", cfg.Port)
	if err := r.Run(":" + cfg.Port); err != nil {
		log.Fatal(err)
	}
}
