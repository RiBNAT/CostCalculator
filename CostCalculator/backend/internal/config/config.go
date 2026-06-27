package config

import (
	"fmt"
	"log"
	"os"
	"strings"
)

type Config struct {
	Port           string
	MongoURI       string
	MongoDB        string
	JWTSecret      string
	CORSOrigin     string
	GoogleClientID string
}

// insecureSecrets are placeholder values that must never reach production.
var insecureSecrets = map[string]bool{
	"":                        true,
	"dev-secret-change-me":    true,
	"change-me-in-production": true,
}

func Load() (Config, error) {
	cfg := Config{
		Port:     getenv("PORT", "8080"),
		MongoURI: getenv("MONGO_URI", "mongodb://localhost:27017"),
		// legacy database name kept after the Cost Calculator rename so
		// existing data stays visible; override with MONGO_DB to change it
		MongoDB:        getenv("MONGO_DB", "ribnat"),
		JWTSecret:      getenv("JWT_SECRET", "dev-secret-change-me"),
		CORSOrigin:     getenv("CORS_ORIGIN", "http://localhost:4200"),
		GoogleClientID: os.Getenv("GOOGLE_CLIENT_ID"),
	}
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
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
