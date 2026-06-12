import { MoneyPipe } from './money.pipe';

describe('MoneyPipe', () => {
  const pipe = new MoneyPipe();

  it('formats positive paisa as taka with ৳', () => {
    expect(pipe.transform(74000)).toBe('৳740');
  });

  it('uses lakh grouping', () => {
    expect(pipe.transform(16500000)).toBe('৳1,65,000');
  });

  it('keeps decimals for fractional taka', () => {
    expect(pipe.transform(1550)).toBe('৳15.50');
  });

  it('handles negatives', () => {
    expect(pipe.transform(-74000)).toBe('-৳740');
  });

  it('adds a plus sign when requested', () => {
    expect(pipe.transform(5000, true)).toBe('+৳50');
    expect(pipe.transform(-5000, true)).toBe('-৳50');
  });

  it('renders em dash for null/undefined', () => {
    expect(pipe.transform(null)).toBe('—');
    expect(pipe.transform(undefined)).toBe('—');
  });
});
