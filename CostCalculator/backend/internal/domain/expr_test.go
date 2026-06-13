package domain

import "testing"

func TestParseAmountExpr(t *testing.T) {
	cases := []struct {
		name    string
		in      string
		total   int64
		parts   []int64
		wantErr bool
	}{
		{"single int", "740", 74000, []int64{74000}, false},
		{"excel style sum", "360+20+330+30", 74000, []int64{36000, 2000, 33000, 3000}, false},
		{"decimal", "15.5", 1550, []int64{1550}, false},
		{"two dp", "10.25", 1025, []int64{1025}, false},
		{"subtraction", "100-25", 7500, []int64{10000, -2500}, false},
		{"spaces", " 360 + 20 ", 38000, []int64{36000, 2000}, false},
		{"leading negative", "-50+100", 5000, []int64{-5000, 10000}, false},
		{"empty", "", 0, nil, true},
		{"letters", "abc", 0, nil, true},
		{"multiply rejected", "3*4", 0, nil, true},
		{"three dp rejected", "1.234", 0, nil, true},
		{"trailing op", "10+", 0, nil, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			total, parts, err := ParseAmountExpr(c.in)
			if c.wantErr {
				if err == nil {
					t.Fatalf("expected error, got total=%d", total)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if total != c.total {
				t.Errorf("total = %d, want %d", total, c.total)
			}
			if len(parts) != len(c.parts) {
				t.Fatalf("parts = %v, want %v", parts, c.parts)
			}
			for i := range parts {
				if parts[i] != c.parts[i] {
					t.Errorf("parts[%d] = %d, want %d", i, parts[i], c.parts[i])
				}
			}
		})
	}
}

func TestFormatTaka(t *testing.T) {
	if got := FormatTaka(74000); got != "740.00" {
		t.Errorf("FormatTaka(74000) = %q", got)
	}
	if got := FormatTaka(-1550); got != "-15.50" {
		t.Errorf("FormatTaka(-1550) = %q", got)
	}
}

func TestTakaToPaisa(t *testing.T) {
	if got := TakaToPaisa(15.505); got != 1551 {
		t.Errorf("TakaToPaisa(15.505) = %d, want 1551", got)
	}
	if got := TakaToPaisa(740); got != 74000 {
		t.Errorf("TakaToPaisa(740) = %d, want 74000", got)
	}
}
