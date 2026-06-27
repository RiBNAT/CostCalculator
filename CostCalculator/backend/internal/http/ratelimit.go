package http

import (
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// rateLimiter is a fixed-window, per-key counter safe for concurrent use.
type rateLimiter struct {
	mu     sync.Mutex
	hits   map[string]*rlWindow
	limit  int
	window time.Duration
}

type rlWindow struct {
	count int
	reset time.Time
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{hits: map[string]*rlWindow{}, limit: limit, window: window}
}

// allow reports whether key may proceed at time now, counting this attempt.
func (rl *rateLimiter) allow(key string, now time.Time) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	w, ok := rl.hits[key]
	if !ok || now.After(w.reset) {
		rl.hits[key] = &rlWindow{count: 1, reset: now.Add(rl.window)}
		return true
	}
	if w.count >= rl.limit {
		return false
	}
	w.count++
	return true
}

// RateLimit limits each client IP to `limit` requests per `window`, returning
// 429 when exceeded. Intended for the auth group.
func RateLimit(limit int, window time.Duration) gin.HandlerFunc {
	rl := newRateLimiter(limit, window)
	return func(c *gin.Context) {
		if !rl.allow(c.ClientIP(), time.Now()) {
			Err(c, 429, "rate_limited", "too many requests, please slow down")
			return
		}
		c.Next()
	}
}
