package http

import (
	"time"

	"github.com/gin-gonic/gin"

	"costcalculator/backend/internal/config"
	"costcalculator/backend/internal/importer"
	"costcalculator/backend/internal/repo"
	"costcalculator/backend/internal/service"
)

// NewRouter wires all handlers behind /api/v1.
func NewRouter(cfg config.Config, db *repo.DB) *gin.Engine {
	auth := service.NewAuth(mongoUsers{db}, cfg.JWTSecret)
	auth.Google = service.NewGoogleVerifier(cfg.GoogleClientID)
	periods := &service.Periods{DB: db}
	summary := &service.Summary{DB: db, Periods: periods}

	ah := &authHandlers{auth: auth, db: db, googleClientID: cfg.GoogleClientID, cookieSecure: cfg.CookieSecure}
	rh := &refdataHandlers{db: db}
	ph := &periodHandlers{db: db, periods: periods, summary: summary}
	eh := &entryHandlers{db: db, periods: periods}
	bh := &budgetHandlers{db: db}
	lh := &lendHandlers{db: db}
	wh := &plannerHandlers{db: db}
	ioh := &ioHandlers{db: db, imp: &importer.Importer{DB: db, Periods: periods}}
	rch := &recurringHandlers{db: db}

	r := gin.New()
	r.Use(RequestID(), gin.Logger(), gin.Recovery(), CORS(cfg.CORSOrigin))

	v1 := r.Group("/api/v1")
	v1.GET("/health", func(c *gin.Context) { c.JSON(200, gin.H{"status": "ok"}) })

	// 10 attempts/min/IP on auth endpoints (login, register, refresh, google).
	a := v1.Group("/auth", RateLimit(10, time.Minute))
	a.GET("/config", ah.config)
	a.POST("/register", ah.register)
	a.POST("/login", ah.login)
	a.POST("/refresh", ah.refresh)
	a.POST("/google", ah.google)
	a.POST("/logout", ah.logout)

	mh := &meHandlers{db: db}

	p := v1.Group("", AuthRequired(auth))
	{
		p.GET("/me", mh.get)
		p.PUT("/me", mh.updateProfile)
		p.PUT("/me/email", mh.updateEmail)
		p.PUT("/me/password", mh.updatePassword)

		p.GET("/categories", rh.listCategories)
		p.POST("/categories", rh.createCategory)
		p.PUT("/categories/:id", rh.updateCategory)
		p.DELETE("/categories/:id", rh.deleteCategory)

		p.GET("/accounts", rh.listAccounts)
		p.POST("/accounts", rh.createAccount)
		p.PUT("/accounts/:id", rh.updateAccount)
		p.DELETE("/accounts/:id", rh.deleteAccount)

		p.GET("/periods", ph.list)
		p.GET("/savings/history", ph.savingsHistory)
		p.GET("/statement", ph.statement)
		p.POST("/periods", ph.create)
		p.PUT("/periods/:id", ph.update)
		p.POST("/periods/:id/close", ph.close)
		p.POST("/periods/:id/reopen", ph.reopen)
		p.POST("/periods/:id/repair", ph.repair)
		p.GET("/periods/:id/status", ph.status)
		p.GET("/periods/:id/summary", ph.getSummary)
		p.GET("/periods/:id/trends", ph.trends)
		p.GET("/periods/:id/export", ioh.exportCSV)

		p.GET("/periods/:id/expenses", eh.listExpenses)
		p.POST("/periods/:id/expenses", eh.createExpense)
		p.PUT("/periods/:id/expenses/:eid", eh.updateExpense)
		p.DELETE("/periods/:id/expenses/:eid", eh.deleteExpense)

		p.GET("/periods/:id/transfers", eh.listTransfers)
		p.POST("/periods/:id/transfers", eh.createTransfer)
		p.PUT("/periods/:id/transfers/:tid", eh.updateTransfer)
		p.DELETE("/periods/:id/transfers/:tid", eh.deleteTransfer)

		p.GET("/periods/:id/budget", bh.get)
		p.PUT("/periods/:id/budget", bh.put)
		p.POST("/periods/:id/budget/copy-previous", bh.copyPrevious)

		p.GET("/lends", lh.list)
		p.POST("/lends", lh.create)
		p.PUT("/lends/:id", lh.update)
		p.DELETE("/lends/:id", lh.delete)
		p.POST("/lends/:id/settle", lh.settle)

		p.GET("/payment-windows", wh.listWindows)
		p.POST("/payment-windows", wh.createWindow)
		p.PUT("/payment-windows/:id", wh.updateWindow)
		p.DELETE("/payment-windows/:id", wh.deleteWindow)

		p.GET("/reminders", wh.listReminders)
		p.POST("/reminders", wh.createReminder)
		p.PUT("/reminders/:id", wh.updateReminder)
		p.DELETE("/reminders/:id", wh.deleteReminder)

		p.GET("/recurring", rch.list)
		p.POST("/recurring", rch.create)
		p.PUT("/recurring/:id", rch.update)
		p.DELETE("/recurring/:id", rch.delete)

		p.POST("/import/excel", ioh.importExcel)
		p.GET("/template/excel", ioh.downloadTemplate)
	}
	return r
}
