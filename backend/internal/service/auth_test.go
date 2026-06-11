package service

import (
	"context"
	"testing"
	"time"

	"ribnat/backend/internal/domain"
)

type fakeUsers struct{ byEmail map[string]*domain.User }

func (f *fakeUsers) ByEmail(_ context.Context, email string) (*domain.User, error) {
	return f.byEmail[email], nil
}
func (f *fakeUsers) Insert(_ context.Context, u *domain.User) error {
	u.ID = "u1"
	f.byEmail[u.Email] = u
	return nil
}

func newTestAuth() (*Auth, *fakeUsers) {
	users := &fakeUsers{byEmail: map[string]*domain.User{}}
	a := NewAuth(users, "test-secret")
	return a, users
}

func TestRegisterHashesAndRejectsDuplicate(t *testing.T) {
	a, _ := newTestAuth()
	ctx := context.Background()
	u, err := a.Register(ctx, "Tanbir", "T@Example.com", "secret123")
	if err != nil {
		t.Fatal(err)
	}
	if u.Email != "t@example.com" {
		t.Errorf("email not normalized: %q", u.Email)
	}
	if u.PasswordHash == "secret123" || u.PasswordHash == "" {
		t.Error("password not hashed")
	}
	if _, err := a.Register(ctx, "Dup", "t@example.com", "x"); err != ErrEmailTaken {
		t.Errorf("expected ErrEmailTaken, got %v", err)
	}
}

func TestLoginAndVerify(t *testing.T) {
	a, _ := newTestAuth()
	ctx := context.Background()
	if _, err := a.Register(ctx, "T", "t@example.com", "secret123"); err != nil {
		t.Fatal(err)
	}
	_, pair, err := a.Login(ctx, "t@example.com", "secret123")
	if err != nil {
		t.Fatal(err)
	}
	uid, err := a.Verify(pair.AccessToken)
	if err != nil || uid != "u1" {
		t.Fatalf("Verify = %q, %v", uid, err)
	}
	// refresh token must not pass access verification
	if _, err := a.Verify(pair.RefreshToken); err == nil {
		t.Error("refresh token accepted as access token")
	}
	if _, _, err := a.Login(ctx, "t@example.com", "wrong"); err != ErrInvalidCredentials {
		t.Errorf("expected ErrInvalidCredentials, got %v", err)
	}
}

func TestRefreshRotatesAndExpires(t *testing.T) {
	a, _ := newTestAuth()
	ctx := context.Background()
	a.Register(ctx, "T", "t@example.com", "secret123")
	_, pair, _ := a.Login(ctx, "t@example.com", "secret123")

	newPair, err := a.Refresh(ctx, pair.RefreshToken)
	if err != nil || newPair.AccessToken == "" {
		t.Fatalf("refresh failed: %v", err)
	}
	// access token cannot be used to refresh
	if _, err := a.Refresh(ctx, pair.AccessToken); err == nil {
		t.Error("access token accepted for refresh")
	}
	// expired access token rejected
	a.Now = func() time.Time { return time.Now().Add(16 * time.Minute) }
	if _, err := a.Verify(pair.AccessToken); err == nil {
		t.Error("expired access token accepted")
	}
}
