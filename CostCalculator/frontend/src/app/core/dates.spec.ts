import { FormControl } from '@angular/forms';
import { defaultEntryDate, inPeriodValidator, todayISO } from './dates';

const period = { startDate: '2026-05-22T00:00:00Z', endDate: '2026-06-26T00:00:00Z' };

describe('dates', () => {
  describe('defaultEntryDate', () => {
    it('returns today when inside the period', () => {
      const today = todayISO();
      const wide = { startDate: '2000-01-01', endDate: '2099-12-31' };
      expect(defaultEntryDate(wide)).toBe(today);
    });

    it('clamps to the period end when today is after it', () => {
      const past = { startDate: '2020-01-01', endDate: '2020-02-01' };
      expect(defaultEntryDate(past)).toBe('2020-02-01');
    });

    it('clamps to the period start when today is before it', () => {
      const future = { startDate: '2099-01-01', endDate: '2099-02-01' };
      expect(defaultEntryDate(future)).toBe('2099-01-01');
    });

    it('falls back to today without a period', () => {
      expect(defaultEntryDate(null)).toBe(todayISO());
    });
  });

  describe('inPeriodValidator', () => {
    it('accepts boundary and interior dates, rejects outside', () => {
      const v = inPeriodValidator(period);
      expect(v(new FormControl('2026-05-22'))).toBeNull();
      expect(v(new FormControl('2026-06-26'))).toBeNull();
      expect(v(new FormControl('2026-06-01'))).toBeNull();
      expect(v(new FormControl('2026-05-21'))).toEqual({ outsidePeriod: true });
      expect(v(new FormControl('2027-01-01'))).toEqual({ outsidePeriod: true });
    });

    it('passes when no period or no value', () => {
      expect(inPeriodValidator(null)(new FormControl('2027-01-01'))).toBeNull();
      expect(inPeriodValidator(period)(new FormControl(''))).toBeNull();
    });
  });
});
