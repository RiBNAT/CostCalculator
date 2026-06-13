package domain

import "time"

type WindowState string

const (
	WindowUpcoming WindowState = "upcoming"
	WindowActive   WindowState = "active"
	WindowExpired  WindowState = "expired"
	WindowPaid     WindowState = "paid"
)

// WindowStatusResult describes a payment window relative to today.
// Days means: upcoming → days until start; active → days left; expired → days since end.
type WindowStatusResult struct {
	State WindowState `json:"state"`
	Days  int         `json:"days"`
	Paid  int64       `json:"paidAmount"`
}

// WindowStatus replaces the Excel DATESTATUS() function and adds paid
// detection: an expense matching the linked category/subcategory dated within
// the window marks it paid.
func WindowStatus(w PaymentWindow, expenses []Expense, today time.Time) WindowStatusResult {
	today = truncateDay(today)
	start, end := truncateDay(w.StartDate), truncateDay(w.EndDate)

	var paid int64
	for _, e := range expenses {
		d := truncateDay(e.Date)
		match := (w.Subcategory == "" || e.Subcategory == w.Subcategory) &&
			(w.CategoryID == "" || e.CategoryID == w.CategoryID)
		if match && !d.Before(start) && !d.After(end) {
			paid += e.Amount
		}
	}
	if paid > 0 {
		return WindowStatusResult{State: WindowPaid, Days: 0, Paid: paid}
	}

	switch {
	case today.Before(start):
		return WindowStatusResult{State: WindowUpcoming, Days: daysBetween(today, start)}
	case !today.After(end):
		return WindowStatusResult{State: WindowActive, Days: daysBetween(today, end)}
	default:
		return WindowStatusResult{State: WindowExpired, Days: daysBetween(end, today)}
	}
}

func truncateDay(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

func daysBetween(a, b time.Time) int {
	return int(b.Sub(a).Hours() / 24)
}
