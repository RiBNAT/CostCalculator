package domain

import (
	"errors"
	"fmt"
	"strings"
)

// ParseAmountExpr parses an additive amount expression in taka, e.g. "360+20+330+30"
// or "15.5", and returns the total in paisa plus each signed term in paisa.
// Only + and - operators and decimals with at most two fractional digits are allowed.
func ParseAmountExpr(s string) (int64, []int64, error) {
	s = strings.ReplaceAll(s, " ", "")
	if s == "" {
		return 0, nil, errors.New("empty amount")
	}
	var parts []int64
	var total int64
	sign := int64(1)
	num := strings.Builder{}

	flush := func() error {
		if num.Len() == 0 {
			return errors.New("missing number in expression")
		}
		p, err := parseTakaLiteral(num.String())
		if err != nil {
			return err
		}
		parts = append(parts, sign*p)
		total += sign * p
		num.Reset()
		return nil
	}

	for i, r := range s {
		switch {
		case r >= '0' && r <= '9' || r == '.':
			num.WriteRune(r)
		case r == '+' || r == '-':
			if i == 0 || (num.Len() == 0 && len(parts) == 0) {
				// leading sign
				if r == '-' {
					sign = -1
				}
				continue
			}
			if err := flush(); err != nil {
				return 0, nil, err
			}
			sign = 1
			if r == '-' {
				sign = -1
			}
		default:
			return 0, nil, fmt.Errorf("invalid character %q in amount", r)
		}
	}
	if err := flush(); err != nil {
		return 0, nil, err
	}
	return total, parts, nil
}

// parseTakaLiteral converts "15.5" -> 1550 paisa. At most 2 decimal places.
func parseTakaLiteral(s string) (int64, error) {
	whole, frac := s, ""
	if dot := strings.IndexByte(s, '.'); dot >= 0 {
		whole, frac = s[:dot], s[dot+1:]
		if strings.IndexByte(frac, '.') >= 0 {
			return 0, fmt.Errorf("invalid number %q", s)
		}
	}
	if whole == "" && frac == "" {
		return 0, fmt.Errorf("invalid number %q", s)
	}
	if len(frac) > 2 {
		return 0, fmt.Errorf("at most 2 decimal places allowed in %q", s)
	}
	for len(frac) < 2 {
		frac += "0"
	}
	var v int64
	for _, r := range whole + frac {
		if r < '0' || r > '9' {
			return 0, fmt.Errorf("invalid number %q", s)
		}
		v = v*10 + int64(r-'0')
	}
	return v, nil
}

// FormatTaka renders paisa as a taka string with two decimals, e.g. 74000 -> "740.00".
func FormatTaka(paisa int64) string {
	neg := ""
	if paisa < 0 {
		neg = "-"
		paisa = -paisa
	}
	return fmt.Sprintf("%s%d.%02d", neg, paisa/100, paisa%100)
}

// TakaToPaisa converts a decimal taka value to paisa, rounding half away from zero.
func TakaToPaisa(taka float64) int64 {
	if taka >= 0 {
		return int64(taka*100 + 0.5)
	}
	return -int64(-taka*100 + 0.5)
}
