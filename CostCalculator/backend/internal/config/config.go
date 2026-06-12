package config

import (
	"fmt"
	"os"
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
	if os.Getenv("GIN_MODE") == "release" && insecureSecrets[cfg.JWTSecret] {
		return cfg, fmt.Errorf("JWT_SECRET must be set to a strong value when GIN_MODE=release")
	}
	return cfg, nil
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
