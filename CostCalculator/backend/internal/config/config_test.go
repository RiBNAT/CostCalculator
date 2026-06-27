package config

import "testing"

func TestLoadRejectsInsecureSecretInRelease(t *testing.T) {
	t.Setenv("GIN_MODE", "release")
	t.Setenv("JWT_SECRET", "change-me-in-production")
	t.Setenv("MONGO_URI", "mongodb+srv://example")
	if _, err := Load(); err == nil {
		t.Fatal("expected error for insecure JWT secret in release mode")
	}
}

func TestLoadAcceptsStrongSecretInRelease(t *testing.T) {
	t.Setenv("GIN_MODE", "release")
	t.Setenv("JWT_SECRET", "a-long-random-production-secret")
	t.Setenv("MONGO_URI", "mongodb+srv://example")
	t.Setenv("CORS_ORIGIN", "https://app.example.com")
	if _, err := Load(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestLoadDevModeUsesDefaults(t *testing.T) {
	t.Setenv("GIN_MODE", "")
	t.Setenv("JWT_SECRET", "")
	if _, err := Load(); err != nil {
		t.Fatalf("dev mode should not error: %v", err)
	}
}
