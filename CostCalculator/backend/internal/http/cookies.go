package http

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

const (
	cookieAccess  = "rib_access"
	cookieRefresh = "rib_refresh"
	accessPath    = "/api/v1"
	refreshPath   = "/api/v1/auth/refresh"
)

// setAuthCookies writes the access and refresh tokens as HttpOnly cookies.
// accessMaxAge/refreshMaxAge are in seconds.
func setAuthCookies(c *gin.Context, access, refresh string, accessMaxAge, refreshMaxAge int, secure bool) {
	c.SetSameSite(http.SameSiteStrictMode)
	c.SetCookie(cookieAccess, access, accessMaxAge, accessPath, "", secure, true)
	c.SetCookie(cookieRefresh, refresh, refreshMaxAge, refreshPath, "", secure, true)
}

// clearAuthCookies expires both auth cookies.
func clearAuthCookies(c *gin.Context, secure bool) {
	c.SetSameSite(http.SameSiteStrictMode)
	c.SetCookie(cookieAccess, "", -1, accessPath, "", secure, true)
	c.SetCookie(cookieRefresh, "", -1, refreshPath, "", secure, true)
}
