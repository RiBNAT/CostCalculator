import { Pipe, PipeTransform } from '@angular/core';
import { formatTaka } from './amount-expr';

/** Renders paisa as a BDT amount: 7400000 -> "৳74,000". */
@Pipe({ name: 'money', standalone: true })
export class MoneyPipe implements PipeTransform {
  transform(paisa: number | null | undefined, withSign = false): string {
    if (paisa == null) return '—';
    const sign = withSign && paisa > 0 ? '+' : '';
    return `${sign}${paisa < 0 ? '-' : ''}৳${formatTaka(Math.abs(paisa))}`;
  }
}
