import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { ApiService } from '../../core/api.service';
import { PeriodStateService } from '../../core/period-state.service';
import { ImportReport } from '../../core/models';

@Component({
  selector: 'app-import',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatProgressBarModule, MatSnackBarModule],
  template: `
    <div class="page">
      <h1 class="page-title">Import Excel</h1>
      <p class="page-subtitle">
        Upload your CostSheet workbook — periods, expenses, transfers, budgets and lends are imported from the
        mature-format sheets (June 25 onward). Re-uploading skips unchanged sheets.
      </p>

      <div
        class="card dropzone"
        [class.drag]="dragging()"
        (dragover)="$event.preventDefault(); dragging.set(true)"
        (dragleave)="dragging.set(false)"
        (drop)="onDrop($event)"
      >
        <mat-icon class="big-icon">upload_file</mat-icon>
        <p><strong>Drag & drop</strong> your .xlsx here, or</p>
        <button mat-flat-button color="primary" (click)="fileInput.click()" [disabled]="busy()">Choose file</button>
        <input #fileInput type="file" accept=".xlsx" hidden (change)="onPick($event)" />
        @if (busy()) {
          <mat-progress-bar mode="indeterminate" class="bar" />
        }
      </div>

      @if (report(); as rep) {
        <div class="card report">
          <h3>Import report</h3>
          <table class="data">
            <thead>
              <tr>
                <th>Sheet</th><th class="num">Expenses</th><th class="num">Transfers</th>
                <th class="num">Budget items</th><th class="num">Lends</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              @for (s of rep.sheets; track s.sheet) {
                <tr>
                  <td><strong>{{ s.sheet }}</strong></td>
                  <td class="num">{{ s.expenses }}</td>
                  <td class="num">{{ s.transfers }}</td>
                  <td class="num">{{ s.budgetItems }}</td>
                  <td class="num">{{ s.lends }}</td>
                  <td>
                    @if (s.skipped) {
                      <span class="chip closed">skipped</span>
                    } @else {
                      <span class="chip paid">imported</span>
                    }
                  </td>
                </tr>
                @if ((s.warnings ?? []).length) {
                  <tr class="warn-row">
                    <td colspan="6">
                      @for (w of s.warnings; track $index) {
                        <div class="warning"><mat-icon>warning_amber</mat-icon> {{ w }}</div>
                      }
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .dropzone {
        display: flex; flex-direction: column; align-items: center; gap: 8px;
        padding: 48px; text-align: center;
        border: 2px dashed #c3c9dd;
        transition: border-color 0.15s, background 0.15s;
      }
      .dropzone.drag { border-color: var(--primary); background: var(--primary-soft); }
      .big-icon { font-size: 48px; width: 48px; height: 48px; color: var(--primary); }
      .bar { width: 240px; margin-top: 16px; }
      .report { margin-top: 16px; }
      .report h3 { margin: 0 0 12px; font-size: 15px; font-weight: 700; }
      .warn-row td { background: #fff8e8; }
      .warning { display: flex; align-items: center; gap: 6px; color: #8a6d00; font-size: 12px; padding: 2px 0; }
      .warning mat-icon { font-size: 16px; width: 16px; height: 16px; }
    `,
  ],
})
export class ImportComponent {
  private api = inject(ApiService);
  private snack = inject(MatSnackBar);
  private state = inject(PeriodStateService);

  readonly busy = signal(false);
  readonly dragging = signal(false);
  readonly report = signal<ImportReport | null>(null);

  onPick(ev: Event): void {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (file) this.upload(file);
  }

  onDrop(ev: DragEvent): void {
    ev.preventDefault();
    this.dragging.set(false);
    const file = ev.dataTransfer?.files?.[0];
    if (file) this.upload(file);
  }

  private upload(file: File): void {
    if (!file.name.endsWith('.xlsx')) {
      this.snack.open('Please choose a .xlsx workbook', 'OK', { duration: 3000 });
      return;
    }
    this.busy.set(true);
    this.api.importExcel(file).subscribe({
      next: (rep) => {
        this.busy.set(false);
        this.report.set(rep);
        this.state.refreshSelected();
        this.snack.open('Import finished', undefined, { duration: 2500 });
      },
      error: (e) => {
        this.busy.set(false);
        this.snack.open(e?.error?.error?.message ?? 'Import failed', 'OK', { duration: 5000 });
      },
    });
  }
}
