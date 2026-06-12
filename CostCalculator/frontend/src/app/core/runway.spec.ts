import { daysLeftInclusive, safeToSpendPerDay } from './runway';

describe('runway helpers', () => {
  describe('daysLeftInclusive', () => {
    const mk = (s: string) => new Date(s + 'T00:00:00Z');

    it('counts today through end inclusive when today is inside the period', () => {
      // 13 June through 30 June inclusive = 18 days
      expect(daysLeftInclusive(mk('2026-06-01'), mk('2026-06-30'), mk('2026-06-13'))).toBe(18);
    });

    it('counts the whole period when today is before it starts', () => {
      expect(daysLeftInclusive(mk('2026-07-01'), mk('2026-07-30'), mk('2026-06-13'))).toBe(30);
    });

    it('returns 0 when the period has already ended', () => {
      expect(daysLeftInclusive(mk('2026-05-01'), mk('2026-05-31'), mk('2026-06-13'))).toBe(0);
    });

    it('returns 1 on the last day', () => {
      expect(daysLeftInclusive(mk('2026-06-01'), mk('2026-06-30'), mk('2026-06-30'))).toBe(1);
    });
  });

  describe('safeToSpendPerDay', () => {
    it('divides remaining by days left, floored to whole paisa', () => {
      expect(safeToSpendPerDay(180000, 18)).toBe(10000); // ৳1800 over 18 days = ৳100/day
    });
    it('is 0 when nothing remains', () => {
      expect(safeToSpendPerDay(-500, 10)).toBe(0);
    });
    it('is 0 when no days remain', () => {
      expect(safeToSpendPerDay(180000, 0)).toBe(0);
    });
  });
});
