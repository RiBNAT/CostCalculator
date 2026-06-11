package config

import "os"

type Config struct {
	Port       string
	MongoURI   string
	MongoDB    string
	JWTSecret  string
	CORSOrigin string
}

func Load() Config {
	return Config{
		Port:       getenv("PORT", "8080"),
		MongoURI:   getenv("MONGO_URI", "mongodb://localhost:27017"),
		MongoDB:    getenv("MONGO_DB", "ribnat"),
		JWTSecret:  getenv("JWT_SECRET", "dev-secret-change-me"),
		CORSOrigin: getenv("CORS_ORIGIN", "http://localhost:4200"),
	}
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
