package http

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
)

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

// Internal logs the full error server-side with the request id and returns a
// generic message to the client so internal details never leak.
func Internal(c *gin.Context, err error) {
	id := requestID(c)
	log.Printf("internal error [%s] %s %s: %v", id, c.Request.Method, c.Request.URL.Path, err)
	Err(c, 500, "internal", "internal server error (ref "+id+")")
}

// BindError writes a 400 with a human-readable message instead of the raw
// validator/json error text (e.g. "amount is required", not
// "Key: 'expenseReq.AmountExpr' Error:Field validation ...").
func BindError(c *gin.Context, err error) {
	BadRequest(c, bindMessage(err))
}

func bindMessage(err error) string {
	var verrs validator.ValidationErrors
	if errors.As(err, &verrs) {
		msgs := make([]string, 0, len(verrs))
		for _, fe := range verrs {
			msgs = append(msgs, fieldMessage(fe))
		}
		return strings.Join(msgs, "; ")
	}
	var jsonType *json.UnmarshalTypeError
	if errors.As(err, &jsonType) {
		return fmt.Sprintf("%s has the wrong type", humanField(jsonType.Field))
	}
	var jsonSyntax *json.SyntaxError
	if errors.As(err, &jsonSyntax) {
		return "request body is not valid JSON"
	}
	return "invalid request body"
}

func fieldMessage(fe validator.FieldError) string {
	name := humanField(fe.Field())
	switch fe.Tag() {
	case "required":
		return name + " is required"
	case "email":
		return name + " must be a valid email address"
	case "min":
		return fmt.Sprintf("%s must be at least %s characters", name, fe.Param())
	case "max":
		return fmt.Sprintf("%s must be at most %s characters", name, fe.Param())
	default:
		return name + " is invalid"
	}
}

// humanField turns a struct field name like "AmountExpr" into "amount expr".
func humanField(s string) string {
	if s == "" {
		return "field"
	}
	var b strings.Builder
	for i, r := range s {
		if r >= 'A' && r <= 'Z' {
			if i > 0 {
				b.WriteByte(' ')
			}
			b.WriteRune(r - 'A' + 'a')
		} else {
			b.WriteRune(r)
		}
	}
	return b.String()
}
