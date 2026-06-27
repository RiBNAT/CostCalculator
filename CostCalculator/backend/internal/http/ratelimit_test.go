package http

import (
	"testing"
	"time"
)

func TestRateLimiterAllow(t *testing.T) {
	rl := newRateLimiter(2, time.Minute)
	now := time.Unix(1000, 0)

	if !rl.allow("1.2.3.4", now) {
		t.Fatal("request 1 should be allowed")
	}
	if !rl.allow("1.2.3.4", now) {
		t.Fatal("request 2 should be allowed")
	}
	if rl.allow("1.2.3.4", now) {
		t.Fatal("request 3 should be blocked (over limit)")
	}
	if !rl.allow("5.6.7.8", now) {
		t.Fatal("a different ip should have its own budget")
	}
	if !rl.allow("1.2.3.4", now.Add(time.Minute+time.Second)) {
		t.Fatal("after the window resets the ip should be allowed again")
	}
}
