package service

import (
	"context"

	"google.golang.org/api/idtoken"
)

// googleVerifier validates Google ID tokens against Google's public keys,
// checking signature, expiry, issuer, and that the audience matches our client id.
type googleVerifier struct{ clientID string }

// NewGoogleVerifier returns a GoogleVerifier, or nil when no client id is
// configured (Google sign-in disabled).
func NewGoogleVerifier(clientID string) GoogleVerifier {
	if clientID == "" {
		return nil
	}
	return &googleVerifier{clientID: clientID}
}

func (g *googleVerifier) Verify(ctx context.Context, idToken string) (*GoogleClaims, error) {
	payload, err := idtoken.Validate(ctx, idToken, g.clientID)
	if err != nil {
		return nil, err
	}
	c := &GoogleClaims{Sub: payload.Subject}
	if v, ok := payload.Claims["email"].(string); ok {
		c.Email = v
	}
	if v, ok := payload.Claims["name"].(string); ok {
		c.Name = v
	}
	if v, ok := payload.Claims["email_verified"].(bool); ok {
		c.EmailVerified = v
	}
	return c, nil
}
