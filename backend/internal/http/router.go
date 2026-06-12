package http

import (
	"github.com/gin-gonic/gin"

	"ribnat/backend/internal/config"
	"ribnat/backend/internal/importer"
	"ribnat/backend/internal/repo"
	"ribnat/backend/internal/service"
)

// NewRouter wires all handlers behind /api/v1.
func NewRouter(cfg config.Config, db *repo.DB) *gin.Engine {
	auth := service.NewAuth(mongoUsers{db}, cfg.JWTSecret)
	periods := &service.Periods{DB: db}
	summary := &service.Summary{DB: db, Periods: periods}

	ah := &authHandlers{auth: auth, db: db}
	rh := &refdataHandlers{db: db}
	ph := &periodHandlers{db: db, periods: periods, summary: summary}
	eh := &entryHandlers{db: db, periods: periods}
	bh := &budgetHandlers{db: db}
	lh := &lendHandlers{db: db}
	wh := &plannerHandlers{db: db}
	ioh := &ioHandlers{db: db, imp: &importer.Importer{DB: db, Periods: periods}}

	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery(), CORS(cfg.CORSOrigin))

	v1 := r.Group("/api/v1")
	v1.GET("/health", func(c *gin.Context) { c.JSON(200, gin.H{"status": "ok"}) })

	a := v1.Group("/auth")
	a.POST("/register", ah.register)
	a.POST("/login", ah.login)
	a.POST("/refresh", ah.refresh)

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
		p.POST("/periods", ph.create)
		p.PUT("/periods/:id", ph.update)
		p.POST("/periods/:id/close", ph.close)
		p.POST("/periods/:id/reopen", ph.reopen)
		p.GET("/periods/:id/status", ph.status)
		p.GET("/periods/:id/summary", ph.getSummary)
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

		p.POST("/import/excel", ioh.importExcel)
		p.GET("/template/excel", ioh.downloadTemplate)
	}
	return r
}
