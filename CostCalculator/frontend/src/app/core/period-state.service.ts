import { Injectable, signal } from '@angular/core';
import { ApiService } from './api.service';
import { Period } from './models';

const SELECTED_KEY = 'ribnat.selectedPeriod';

/** Holds the period list and the globally selected period. */
@Injectable({ providedIn: 'root' })
export class PeriodStateService {
  readonly periods = signal<Period[]>([]);
  readonly selected = signal<Period | null>(null);

  constructor(private api: ApiService) {}

  load(): void {
    this.api.listPeriods().subscribe((ps) => {
      this.periods.set(ps);
      const savedId = localStorage.getItem(SELECTED_KEY);
      const found = ps.find((p) => p.id === savedId) ?? ps[0] ?? null;
      this.selected.set(found);
    });
  }

  select(p: Period): void {
    this.selected.set(p);
    localStorage.setItem(SELECTED_KEY, p.id);
  }

  refreshSelected(): void {
    const cur = this.selected();
    this.api.listPeriods().subscribe((ps) => {
      this.periods.set(ps);
      this.selected.set(ps.find((p) => p.id === cur?.id) ?? ps[0] ?? null);
    });
  }
}
