import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** YYYY-MM-DD slice of an API date string. */
export function dayOf(date: string): string {
  return date.slice(0, 10);
}

/**
 * Default entry date for a period: today when it falls inside the range,
 * otherwise the period's end date (backfilling a past period) or start date.
 */
export function defaultEntryDate(p: { startDate: string; endDate: string } | null | undefined): string {
  const today = todayISO();
  if (!p) return today;
  const start = dayOf(p.startDate);
  const end = dayOf(p.endDate);
  if (today < start) return start;
  if (today > end) return end;
  return today;
}

/** Validates that a YYYY-MM-DD control value lies inside the period range. */
export function inPeriodValidator(p: { startDate: string; endDate: string } | null | undefined): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const v = control.value as string;
    if (!v || !p) return null;
    return v < dayOf(p.startDate) || v > dayOf(p.endDate) ? { outsidePeriod: true } : null;
  };
}
