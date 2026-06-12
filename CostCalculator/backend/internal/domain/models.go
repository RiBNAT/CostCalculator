package domain

import "time"

// All monetary amounts are int64 paisa (1 taka = 100 paisa).

type User struct {
	ID           string    `bson:"_id,omitempty" json:"id"`
	Name         string    `bson:"name" json:"name"`
	Email        string    `bson:"email" json:"email"`
	Phone        string    `bson:"phone,omitempty" json:"phone,omitempty"`
	PasswordHash string    `bson:"passwordHash,omitempty" json:"-"`
	GoogleID     string    `bson:"googleId,omitempty" json:"-"`
	CreatedAt    time.Time `bson:"createdAt" json:"createdAt"`
}

type Subcategory struct {
	Name   string `bson:"name" json:"name"`
	Active bool   `bson:"active" json:"active"`
}

type CategoryKind string

const (
	CategoryExpense CategoryKind = "expense"
	CategorySavings CategoryKind = "savings"
	CategoryPay     CategoryKind = "pay"
)

type Category struct {
	ID            string        `bson:"_id,omitempty" json:"id"`
	UserID        string        `bson:"userId" json:"-"`
	Name          string        `bson:"name" json:"name"`
	Kind          CategoryKind  `bson:"kind" json:"kind"`
	Subcategories []Subcategory `bson:"subcategories" json:"subcategories"`
	Active        bool          `bson:"active" json:"active"`
}

type AccountKind string

const (
	AccountBank    AccountKind = "bank"
	AccountMobile  AccountKind = "mobile"
	AccountCash    AccountKind = "cash"
	AccountSavings AccountKind = "savings"
	AccountVirtual AccountKind = "virtual"
)

type VirtualRole string

const (
	RoleExternal  VirtualRole = "external" // "Add" — money entering the system
	RoleLendGiven VirtualRole = "lendGiven"
	RoleLendTaken VirtualRole = "lendTaken"
)

type Account struct {
	ID          string      `bson:"_id,omitempty" json:"id"`
	UserID      string      `bson:"userId" json:"-"`
	Name        string      `bson:"name" json:"name"`
	Kind        AccountKind `bson:"kind" json:"kind"`
	VirtualRole VirtualRole `bson:"virtualRole,omitempty" json:"virtualRole,omitempty"`
	Active      bool        `bson:"active" json:"active"`
	Goal        int64       `bson:"goal,omitempty" json:"goal,omitempty"` // savings target in paisa, 0 = none
}

// Liquid reports whether the account counts toward the in-hand total.
func (a Account) Liquid() bool {
	return a.Kind == AccountBank || a.Kind == AccountMobile || a.Kind == AccountCash
}

type AccountAmount struct {
	AccountID string `bson:"accountId" json:"accountId"`
	Amount    int64  `bson:"amount" json:"amount"`
}

type PeriodStatus string

const (
	PeriodOpen   PeriodStatus = "open"
	PeriodClosed PeriodStatus = "closed"
)

type Period struct {
	ID               string          `bson:"_id,omitempty" json:"id"`
	UserID           string          `bson:"userId" json:"-"`
	Name             string          `bson:"name" json:"name"`
	StartDate        time.Time       `bson:"startDate" json:"startDate"`
	EndDate          time.Time       `bson:"endDate" json:"endDate"`
	Status           PeriodStatus    `bson:"status" json:"status"`
	OpeningBalances  []AccountAmount `bson:"openingBalances" json:"openingBalances"`
	OpeningSavings   []AccountAmount `bson:"openingSavings" json:"openingSavings"`
	PreviousPeriodID string          `bson:"previousPeriodId,omitempty" json:"previousPeriodId,omitempty"`
}

type Expense struct {
	ID          string    `bson:"_id,omitempty" json:"id"`
	UserID      string    `bson:"userId" json:"-"`
	PeriodID    string    `bson:"periodId" json:"periodId"`
	Date        time.Time `bson:"date" json:"date"`
	CategoryID  string    `bson:"categoryId" json:"categoryId"`
	Subcategory string    `bson:"subcategory" json:"subcategory"`
	AccountID   string    `bson:"accountId" json:"accountId"` // payment method
	Amount      int64     `bson:"amount" json:"amount"`
	Breakdown   []int64   `bson:"breakdown,omitempty" json:"breakdown,omitempty"`
	Remarks     string    `bson:"remarks,omitempty" json:"remarks,omitempty"`
}

type Transfer struct {
	ID            string    `bson:"_id,omitempty" json:"id"`
	UserID        string    `bson:"userId" json:"-"`
	PeriodID      string    `bson:"periodId" json:"periodId"`
	Date          time.Time `bson:"date" json:"date"`
	FromAccountID string    `bson:"fromAccountId" json:"fromAccountId"`
	ToAccountID   string    `bson:"toAccountId" json:"toAccountId"`
	Amount        int64     `bson:"amount" json:"amount"`
	Fee           int64     `bson:"fee" json:"fee"`
	Note          string    `bson:"note,omitempty" json:"note,omitempty"`
}

type BudgetItem struct {
	CategoryID  string `bson:"categoryId" json:"categoryId"`
	Subcategory string `bson:"subcategory" json:"subcategory"`
	Amount      int64  `bson:"amount" json:"amount"`
}

type Budget struct {
	ID       string       `bson:"_id,omitempty" json:"id"`
	UserID   string       `bson:"userId" json:"-"`
	PeriodID string       `bson:"periodId" json:"periodId"`
	Items    []BudgetItem `bson:"items" json:"items"`
	Rollover bool         `bson:"rollover,omitempty" json:"rollover"` // carry previous period's unspent budget forward
}

type LendType string

const (
	LendGiven LendType = "given"
	LendTaken LendType = "taken"
)

type LendStatus string

const (
	LendOpen    LendStatus = "open"
	LendSettled LendStatus = "settled"
)

type Settlement struct {
	Date   time.Time `bson:"date" json:"date"`
	Amount int64     `bson:"amount" json:"amount"`
	Note   string    `bson:"note,omitempty" json:"note,omitempty"`
}

type Lend struct {
	ID          string       `bson:"_id,omitempty" json:"id"`
	UserID      string       `bson:"userId" json:"-"`
	Type        LendType     `bson:"type" json:"type"`
	Person      string       `bson:"person" json:"person"`
	Date        time.Time    `bson:"date" json:"date"`
	Amount      int64        `bson:"amount" json:"amount"`
	Settlements []Settlement `bson:"settlements" json:"settlements"`
	Status      LendStatus   `bson:"status" json:"status"`
	Notes       string       `bson:"notes,omitempty" json:"notes,omitempty"`
}

// Outstanding is the unsettled remainder of a lend.
func (l Lend) Outstanding() int64 {
	rem := l.Amount
	for _, s := range l.Settlements {
		rem -= s.Amount
	}
	return rem
}

type PaymentWindow struct {
	ID          string    `bson:"_id,omitempty" json:"id"`
	UserID      string    `bson:"userId" json:"-"`
	PeriodID    string    `bson:"periodId" json:"periodId"`
	Name        string    `bson:"name" json:"name"`
	CategoryID  string    `bson:"categoryId,omitempty" json:"categoryId,omitempty"`
	Subcategory string    `bson:"subcategory,omitempty" json:"subcategory,omitempty"`
	StartDate   time.Time `bson:"startDate" json:"startDate"`
	EndDate     time.Time `bson:"endDate" json:"endDate"`
}

type Reminder struct {
	ID     string    `bson:"_id,omitempty" json:"id"`
	UserID string    `bson:"userId" json:"-"`
	Date   time.Time `bson:"date" json:"date"`
	Task   string    `bson:"task" json:"task"`
	Done   bool      `bson:"done" json:"done"`
}

// RecurringExpense is a reusable expense template (rent, utilities, fees)
// the user can drop into any period with one tap.
type RecurringExpense struct {
	ID          string `bson:"_id,omitempty" json:"id"`
	UserID      string `bson:"userId" json:"-"`
	Label       string `bson:"label" json:"label"`
	CategoryID  string `bson:"categoryId" json:"categoryId"`
	Subcategory string `bson:"subcategory" json:"subcategory"`
	AccountID   string `bson:"accountId" json:"accountId"`
	Amount      int64  `bson:"amount" json:"amount"`
}
