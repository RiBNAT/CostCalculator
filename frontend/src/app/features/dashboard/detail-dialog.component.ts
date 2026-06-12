import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { MoneyPipe } from '../../core/money.pipe';

export interface DetailRow {
  icon?: string;
  label: string;
  sub?: string;
  amount?: number; // paisa
  text?: string; // alternative to amount
  cls?: 'pos' | 'neg' | '';
}

export interface DetailDialogData {
  title: string;
  icon: string;
  subtitle?: string;
  rows: DetailRow[];
  total?: { label: string; amount: number };
  emptyHint?: string;
}

@Component({
  selector: 'app-detail-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, MoneyPipe],
  template: `
    <h2 mat-dialog-title><mat-icon>{{ data.icon }}</mat-icon> {{ data.title }}</h2>
    @if (data.subtitle) {
      <p class="subtitle">{{ data.subtitle }}</p>
    }
    <mat-dialog-content>
      @for (r of data.rows; track $index) {
        <div class="row">
          @if (r.icon) {
            <mat-icon class="row-icon">{{ r.icon }}</mat-icon>
          }
          <div class="row-main">
            <span class="label">{{ r.label }}</span>
            @if (r.sub) {
              <span class="sub">{{ r.sub }}</span>
            }
          </div>
          @if (r.amount !== undefined) {
            <span class="value" [class.pos]="r.cls === 'pos'" [class.neg]="r.cls === 'neg'">{{ r.amount | money }}</span>
          } @else if (r.text) {
            <span class="value text">{{ r.text }}</span>
          }
        </div>
      } @empty {
        <div class="empty-hint">{{ data.emptyHint ?? 'Nothing to show' }}</div>
      }
      @if (data.total) {
        <div class="row total-row">
          <div class="row-main"><span class="label">{{ data.total.label }}</span></div>
          <span class="value">{{ data.total.amount | money }}</span>
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      h2 { display: flex; align-items: center; gap: 10px; font-weight: 700; }
      h2 mat-icon { color: var(--primary); }
      .subtitle { margin: -8px 24px 0; color: var(--ink-soft); font-size: 13px; }
      mat-dialog-content { min-width: 380px; max-height: 60vh; }
      @media (max-width: 600px) { mat-dialog-content { min-width: 0; } }
      .row {
        display: flex; align-items: center; gap: 12px;
        padding: 10px 2px; border-bottom: 1px solid #f0f2f8;
      }
      .row:last-child { border-bottom: none; }
      .row-icon { color: var(--ink-soft); font-size: 20px; width: 20px; height: 20px; }
      .row-main { flex: 1; display: flex; flex-direction: column; gap: 1px; min-width: 0; }
      .label { font-size: 14px; font-weight: 600; }
      .sub { font-size: 12px; color: var(--ink-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .value { font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .value.text { color: var(--ink-soft); font-weight: 500; font-size: 13px; }
      .total-row { border-top: 2px solid #e7eaf3; margin-top: 6px; }
    `,
  ],
})
export class DetailDialogComponent {
  readonly data = inject<DetailDialogData>(MAT_DIALOG_DATA);
}
