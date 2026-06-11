import { parseAmountExpr, formatTaka } from './amount-expr';

describe('parseAmountExpr', () => {
  it('parses a single integer', () => {
    expect(parseAmountExpr('740')).toEqual({ total: 74000, parts: [74000] });
  });

  it('parses excel-style sums', () => {
    expect(parseAmountExpr('360+20+330+30')).toEqual({
      total: 74000,
      parts: [36000, 2000, 33000, 3000],
    });
  });

  it('parses decimals up to 2 places', () => {
    expect(parseAmountExpr('15.5')).toEqual({ total: 1550, parts: [1550] });
    expect(parseAmountExpr('10.25')).toEqual({ total: 1025, parts: [1025] });
  });

  it('handles subtraction and leading negatives', () => {
    expect(parseAmountExpr('100-25')).toEqual({ total: 7500, parts: [10000, -2500] });
    expect(parseAmountExpr('-50+100')).toEqual({ total: 5000, parts: [-5000, 10000] });
  });

  it('tolerates spaces', () => {
    expect(parseAmountExpr(' 360 + 20 ')).toEqual({ total: 38000, parts: [36000, 2000] });
  });

  it('rejects invalid input', () => {
    expect(parseAmountExpr('')).toBeNull();
    expect(parseAmountExpr('abc')).toBeNull();
    expect(parseAmountExpr('3*4')).toBeNull();
    expect(parseAmountExpr('1.234')).toBeNull();
    expect(parseAmountExpr('10+')).toBeNull();
  });
});

describe('formatTaka', () => {
  it('formats whole taka without decimals, lakh-grouped', () => {
    expect(formatTaka(74000)).toBe('740');
    expect(formatTaka(16500000)).toBe('1,65,000');
  });
  it('keeps two decimals for fractional taka', () => {
    expect(formatTaka(1550)).toBe('15.50');
  });
});
