package domain

import (
	"testing"
	"time"
)

func day(y int, m time.Month, d int) time.Time {
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// Mirrors the Excel DATESTATUS(): "Start in 6", "Expire in 8", "Expired", plus paid detection.
func TestWindowStatus(t *testing.T) {
	w := PaymentWindow{
		Name:        "ElectricBill_Swk",
		CategoryID:  "rent",
		Subcategory: "ElectricBill_Swk",
		StartDate:   day(2026, 6, 18),
		EndDate:     day(2026, 6, 23),
	}

	cases := []struct {
		name     string
		today    time.Time
		expenses []Expense
		state    WindowState
		days     int
	}{
		{"before start", day(2026, 6, 12), nil, WindowUpcoming, 6},
		{"active", day(2026, 6, 20), nil, WindowActive, 3},
		{"last day", day(2026, 6, 23), nil, WindowActive, 0},
		{"expired", day(2026, 6, 25), nil, WindowExpired, 2},
		{"paid inside window", day(2026, 6, 25),
			[]Expense{{Date: day(2026, 6, 19), CategoryID: "rent", Subcategory: "ElectricBill_Swk", Amount: 45100}},
			WindowPaid, 0},
		{"expense outside window does not pay", day(2026, 6, 20),
			[]Expense{{Date: day(2026, 6, 1), CategoryID: "rent", Subcategory: "ElectricBill_Swk", Amount: 45100}},
			WindowActive, 3},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			st := WindowStatus(w, c.expenses, c.today)
			if st.State != c.state {
				t.Errorf("state = %s, want %s", st.State, c.state)
			}
			if st.Days != c.days {
				t.Errorf("days = %d, want %d", st.Days, c.days)
			}
		})
	}
}
