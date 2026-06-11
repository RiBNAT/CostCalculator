package http

import "github.com/gin-gonic/gin"

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Err writes the standard error envelope {error:{code,message}}.
func Err(c *gin.Context, status int, code, message string) {
	c.AbortWithStatusJSON(status, gin.H{"error": apiError{Code: code, Message: message}})
}

func BadRequest(c *gin.Context, message string) { Err(c, 400, "bad_request", message) }
func NotFound(c *gin.Context)                   { Err(c, 404, "not_found", "resource not found") }
func Internal(c *gin.Context, err error)        { Err(c, 500, "internal", err.Error()) }
