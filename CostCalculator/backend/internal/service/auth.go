package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"costcalculator/backend/internal/domain"
)

var (
	ErrEmailTaken            = errors.New("email already registered")
	ErrInvalidCredentials    = errors.New("invalid email or password")
	ErrInvalidToken          = errors.New("invalid token")
	ErrGoogleEmailUnverified = errors.New("google account email is not verified")
)

// UserStore is the persistence needed by Auth (satisfied by repo, faked in tests).
type UserStore interface {
	ByEmail(ctx context.Context, email string) (*domain.User, error)
	Insert(ctx context.Context, u *domain.User) error
	Update(ctx context.Context, u *domain.User) error
}

// GoogleClaims are the verified fields extracted from a Google ID token.
type GoogleClaims struct {
	Sub           string // Google's stable user id
	Email         string
	Name          string
	EmailVerified bool
}

// GoogleVerifier validates a Google ID token and returns its claims.
type GoogleVerifier interface {
	Verify(ctx context.Context, idToken string) (*GoogleClaims, error)
}

type Auth struct {
	Users      UserStore
	Secret     []byte
	AccessTTL  time.Duration
	RefreshTTL time.Duration
	Now        func() time.Time
	Google     GoogleVerifier // nil when Google sign-in is not configured
}

// LoginWithGoogle verifies a Google ID token, finds-or-creates the matching
// user (linking by verified email), and issues our JWT pair. The bool reports
// whether a new user was created.
func (a *Auth) LoginWithGoogle(ctx context.Context, idToken string) (*domain.User, *TokenPair, bool, error) {
	if a.Google == nil {
		return nil, nil, false, ErrInvalidToken
	}
	claims, err := a.Google.Verify(ctx, idToken)
	if err != nil {
		return nil, nil, false, ErrInvalidToken
	}
	if !claims.EmailVerified {
		return nil, nil, false, ErrGoogleEmailUnverified
	}
	email := strings.ToLower(strings.TrimSpace(claims.Email))

	existing, err := a.Users.ByEmail(ctx, email)
	if err != nil {
		return nil, nil, false, err
	}
	if existing != nil {
		// Link the Google id to the matched account if not already set.
		if existing.GoogleID != claims.Sub {
			existing.GoogleID = claims.Sub
			if err := a.Users.Update(ctx, existing); err != nil {
				return nil, nil, false, err
			}
		}
		pair, err := a.issue(existing)
		return existing, pair, false, err
	}

	u := &domain.User{Name: claims.Name, Email: email, GoogleID: claims.Sub, CreatedAt: a.Now().UTC()}
	if err := a.Users.Insert(ctx, u); err != nil {
		return nil, nil, false, err
	}
	pair, err := a.issue(u)
	return u, pair, true, err
}

func NewAuth(users UserStore, secret string) *Auth {
	return &Auth{
		Users:      users,
		Secret:     []byte(secret),
		AccessTTL:  15 * time.Minute,
		RefreshTTL: 7 * 24 * time.Hour,
		Now:        time.Now,
	}
}

type TokenPair struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
}

func (a *Auth) Register(ctx context.Context, name, email, password string) (*domain.User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if existing, err := a.Users.ByEmail(ctx, email); err != nil {
		return nil, err
	} else if existing != nil {
		return nil, ErrEmailTaken
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return nil, err
	}
	u := &domain.User{Name: name, Email: email, PasswordHash: string(hash), CreatedAt: a.Now().UTC()}
	if err := a.Users.Insert(ctx, u); err != nil {
		return nil, err
	}
	return u, nil
}

func (a *Auth) Login(ctx context.Context, email, password string) (*domain.User, *TokenPair, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	u, err := a.Users.ByEmail(ctx, email)
	if err != nil {
		return nil, nil, err
	}
	if u == nil || bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)) != nil {
		return nil, nil, ErrInvalidCredentials
	}
	pair, err := a.issue(u)
	return u, pair, err
}

// Refresh validates a refresh token and issues a new pair.
func (a *Auth) Refresh(ctx context.Context, refreshToken string) (*TokenPair, error) {
	claims, err := a.parse(refreshToken)
	if err != nil || claims["typ"] != "refresh" {
		return nil, ErrInvalidToken
	}
	sub, _ := claims["sub"].(string)
	email, _ := claims["email"].(string)
	if sub == "" {
		return nil, ErrInvalidToken
	}
	return a.issue(&domain.User{ID: sub, Email: email})
}

// Verify validates an access token and returns the user id.
func (a *Auth) Verify(token string) (string, error) {
	claims, err := a.parse(token)
	if err != nil || claims["typ"] == "refresh" {
		return "", ErrInvalidToken
	}
	sub, _ := claims["sub"].(string)
	if sub == "" {
		return "", ErrInvalidToken
	}
	return sub, nil
}

func (a *Auth) issue(u *domain.User) (*TokenPair, error) {
	now := a.Now()
	access, err := a.sign(jwt.MapClaims{
		"sub": u.ID, "email": u.Email, "iat": now.Unix(), "exp": now.Add(a.AccessTTL).Unix(),
	})
	if err != nil {
		return nil, err
	}
	refresh, err := a.sign(jwt.MapClaims{
		"sub": u.ID, "email": u.Email, "typ": "refresh", "iat": now.Unix(), "exp": now.Add(a.RefreshTTL).Unix(),
	})
	if err != nil {
		return nil, err
	}
	return &TokenPair{AccessToken: access, RefreshToken: refresh}, nil
}

func (a *Auth) sign(claims jwt.MapClaims) (string, error) {
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(a.Secret)
}

func (a *Auth) parse(token string) (jwt.MapClaims, error) {
	parsed, err := jwt.Parse(token, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrInvalidToken
		}
		return a.Secret, nil
	}, jwt.WithTimeFunc(func() time.Time { return a.Now() }))
	if err != nil || !parsed.Valid {
		return nil, ErrInvalidToken
	}
	claims, ok := parsed.Claims.(jwt.MapClaims)
	if !ok {
		return nil, ErrInvalidToken
	}
	return claims, nil
}
